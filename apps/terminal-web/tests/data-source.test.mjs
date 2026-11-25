import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	buildBinanceRelayProvider,
	createProviderRegistry,
	defaultDataSourceSettings,
	parseDataSourceSettings,
	parseDefaultSymbolList,
	testDataSourceConnection,
} from '../src/data/data-source.ts';
import {
	GenericMarketProvider,
	parseGenericCandles,
	parseGenericInstruments,
	parseGenericKlineEvent,
	parseGenericQuote,
} from '../src/data/generic-provider.ts';
import { startCandleFeed } from '../src/data/candle-feed.ts';
import { startQuoteFeed } from '../src/data/quote-feed.ts';
import { instrumentKey } from '../../../packages/terminal-domain/src/index.ts';

const baseTime = 1700000040;
const drain = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };

test('data source settings validate URLs, generic venue isolation, and fallback defaults', () => {
	const defaults = defaultDataSourceSettings();
	assert.equal(defaults.activeType, 'binance');
	assert.equal(defaults.generic.venue, 'custom');

	const parsed = parseDataSourceSettings({
		schemaVersion: 1,
		activeType: 'generic',
		binance: {
			spotRest: 'https://proxy.example.com/',
			perpetualRest: 'https://fproxy.example.com',
			spotWs: 'wss://ws.example.com/',
			perpetualWs: 'wss://fws.example.com/market/',
		},
		generic: {
			venue: 'My-Feed',
			label: '自建行情',
			restBaseUrl: 'http://127.0.0.1:9000/',
			wsUrl: '',
			pollIntervalMs: 3000,
			markets: ['spot'],
			defaultSymbols: 'btc-usdt, ETH-USDT',
		},
	});
	assert.equal(parsed.activeType, 'generic');
	assert.equal(parsed.binance.spotRest, 'https://proxy.example.com');
	assert.equal(parsed.generic.venue, 'my-feed');
	assert.equal(parsed.generic.restBaseUrl, 'http://127.0.0.1:9000');
	assert.deepEqual(parsed.generic.markets, ['spot']);
	assert.deepEqual(parsed.generic.defaultSymbols, ['BTC-USDT', 'ETH-USDT']);

	// Generic venue cannot collide with reserved 'binance'.
	assert.throws(() => parseDataSourceSettings({
		...parsed,
		generic: { ...parsed.generic, venue: 'binance' },
	}), /binance/);

	// Active generic source requires REST URL.
	assert.throws(() => parseDataSourceSettings({
		...parsed,
		generic: { ...parsed.generic, restBaseUrl: '' },
	}), /REST/);

	// Reject unsupported protocol schemes.
	assert.throws(() => parseDataSourceSettings({
		...parsed,
		generic: { ...parsed.generic, restBaseUrl: 'ftp://example.com' },
	}), /http/);

	assert.deepEqual(parseDefaultSymbolList('BTC-USDT, eth-usdt, BTC-USDT'), ['BTC-USDT', 'ETH-USDT']);
});

