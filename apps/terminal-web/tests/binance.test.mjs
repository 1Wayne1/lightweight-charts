import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BinanceProvider, MarketDataError, defaultEndpoints, parseExchangeInfo, parseKlineEvent, parseKlines, parseQuote } from '../src/data/binance.ts';
import { mergeCandles, startCandleFeed } from '../src/data/candle-feed.ts';
import { connectStream } from '../src/data/stream.ts';
import { calculateIndicators, nextIndicators } from '../src/data/indicators.ts';
import { migrateDemoWorkspace } from '../src/data/workspace-migration.ts';
import { emptyWorkspace, instrumentKey, openInstrument, setTimeframe, closeTab, parseWorkspace } from '../../../packages/terminal-domain/src/index.ts';

const spot = { venue: 'binance', market: 'spot', symbol: 'BTC-USDT' };
const perpetual = { ...spot, market: 'perpetual' };
const time = 1700000040;
const bar = (offset = 0, volume = 10, close = 102) => ({ time: time + offset * 60, open: 100, high: 110, low: 90, close, volume });
const row = (offset = 0, volume = '10') => [(time + offset * 60) * 1000, '100', '110', '90', '102', volume];
const drain = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function sourceFixture(getCandles = async () => [bar()]) {
	let observer;
	let stopped = false;
	const source = { getCandles, subscribeCandles: (_i, _t, value) => { observer = value; return () => { stopped = true; }; } };
	const snapshots = [];
	const updates = [];
	const states = [];
	const feed = startCandleFeed(source, spot, '1m', {
		onSnapshot: (data, initial) => snapshots.push({ data: structuredClone(data), initial }),
		onCandle: (candle, count) => updates.push({ candle, count }),
		onState: (state, message) => states.push({ state, message }),
	});
	return { feed, snapshots, updates, states, get observer() { return observer; }, get stopped() { return stopped; } };
}

test('REST routes spot and perpetual separately, uses seconds at the boundary, and parses actual volume', async () => {
	const urls = [];
	const provider = new BinanceProvider(defaultEndpoints, async url => { urls.push(new URL(url)); return new Response(JSON.stringify([row()])); });
	const candles = await provider.getCandles(spot, '1m', undefined, { before: time, limit: 500 });
	await provider.getCandles(perpetual, '4h', undefined, { after: time });
	assert.equal(urls[0].origin, defaultEndpoints.spotRest);
	assert.equal(urls[0].pathname, '/api/v3/klines');
	assert.equal(urls[0].searchParams.get('endTime'), String(time * 1000 - 1));
	assert.equal(urls[1].origin, defaultEndpoints.perpetualRest);
	assert.equal(urls[1].pathname, '/fapi/v1/klines');
	assert.equal(urls[1].searchParams.get('startTime'), String(time * 1000));
	assert.deepEqual(candles, [bar()]);
});

test('klines are sorted, deduplicated, and reject corrupt price/volume values', () => {
	assert.deepEqual(parseKlines([row(1), row(0), row(1, '20')]), [bar(), bar(1, 20)]);
	assert.throws(() => parseKlines([[time * 1000, '100', '90', '110', '100', '1']]));
	assert.throws(() => parseKlines([row(0, '-1')]));
	assert.throws(() => parseKlines([row(0, 'NaN')]));
});

test('stream parsing checks symbol and timeframe and keeps UTC seconds and base volume', () => {
	const message = { e: 'kline', s: 'BTCUSDT', E: time * 1000 + 500, k: { s: 'BTCUSDT', i: '1m', t: time * 1000, o: '100', h: '110', l: '90', c: '102', v: '20' } };
	assert.deepEqual(parseKlineEvent(message, spot, '1m'), { candle: bar(0, 20), eventTime: message.E });
	assert.equal(parseKlineEvent(message, { ...spot, symbol: 'ETH-USDT' }, '1m'), null);
	assert.equal(parseKlineEvent(message, spot, '4h'), null);
	assert.equal(parseQuote({ lastPrice: '102', priceChange: '2', priceChangePercent: '2', highPrice: '110', lowPrice: '90', closeTime: time * 1000 }).percent, 2);
});

