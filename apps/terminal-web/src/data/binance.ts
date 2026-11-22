import { instrumentKey, type Candle, type CandleEvent, type CandleQuery, type Instrument, type InstrumentInfo, type MarketDataProvider, type MarketQuote, type StreamObserver, type Timeframe } from '@terminal/domain';
import { connectStream, type SocketFactory } from './stream';

export type Market = Instrument['market'];
export interface BinanceEndpoints { spotRest: string; perpetualRest: string; spotWs: string; perpetualWs: string; }
export const defaultEndpoints: BinanceEndpoints = {
	spotRest: 'https://data-api.binance.vision', perpetualRest: 'https://fapi.binance.com',
	spotWs: 'wss://data-stream.binance.vision', perpetualWs: 'wss://fstream.binance.com/market',
};
export class MarketDataError extends Error {
	constructor(message: string, public retryAfterMs = 0) { super(message); }
}
export function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('行情响应格式无效');
	return value as Record<string, unknown>;
}
function numeric(value: unknown): number {
	if ((typeof value !== 'number' && typeof value !== 'string') || value === '') throw new Error('行情数值无效');
	const number = Number(value);
	if (!Number.isFinite(number)) throw new Error('行情数值无效');
	return number;
}
function timestamp(value: unknown): number {
	const time = numeric(value);
	if (!Number.isSafeInteger(time) || time <= 0) throw new Error('行情时间无效');
	return time;
}
function candle(time: unknown, open: unknown, high: unknown, low: unknown, close: unknown, volume: unknown): Candle {
	const result = { time: timestamp(time) / 1000, open: numeric(open), high: numeric(high), low: numeric(low), close: numeric(close), volume: numeric(volume) };
	if (!Number.isInteger(result.time) || result.low <= 0 || result.volume < 0 || result.high < Math.max(result.open, result.close) || result.low > Math.min(result.open, result.close)) throw new Error('K 线数据无效');
	return result;
}
export function parseKlines(value: unknown): Candle[] {
	if (!Array.isArray(value)) throw new Error('K 线响应格式无效');
	const unique = new Map<number, Candle>();
	for (const row of value as unknown[]) {
		if (!Array.isArray(row) || row.length < 6) throw new Error('K 线响应格式无效');
		const item = candle(row[0], row[1], row[2], row[3], row[4], row[5]);
		unique.set(item.time, item);
	}
	return [...unique.values()].sort((a, b) => a.time - b.time);
}
export function exchangeSymbol(instrument: Instrument): string {
	instrumentKey(instrument);
	if (instrument.venue !== 'binance' || !instrument.symbol.endsWith('-USDT')) throw new Error('当前仅支持 Binance USDT 现货及永续');
	return instrument.symbol.replace('-', '');
}
export function parseKlineEvent(value: unknown, instrument: Instrument, timeframe: Timeframe): CandleEvent | null {
	const message = record(value);
	if (message.e !== 'kline' || message.s !== exchangeSymbol(instrument)) return null;
	const k = record(message.k);
	if (k.s !== message.s || k.i !== timeframe) return null;
	return { candle: candle(k.t, k.o, k.h, k.l, k.c, k.v), eventTime: timestamp(message.E) };
}
export function parseQuote(value: unknown, streaming = false): MarketQuote {
	const q = record(value);
	const result = {
		price: numeric(q[streaming ? 'c' : 'lastPrice']), change: numeric(q[streaming ? 'p' : 'priceChange']),
		percent: numeric(q[streaming ? 'P' : 'priceChangePercent']), high: numeric(q[streaming ? 'h' : 'highPrice']),
		low: numeric(q[streaming ? 'l' : 'lowPrice']), updatedAt: timestamp(q[streaming ? 'E' : 'closeTime']),
	};
	if (result.price <= 0 || result.low <= 0 || result.high < result.low) throw new Error('报价数据无效');
	return result;
}
const PERPETUAL_CONTRACT_TYPES = new Set(['PERPETUAL', 'TRADIFI_PERPETUAL']);

export function parseExchangeInfo(value: unknown, market: Market): InstrumentInfo[] {
	const info = record(value);
	if (!Array.isArray(info.symbols)) throw new Error('交易对目录无效');
	const result: InstrumentInfo[] = [];
	for (const value of info.symbols as unknown[]) {
		const item = record(value);
		if (
			item.status !== 'TRADING' ||
			item.quoteAsset !== 'USDT' ||
			(market === 'perpetual' && (typeof item.contractType !== 'string' || !PERPETUAL_CONTRACT_TYPES.has(item.contractType))) ||
			(market === 'spot' && item.isSpotTradingAllowed === false)
		) continue;
		if (typeof item.baseAsset !== 'string' || !/^[A-Z0-9]+$/.test(item.baseAsset) || item.symbol !== `${item.baseAsset}USDT` || !Array.isArray(item.filters)) continue;
		const filter = (item.filters as unknown[]).map(record).find(f => f.filterType === 'PRICE_FILTER');
		const tickSize = filter ? numeric(filter.tickSize) : 0;
		if (tickSize <= 0) continue;
		result.push({ instrument: { venue: 'binance', market, symbol: `${item.baseAsset}-USDT` }, tickSize });
	}
	return result;
}