test('generic protocol parsers normalize ms/s timestamps, arrays/objects, and reject corrupt data', () => {
	const candles = parseGenericCandles({
		candles: [
			{ time: (baseTime + 60) * 1000, open: 102, high: 112, low: 98, close: 108, volume: 15 },
			[baseTime, '100', '110', '90', '102', '10'],
			{ t: baseTime + 60, o: 102, h: 115, l: 98, c: 110, v: 20 },
		],
	});
	assert.deepEqual(candles, [
		{ time: baseTime, open: 100, high: 110, low: 90, close: 102, volume: 10 },
		{ time: baseTime + 60, open: 102, high: 115, low: 98, close: 110, volume: 20 },
	]);

	assert.throws(() => parseGenericCandles([{ time: baseTime, open: 100, high: 95, low: 90, close: 102, volume: 1 }]));
	assert.throws(() => parseGenericCandles([{ time: baseTime, open: 100, high: 110, low: 90, close: 102, volume: -1 }]));
	assert.throws(() => parseGenericCandles([{ time: baseTime + 0.5, open: 100, high: 110, low: 90, close: 102, volume: 1 }]));

	const instruments = parseGenericInstruments({
		instruments: [
			{ symbol: 'btc-usdt', market: 'spot', tickSize: 0.1 },
			{ symbol: 'ETH-USDT', market: 'perpetual', tickSize: 0.01 },
			'SOL-USDT',
		],
	}, 'my-feed', 'spot');
	assert.deepEqual(instruments, [
		{ instrument: { venue: 'my-feed', market: 'spot', symbol: 'BTC-USDT' }, tickSize: 0.1 },
		{ instrument: { venue: 'my-feed', market: 'spot', symbol: 'SOL-USDT' }, tickSize: 0.01 },
	]);

	const quote = parseGenericQuote({ price: 67500, change: 500, percent: 0.75, high: 68000, low: 66000, updatedAt: baseTime });
	assert.equal(quote.price, 67500);
	assert.equal(quote.updatedAt, baseTime * 1000);

	const inst = { venue: 'my-feed', market: 'spot', symbol: 'BTC-USDT' };
	const evt = parseGenericKlineEvent({
		type: 'kline',
		symbol: 'BTC-USDT',
		market: 'spot',
		interval: '1h',
		candle: { time: baseTime, open: 100, high: 110, low: 95, close: 105, volume: 8 },
		eventTime: baseTime * 1000 + 200,
	}, inst, '1h');
	assert.equal(evt?.candle.close, 105);
	assert.equal(parseGenericKlineEvent({ type: 'kline', symbol: 'ETH-USDT', interval: '1h', candle: { time: baseTime, open: 1, high: 2, low: 1, close: 2, volume: 1 } }, inst, '1h'), null);
});

test('generic provider supports 404 fallbacks, HTTP polling mode, WebSocket subscription, and cancellation', async t => {
	const requests = [];
	const fetcher = async (url, init) => {
		const parsed = new URL(String(url));
		requests.push({ pathname: parsed.pathname, params: Object.fromEntries(parsed.searchParams.entries()) });
		if (init?.signal?.aborted) throw init.signal.reason;
		if (parsed.pathname === '/instruments' || parsed.pathname === '/ticker') {
			return new Response('', { status: 404 });
		}
		if (parsed.pathname === '/klines') {
			return new Response(JSON.stringify([
				{ time: baseTime, open: 100, high: 110, low: 90, close: 105, volume: 12 },
				{ time: baseTime + 60, open: 105, high: 112, low: 101, close: 111, volume: 18 },
			]), { status: 200 });
		}
		return new Response('', { status: 404 });
	};

	const config = {
		venue: 'local-feed',
		label: '本地行情',
		restBaseUrl: 'http://127.0.0.1:9100',
		wsUrl: '',
		pollIntervalMs: 2000,
		markets: ['spot'],
		defaultSymbols: ['BTC-USDT', 'ETH-USDT'],
	};
	const provider = new GenericMarketProvider(config, fetcher);
	assert.equal(provider.realtime, false);

	// 404 on /instruments falls back to configured defaultSymbols.
	const list = await provider.getInstruments('spot');
	assert.deepEqual(list.map(item => instrumentKey(item.instrument)), [
		'local-feed:spot:BTC-USDT',
		'local-feed:spot:ETH-USDT',
	]);
	// Disabled market returns empty list without hitting network.
	assert.deepEqual(await provider.getInstruments('perpetual'), []);

	// 404 on /ticker derives latest quote from /klines.
	const spot = { venue: 'local-feed', market: 'spot', symbol: 'BTC-USDT' };
	const derivedQuote = await provider.getQuote(spot);
	assert.equal(derivedQuote.price, 111);
	assert.equal(derivedQuote.change, 6);

	// HTTP-only candle feed reports polling status instead of faking WebSocket.
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const states = [];
	const snapshots = [];
	const feed = startCandleFeed(provider, spot, '1m', {
		onSnapshot: (data, initial) => snapshots.push({ count: data.length, initial }),
		onCandle: () => undefined,
		onState: (state, message) => states.push({ state, message }),
	});
	await drain();
	assert.equal(snapshots.length, 1);
	assert.equal(states.at(-1)?.state, 'live');
	assert.equal(states.at(-1)?.message, '轮询更新');
	feed.stop();
	t.mock.timers.reset();

	// WebSocket mode sends subscription JSON on open and forwards kline events.
	const sent = [];
	const received = [];
	let socket;
	const wsProvider = new GenericMarketProvider({ ...config, wsUrl: 'wss://feed.example.test/ws' }, fetcher, () => {
		socket = {
			send(data) { sent.push(JSON.parse(data)); },
			close() { this.closed = true; },
		};
		return socket;
	});
	assert.equal(wsProvider.realtime, true);
	const stopWs = wsProvider.subscribeCandles(spot, '1h', {
		onData: evt => received.push(evt),
		onOpen: () => undefined,
		onState: () => undefined,
	});
	socket.onopen();
	assert.deepEqual(sent[0], { type: 'subscribe', channel: 'kline', symbol: 'BTC-USDT', market: 'spot', interval: '1h' });
	socket.onmessage({
		data: JSON.stringify({
			type: 'kline',
			symbol: 'BTC-USDT',
			market: 'spot',
			interval: '1h',
			candle: { time: baseTime, open: 100, high: 120, low: 95, close: 118, volume: 42 },
		}),
	});
	assert.equal(received.length, 1);
	assert.equal(received[0].candle.close, 118);
	stopWs();
	assert.equal(socket.closed, true);
});