test('catalogue admits trading USDT spot and perpetual (including TradFi) only, with exchange tick sizes', () => {
	const symbol = { symbol: 'BTCUSDT', status: 'TRADING', baseAsset: 'BTC', quoteAsset: 'USDT', contractType: 'PERPETUAL', filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.10' }] };
	const nvda = { symbol: 'NVDAUSDT', status: 'TRADING', baseAsset: 'NVDA', quoteAsset: 'USDT', contractType: 'TRADIFI_PERPETUAL', filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.01' }] };
	const xau = { symbol: 'XAUUSDT', status: 'TRADING', baseAsset: 'XAU', quoteAsset: 'USDT', contractType: 'TRADIFI_PERPETUAL', filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.01' }] };
	const mismatched = { ...nvda, symbol: 'NVDAUSDC', baseAsset: 'NVDA' };
	const nonUsdt = { ...nvda, symbol: 'NVDAUSDC', quoteAsset: 'USDC' };
	assert.deepEqual(
		parseExchangeInfo({
			symbols: [
				symbol,
				nvda,
				xau,
				{ ...symbol, contractType: 'CURRENT_QUARTER' },
				{ ...symbol, status: 'BREAK' },
				mismatched,
				nonUsdt,
			],
		}, 'perpetual'),
		[
			{ instrument: perpetual, tickSize: .1 },
			{ instrument: { venue: 'binance', market: 'perpetual', symbol: 'NVDA-USDT' }, tickSize: .01 },
			{ instrument: { venue: 'binance', market: 'perpetual', symbol: 'XAU-USDT' }, tickSize: .01 },
		],
	);
	assert.deepEqual(parseExchangeInfo({ symbols: [{ ...symbol, isSpotTradingAllowed: true }, { ...symbol, symbol: 'ETHUSDT', baseAsset: 'ETH', isSpotTradingAllowed: false }] }, 'spot'), [{ instrument: spot, tickSize: .1 }]);
});

test('HTTP rate limits respect Retry-After and prevent repeated requests; cancellation reaches fetch', async () => {
	let calls = 0;
	const provider = new BinanceProvider(defaultEndpoints, async () => { calls++; return new Response('', { status: 429, headers: { 'Retry-After': '60' } }); });
	await assert.rejects(provider.getCandles(spot, '1m'), error => error instanceof MarketDataError && error.retryAfterMs >= 60000);
	await assert.rejects(provider.getCandles(spot, '1m'));
	assert.equal(calls, 1);
	const controller = new AbortController();
	const cancelProvider = new BinanceProvider(defaultEndpoints, (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason))));
	const request = cancelProvider.getCandles(perpetual, '1m', controller.signal);
	controller.abort();
	await assert.rejects(request, { name: 'AbortError' });
});

test('a late REST snapshot cannot overwrite buffered newer websocket data', async () => {
	const deferred = defer();
	const f = sourceFixture(() => deferred.promise);
	try {
		f.observer.onData({ candle: bar(0, 20, 105), eventTime: 2 });
		deferred.resolve([bar(0, 10)]);
		await drain();
		assert.equal(f.snapshots[0].data[0].close, 105);
		assert.equal(f.snapshots[0].data[0].volume, 20);
		f.observer.onData({ candle: bar(0, 30, 106), eventTime: 3 });
		f.observer.onData({ candle: bar(0, 21, 103), eventTime: 2 });
		assert.equal(f.updates.length, 1);
		assert.equal(f.updates[0].candle.close, 106);
	} finally { f.feed.stop(); }
});

test('reconnecting backfills the missing interval before committing the next candle', async () => {
	const requests = [];
	const f = sourceFixture(async (_i, _t, _s, query) => {
		requests.push(query);
		return requests.length === 1 ? [bar()] : [bar(0, 20), bar(1), bar(2)];
	});
	try {
		await drain();
		f.observer.onState('reconnecting');
		f.observer.onOpen();
		f.observer.onData({ candle: bar(2, 30), eventTime: 4 });
		await drain();
		assert.equal(requests[1].after, time);
		assert.deepEqual(f.snapshots.at(-1).data.map(c => c.time), [time, time + 60, time + 120]);
		assert.equal(f.snapshots.at(-1).data.at(-1).volume, 30);
	} finally { f.feed.stop(); }
});

test('feed cancellation ignores old fetches and callbacks after switching instruments', async () => {
	const deferred = defer();
	const f = sourceFixture(() => deferred.promise);
	f.feed.stop();
	deferred.resolve([bar()]);
	f.observer.onData({ candle: bar(1), eventTime: 10 });
	await drain();
	assert.equal(f.snapshots.length, 0);
	assert.equal(f.updates.length, 0);
	assert.equal(f.stopped, true);
});

test('history prepend excludes duplicate boundary candles and retains current live values', async () => {
	const f = sourceFixture(async (_i, _t, _s, query) => query.before ? [bar(-2), bar(-1), bar()] : [bar(0, 20)]);
	try {
		await drain();
		await f.feed.loadOlder();
		assert.deepEqual(f.snapshots.at(-1).data.map(c => c.time), [time - 120, time - 60, time]);
		assert.equal(f.snapshots.at(-1).data.at(-1).volume, 20);
		assert.equal(f.snapshots.at(-1).initial, false);
	} finally { f.feed.stop(); }
});

test('socket reconnects with backoff and teardown releases sockets and scheduled reconnects', t => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const sockets = [];
	const values = [];
	let opens = 0;
	const factory = () => { const socket = { close() { this.closed = true; } }; sockets.push(socket); return socket; };
	const stop = connectStream('wss://example.test', { onData: value => values.push(value), onOpen: () => { opens++; }, onState() {} }, factory, { retry: 100, watchdog: 1000 });
	sockets[0].onopen();
	sockets[0].onmessage({ data: JSON.stringify({ stream: 'test', data: { price: 1 } }) });
	assert.deepEqual(values, [{ price: 1 }]);
	sockets[0].onclose();
	assert.equal(sockets[0].closed, true);
	t.mock.timers.tick(100);
	assert.equal(sockets.length, 2);
	sockets[1].onopen();
	t.mock.timers.tick(1000);
	assert.equal(sockets[1].closed, true);
	stop();
	t.mock.timers.tick(5000);
	assert.equal(sockets.length, 2);
	assert.equal(opens, 2);
});