export class BinanceProvider implements MarketDataProvider {
	private cooldown = new Map<Market, number>();
	constructor(private endpoints: BinanceEndpoints = defaultEndpoints, private fetcher: typeof fetch = (input, init) => fetch(input, init), private socketFactory?: SocketFactory) {}
	private async request(market: Market, path: string, params: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
		signal?.throwIfAborted();
		const wait = (this.cooldown.get(market) ?? 0) - Date.now();
		if (wait > 0) throw new MarketDataError('Binance 请求限流，稍后自动重试', wait);
		const base = market === 'spot' ? this.endpoints.spotRest : this.endpoints.perpetualRest;
		const url = `${base.replace(/\/$/, '')}${market === 'spot' ? '/api/v3' : '/fapi/v1'}/${path}?${new URLSearchParams(params).toString()}`;
		const controller = new AbortController();
		const abort = (): void => controller.abort(signal?.reason);
		signal?.addEventListener('abort', abort, { once: true });
		const timeout = setTimeout(() => controller.abort(new Error('Binance 请求超时')), 12000);
		try {
			const response = await this.fetcher(url, { signal: controller.signal, credentials: 'omit' });
			if (!response.ok) {
				if (response.status === 429 || response.status === 418) {
					const header = response.headers.get('Retry-After');
					const delay = header && Number.isFinite(Number(header)) ? Number(header) * 1000 : 60000;
					this.cooldown.set(market, Date.now() + Math.max(1000, delay));
					throw new MarketDataError('Binance 请求限流，稍后自动重试', Math.max(1000, delay));
				}
				throw new MarketDataError(response.status === 451 || response.status === 403 ? '当前网络或地区无法访问 Binance' : `Binance 行情请求失败 (${response.status})`);
			}
			return await response.json() as unknown;
		} catch (error) {
			if (signal?.aborted || error instanceof MarketDataError) throw error;
			if (controller.signal.aborted && controller.signal.reason instanceof Error) throw controller.signal.reason;
			if (error instanceof TypeError) throw new MarketDataError('无法连接 Binance 行情接口，请检查网络或代理');
			throw error;
		} finally {
			clearTimeout(timeout);
			signal?.removeEventListener('abort', abort);
		}
	}
	async getCandles(instrument: Instrument, timeframe: Timeframe, signal?: AbortSignal, query: CandleQuery = {}): Promise<Candle[]> {
		const params: Record<string, string> = { symbol: exchangeSymbol(instrument), interval: timeframe, limit: String(Math.min(500, Math.max(1, query.limit ?? 500))) };
		if (query.before !== undefined) params.endTime = String(query.before * 1000 - 1);
		if (query.after !== undefined) params.startTime = String(query.after * 1000);
		return parseKlines(await this.request(instrument.market, 'klines', params, signal));
	}
	async getInstruments(market: Market, signal?: AbortSignal): Promise<InstrumentInfo[]> {
		return parseExchangeInfo(await this.request(market, 'exchangeInfo', {}, signal), market);
	}
	async getQuote(instrument: Instrument, signal?: AbortSignal): Promise<MarketQuote> {
		return parseQuote(await this.request(instrument.market, 'ticker/24hr', { symbol: exchangeSymbol(instrument) }, signal));
	}
	subscribeCandles(instrument: Instrument, timeframe: Timeframe, observer: StreamObserver<CandleEvent>): () => void {
		return this.stream(instrument.market, [`${exchangeSymbol(instrument).toLowerCase()}@kline_${timeframe}`], {
			...observer, onData: value => { const event = parseKlineEvent(value, instrument, timeframe); if (event) observer.onData(event); },
		});
	}
	subscribeQuotes(instruments: Instrument[], observer: StreamObserver<{ instrument: Instrument; quote: MarketQuote }>): () => void {
		if (!instruments.length) return () => undefined;
		const bySymbol = new Map(instruments.map(i => [exchangeSymbol(i), i]));
		return this.stream(instruments[0].market, [...bySymbol.keys()].map(s => `${s.toLowerCase()}@ticker`), {
			...observer,
			onData: value => {
				const message = record(value);
				const instrument = typeof message.s === 'string' ? bySymbol.get(message.s) : undefined;
				if (message.e === '24hrTicker' && instrument) observer.onData({ instrument, quote: parseQuote(message, true) });
			},
		});
	}
	private stream(market: Market, streams: string[], observer: StreamObserver<unknown>): () => void {
		const base = market === 'spot' ? this.endpoints.spotWs : this.endpoints.perpetualWs;
		return connectStream(`${base.replace(/\/$/, '')}/stream?streams=${streams.join('/')}`, observer, this.socketFactory);
	}
}