test('provider registry routes binance and generic instruments independently so switching default source keeps existing tabs working', async () => {
	const fetchedUrls = [];
	const fetcher = async url => {
		const target = String(url);
		fetchedUrls.push(target);
		if (target.includes('binance')) {
			const body = target.includes('symbols=')
				? [{ symbol: 'BTCUSDT', lastPrice: '67000', priceChange: '100', priceChangePercent: '0.15', highPrice: '68000', lowPrice: '66000', closeTime: baseTime * 1000 }]
				: { lastPrice: '67000', priceChange: '100', priceChangePercent: '0.15', highPrice: '68000', lowPrice: '66000', closeTime: baseTime * 1000 };
			return new Response(JSON.stringify(body));
		}
		if (target.includes('/ticker')) {
			return new Response(JSON.stringify({
				price: 67123, change: 223, percent: 0.33, high: 67500, low: 66500, updatedAt: baseTime * 1000,
			}));
		}
		return new Response(JSON.stringify([
			{ time: baseTime, open: 67000, high: 67200, low: 66900, close: 67123, volume: 5 },
		]));
	};

	const settings = parseDataSourceSettings({
		schemaVersion: 1,
		activeType: 'generic',
		binance: defaultDataSourceSettings().binance,
		generic: {
			venue: 'altfeed',
			label: '自建源',
			restBaseUrl: 'http://127.0.0.1:9200',
			wsUrl: '',
			pollIntervalMs: 5000,
			markets: ['spot'],
			defaultSymbols: ['BTC-USDT'],
		},
	});
	const registry = createProviderRegistry(settings, fetcher, () => ({ close() {} }));
	assert.equal(registry.active.venue, 'altfeed');
	assert.equal(registry.resolve('binance')?.venue, 'binance');
	assert.equal(registry.resolve('altfeed')?.venue, 'altfeed');
	assert.equal(registry.resolve('unknown-venue'), undefined);

	const quotes = new Map();
	const stop = startQuoteFeed(
		venue => registry.resolve(venue),
		[
			{ venue: 'binance', market: 'spot', symbol: 'BTC-USDT' },
			{ venue: 'altfeed', market: 'spot', symbol: 'BTC-USDT' },
		],
		(inst, quote) => quotes.set(instrumentKey(inst), quote.price),
		() => undefined,
	);
	await drain();
	stop();
	assert.equal(quotes.get('binance:spot:BTC-USDT'), 67000);
	assert.equal(quotes.get('altfeed:spot:BTC-USDT'), 67123);

	const testResult = await testDataSourceConnection(settings, 'generic', fetcher);
	assert.equal(testResult.ok, true);
	assert.match(testResult.summary, /连接成功/);
});