test('live indicator replacement uses the previous completed candle, matching a complete recalculation', () => {
	const original = [bar(), bar(1, 20, 105), bar(2, 25, 103)];
	const computed = calculateIndicators(original);
	const changed = [...original.slice(0, 2), bar(2, 30, 108)];
	assert.deepEqual(nextIndicators(108, computed[1]), calculateIndicators(changed)[2]);
	assert.equal(mergeCandles([bar(0, 20)], [bar(0, 10)])[0].volume, 20);
});

test('demo migration preserves closed preferences and existing Binance settings without merging perpetual', () => {
	const demo = { ...spot, venue: 'demo' };
	let state = setTimeframe(openInstrument(emptyWorkspace(), demo), instrumentKey(demo), '4h');
	state = setTimeframe(openInstrument(state, spot), instrumentKey(spot), '15m');
	state = openInstrument(state, perpetual);
	const migrated = migrateDemoWorkspace(state);
	assert.equal(migrated.tabs.length, 2);
	assert.equal(migrated.preferences[instrumentKey(spot)].timeframe, '15m');
	assert.equal(migrated.preferences[instrumentKey(demo)].timeframe, '4h');
	assert.equal(migrated.preferences[instrumentKey(perpetual)].timeframe, '1h');
	assert.deepEqual(parseWorkspace(migrated), migrated);
	const closed = closeTab(setTimeframe(openInstrument(emptyWorkspace(), demo), instrumentKey(demo), '1d'), instrumentKey(demo));
	assert.equal(migrateDemoWorkspace(closed).preferences[instrumentKey(spot)].timeframe, '1d');
});

test('futures candle and ticker streams use the market path and separate symbols from spot', () => {
	const urls = [];
	const provider = new BinanceProvider(defaultEndpoints, fetch, url => { urls.push(url); return { close() {} }; });
	const observer = { onData() {}, onOpen() {}, onState() {} };
	const stops = [provider.subscribeCandles(spot, '1m', observer), provider.subscribeCandles(perpetual, '4h', observer), provider.subscribeQuotes([perpetual], observer)];
	try {
		assert.equal(urls[0], 'wss://data-stream.binance.vision/stream?streams=btcusdt@kline_1m');
		assert.equal(urls[1], 'wss://fstream.binance.com/market/stream?streams=btcusdt@kline_4h');
		assert.equal(urls[2], 'wss://fstream.binance.com/market/stream?streams=btcusdt@ticker');
	} finally { stops.forEach(stop => stop()); }
});

test('incoming websocket data cannot bypass REST retry backoff', async t => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
	let calls = 0;
	const f = sourceFixture(async () => { calls++; throw new MarketDataError('limited', 60000); });
	try {
		await drain();
		for (let i = 1; i <= 20; i++) f.observer.onData({ candle: bar(0, i), eventTime: i });
		await drain();
		assert.equal(calls, 1);
		t.mock.timers.tick(60000);
		await drain();
		assert.equal(calls, 2);
	} finally { f.feed.stop(); }
});

test('manual retry bypasses local backoff and network TypeError surfaces a clear message', async () => {
	const provider = new BinanceProvider(defaultEndpoints, async () => { throw new TypeError('Load failed'); });
	await assert.rejects(provider.getCandles(spot, '1m'), /无法连接 Binance 行情接口/);

	let calls = 0;
	const f = sourceFixture(async () => {
		calls++;
		if (calls === 1) throw new MarketDataError('无法连接 Binance 行情接口', 30000);
		return [bar()];
	});
	try {
		await drain();
		assert.equal(calls, 1);
		f.feed.retry();
		await drain();
		assert.equal(calls, 2);
		assert.equal(f.snapshots.length, 1);
	} finally { f.feed.stop(); }
});
