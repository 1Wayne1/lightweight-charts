import { TIMEFRAME_SECONDS, type Candle, type CandleEvent, type CandleQuery, type ConnectionState, type Instrument, type MarketDataProvider, type StreamObserver, type Timeframe } from '@terminal/domain';
import { MarketDataError } from './binance';

interface CandleSource extends MarketDataProvider {
	subscribeCandles(instrument: Instrument, timeframe: Timeframe, observer: StreamObserver<CandleEvent>): () => void;
}
interface FeedObserver {
	onSnapshot(candles: Candle[], initial: boolean): void;
	onCandle(candle: Candle, count: number): void;
	onState(state: ConnectionState, message: string): void;
}
export function mergeCandles(previous: Candle[], incoming: Candle[]): Candle[] {
	const map = new Map(previous.map(c => [c.time, c]));
	for (const c of incoming) {
		const old = map.get(c.time);
		// Base volume is cumulative within a candle. Older snapshots must not roll it back.
		if (!old || c.volume >= old.volume) map.set(c.time, c);
	}
	return [...map.values()].sort((a, b) => a.time - b.time);
}
export function startCandleFeed(source: CandleSource, instrument: Instrument, timeframe: Timeframe, observer: FeedObserver) {
	const controller = new AbortController();
	const step = TIMEFRAME_SECONDS[timeframe];
	const minStep = timeframe === '1M' ? 28 * 86400 : step;
	const maxStep = timeframe === '1M' ? 31 * 86400 : step;
	let data: Candle[] = [];
	let pending: CandleEvent[] = [];
	let syncing = false;
	let needsSync = true;
	let streamActive = false;
	let eventTime = 0;
	let retry: ReturnType<typeof setTimeout> | undefined;
	let failures = 0;
	let retryAt = 0;
	let loadingOlder = false;
	let oldestReached = false;
	let historyRetryAt = 0;
	const alive = (): boolean => !controller.signal.aborted;
	const status = (state: ConnectionState, message: string): void => { if (alive()) observer.onState(state, message); };

	async function snapshot(): Promise<void> {
		if (!alive() || syncing || Date.now() < retryAt) return;
		syncing = true;
		needsSync = true;
		clearTimeout(retry);
		status('syncing', data.length ? '正在补齐行情' : '正在加载 Binance 行情');
		try {
			const initial = data.length === 0;
			let after = data.at(-1)?.time;
			let batch: Candle[] = [];
			let pages = 0;
			do {
				const query: CandleQuery = after === undefined ? {} : { after };
				const page = await source.getCandles(instrument, timeframe, controller.signal, query);
				if (!alive()) return;
				batch = mergeCandles(batch, page);
				if (initial || page.length < 500) break;
				const next = (page.at(-1)?.time ?? 0) + minStep;
				if (after !== undefined && next <= after) throw new Error('历史行情未向前推进');
				after = next;
				if (++pages >= 100) throw new Error('离线时间过长，请重新打开交易对');
			} while (alive());
			data = mergeCandles(mergeCandles(data, batch), pending.map(e => e.candle));
			eventTime = Math.max(eventTime, ...pending.map(e => e.eventTime));
			pending = [];
			needsSync = false;
			failures = 0;
			retryAt = 0;
			observer.onSnapshot(data, initial);
			status(streamActive ? 'live' : 'reconnecting', streamActive ? '实时' : '历史行情已加载，等待实时连接');
		} catch (error) {
			if (!alive()) return;
			const message = error instanceof Error ? error.message : '无法连接 Binance';
			status('error', `${message}，自动重试中`);
			const delay = Math.max(error instanceof MarketDataError ? error.retryAfterMs : 0, Math.min(30000, 1000 * 2 ** Math.min(failures++, 5)));
			retryAt = Date.now() + delay;
			retry = setTimeout(() => { void snapshot(); }, delay);
		} finally { syncing = false; }
	}
	const stop = source.subscribeCandles(instrument, timeframe, {
		onOpen: () => { needsSync = true; void snapshot(); },
		onState: (state, message) => {
			streamActive = false;
			needsSync = true;
			status(state, message ?? '正在连接 Binance');
		},
		onData: event => {
			if (!alive() || event.eventTime < eventTime) return;
			streamActive = true;
			if (syncing || needsSync || !data.length || event.candle.time > data[data.length - 1].time + maxStep) {
				pending.push(event);
				if (pending.length > 1000) pending = pending.slice(-1000);
				void snapshot();
				return;
			}
			const last = data[data.length - 1];
			if (event.candle.time < last.time || (event.candle.time === last.time && event.candle.volume < last.volume)) return;
			eventTime = event.eventTime;
			if (event.candle.time === last.time) data[data.length - 1] = event.candle;
			else data.push(event.candle);
			observer.onCandle(event.candle, data.length);
			status('live', '实时');
		},
	});
	void snapshot();
	return {
		async loadOlder(): Promise<void> {
			if (!alive() || loadingOlder || syncing || oldestReached || !data.length || Date.now() < historyRetryAt) return;
			loadingOlder = true;
			const before = data[0].time;
			try {
				const older = (await source.getCandles(instrument, timeframe, controller.signal, { before })).filter(c => c.time < before);
				if (!alive()) return;
				oldestReached = older.length < 500;
				if (older.length) {
					data = mergeCandles(older, data);
					observer.onSnapshot(data, false);
				}
			} catch (error) {
				if (!alive()) return;
				historyRetryAt = Date.now() + Math.max(5000, error instanceof MarketDataError ? error.retryAfterMs : 0);
				status('error', '历史加载失败，稍后浏览更早时间重试');
			} finally { loadingOlder = false; }
		},
		retry: () => { void snapshot(); },
		stop: () => { controller.abort(); stop(); clearTimeout(retry); pending = []; },
	};
}