test('Binance relay mode routes REST & WS through server with local header or one-time ws-ticket and never silently falls back to direct', async () => {
	// Default transport is relay; legacy custom endpoints migrate to direct.
	assert.equal(defaultDataSourceSettings().binance.transport, 'relay');
	const migratedCustom = parseDataSourceSettings({
		schemaVersion: 1,
		activeType: 'binance',
		binance: {
			spotRest: 'https://mirror.example.com',
			perpetualRest: 'https://fmirror.example.com',
			spotWs: 'wss://ws-mirror.example.com',
			perpetualWs: 'wss://fws-mirror.example.com/market',
		},
	});
	assert.equal(migratedCustom.binance.transport, 'direct');

	// Token-protected remote server relay: REST sends Bearer token; WS fetches one-time ticket (never puts SYNC_TOKEN in WS URL).
	const calls = [];
	const wsUrls = [];
	const secretToken = 'super-secret-sync-token-999';
	const fetcher = async (url, init = {}) => {
		const target = String(url);
		calls.push({ target, method: init.method ?? 'GET', headers: init.headers });
		if (target === 'https://charts.example.com/v1/market/ws-ticket' && init.method === 'POST') {
			return new Response(JSON.stringify({ ticket: 'one-time-ticket-abc', expiresInMs: 30000 }));
		}
		return new Response(JSON.stringify([[baseTime * 1000, '100', '110', '90', '105', '12']]));
	};
	const provider = buildBinanceRelayProvider(
		{
			ready: true,
			checking: false,
			baseUrl: 'https://charts.example.com',
			auth: { mode: 'token', token: secretToken },
			source: 'remote',
		},
		fetcher,
		url => { wsUrls.push(url); return { close() {} }; },
	);

	const candles = await provider.getCandles({ venue: 'binance', market: 'perpetual', symbol: 'ETH-USDT' }, '1h');
	assert.equal(candles.length, 1);
	assert.equal(calls[0].target, 'https://charts.example.com/v1/market/binance/perpetual/fapi/v1/klines?symbol=ETHUSDT&interval=1h&limit=500');
	assert.equal(calls[0].headers.Authorization, `Bearer ${secretToken}`);

	const stop = provider.subscribeCandles({ venue: 'binance', market: 'perpetual', symbol: 'ETH-USDT' }, '1h', {
		onData() {}, onOpen() {}, onState() {},
	});
	await drain();
	stop();
	assert.equal(wsUrls.length, 1);
	assert.equal(wsUrls[0], 'wss://charts.example.com/v1/market/binance/perpetual/stream?streams=ethusdt@kline_1h&ticket=one-time-ticket-abc');
	assert.equal(wsUrls[0].includes(secretToken), false);

	// Unready relay target (e.g. token not yet entered) must NOT silently call Binance directly.
	let networkTouched = false;
	const blocked = buildBinanceRelayProvider(
		{
			ready: false,
			checking: false,
			baseUrl: 'https://charts.example.com',
			auth: { mode: 'token', token: '' },
			source: 'remote',
			needsToken: true,
			reason: '请先填写访问口令',
		},
		async () => { networkTouched = true; return new Response('[]'); },
	);
	await assert.rejects(blocked.getCandles({ venue: 'binance', market: 'spot', symbol: 'BTC-USDT' }, '1h'), /访问口令/);
	assert.equal(networkTouched, false);
});
