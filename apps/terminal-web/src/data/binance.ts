import { instrumentKey, type Candle, type CandleEvent, type CandleQuery, type Instrument, type InstrumentInfo, type MarketQuote, type StreamObserver, type Timeframe } from '@terminal/domain';
import type { Market, MarketFeedProvider } from './provider';
import { connectStream, type SocketFactory } from './stream';

export type { Market };
export interface BinanceEndpoints { spotRest: string; perpetualRest: string; spotWs: string; perpetualWs: string; }
export interface BinanceRelayOptions {
	label?: string;
	headers?: () => Record<string, string>;
	resolveWsUrl?: (url: string) => Promise<string>;
	notReadyMessage?: string;
	waiting?: boolean;
}
export const defaultEndpoints: BinanceEndpoints = {
	spotRest: 'https://data-api.binance.vision', perpetualRest: 'https://fapi.binance.com',
	spotWs: 'wss://data-stream.binance.vision', perpetualWs: 'wss://fstream.binance.com/market',
};
export class MarketDataError extends Error {
	constructor(message: string, public retryAfterMs = 0, public isIpBan = false) { super(message); }
}

function parseBinanceBanDetails(bodyText: string): { ip?: string; banUntilMs?: number } {
	let text = bodyText;
	try {
		const parsed: unknown = JSON.parse(bodyText);
		if (parsed && typeof parsed === 'object' && 'msg' in parsed && typeof (parsed as { msg: unknown }).msg === 'string') {
			text = (parsed as { msg: string }).msg;
		}
	} catch {
		// Non-JSON error body; fall back to raw text pattern matching.
	}
	const ipMatch = /IP\(([^)]+)\)/.exec(text);
	const untilMatch = /banned until (\d{10,16})/i.exec(text);
	const rawUntil = untilMatch ? Number(untilMatch[1]) : NaN;
	const banUntilMs = Number.isFinite(rawUntil) ? (rawUntil >= 1e12 ? rawUntil : rawUntil * 1000) : undefined;
	return { ip: ipMatch?.[1], banUntilMs };
}

function formatBanTime(ms: number): string {
	return new Date(ms).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
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

export class BinanceProvider implements MarketFeedProvider {
	readonly id = 'binance';
	readonly venue = 'binance';
	readonly label: string;
	readonly protocol = 'binance' as const;
	readonly maxCandleLimit = 500;
	readonly realtime = true;
	private cooldown = new Map<string, { until: number; message: string; isIpBan: boolean }>();
	constructor(
		private endpoints: BinanceEndpoints = defaultEndpoints,
		private fetcher: typeof fetch = (input, init) => fetch(input, init),
		private socketFactory?: SocketFactory,
		private relayOptions?: BinanceRelayOptions,
	) {
		this.label = relayOptions?.label ?? 'Binance';
	}
	private async request(market: Market, path: string, params: Record<string, string>, signal?: AbortSignal, bucket: 'candles' | 'aux' = 'candles'): Promise<unknown> {
		signal?.throwIfAborted();
		if (this.relayOptions?.notReadyMessage) {
			throw new MarketDataError(this.relayOptions.notReadyMessage, this.relayOptions.waiting ? 1500 : 0, !this.relayOptions.waiting);
		}
		const cooldownKey = `${market}:${bucket}`;
		const activeCooldown = this.cooldown.get(cooldownKey);
		const wait = (activeCooldown?.until ?? 0) - Date.now();
		if (wait > 0 && activeCooldown) throw new MarketDataError(activeCooldown.message, wait, activeCooldown.isIpBan);
		const base = market === 'spot' ? this.endpoints.spotRest : this.endpoints.perpetualRest;
		const url = `${base.replace(/\/$/, '')}${market === 'spot' ? '/api/v3' : '/fapi/v1'}/${path}?${new URLSearchParams(params).toString()}`;
		const controller = new AbortController();
		const abort = (): void => controller.abort(signal?.reason);
		signal?.addEventListener('abort', abort, { once: true });
		const timeout = setTimeout(() => controller.abort(new Error(`${this.label} 请求超时`)), 12000);
		const extraHeaders = this.relayOptions?.headers?.();
		try {
			const response = await this.fetcher(url, {
				signal: controller.signal,
				credentials: 'omit',
				...(extraHeaders ? { headers: extraHeaders } : {}),
			});
			if (!response.ok) {
				if (response.status === 429 || response.status === 418) {
					const header = response.headers.get('Retry-After');
					const headerDelay = header && Number.isFinite(Number(header)) ? Number(header) * 1000 : 0;
					let bodyText = '';
					try { bodyText = await response.text(); } catch { /* ignore */ }
					const { ip, banUntilMs } = parseBinanceBanDetails(bodyText);
					const isIpBan = response.status === 418 || banUntilMs !== undefined;
					const banDelay = banUntilMs !== undefined ? Math.max(1000, banUntilMs - Date.now()) : 0;
					const defaultDelay = isIpBan ? 300000 : 15000;
					const delay = Math.max(1000, headerDelay || banDelay || defaultDelay);
					const until = banUntilMs && banUntilMs > Date.now() ? banUntilMs : Date.now() + delay;
					const message = isIpBan
						? `当前出口 IP${ip ? ` (${ip})` : ''} 已被 Binance 临时封禁${banUntilMs ? `至 ${formatBanTime(banUntilMs)}` : ''}（418），请切换代理节点或配置镜像`
						: 'Binance 请求限流';
					if (isIpBan) {
						this.cooldown.set(`${market}:candles`, { until, message, isIpBan: true });
						this.cooldown.set(`${market}:aux`, { until, message, isIpBan: true });
					} else {
						this.cooldown.set(cooldownKey, { until, message, isIpBan: false });
					}
					throw new MarketDataError(message, delay, isIpBan);
				}
				if (this.relayOptions) {
					if (response.status === 401 || response.status === 403) {
						throw new MarketDataError('行情中继鉴权失败，请在「设置 → 存储服务」检查访问口令', 0, true);
					}
					if (response.status === 502) {
						throw new MarketDataError('服务器无法连接上游 Binance（请检查服务器网络或 MARKET_PROXY_URL 代理）');
					}
				}
				throw new MarketDataError(response.status === 451 || response.status === 403 ? '当前网络或地区无法访问 Binance' : `${this.label} 行情请求失败 (${response.status})`);
			}
			return await response.json() as unknown;
		} catch (error) {
			if (signal?.aborted || error instanceof MarketDataError) throw error;
			if (controller.signal.aborted && controller.signal.reason instanceof Error) throw controller.signal.reason;
			if (error instanceof TypeError) {
				throw new MarketDataError(this.relayOptions
					? '无法连接到行情中继服务（请检查电脑/服务器是否在线）'
					: '无法连接 Binance 行情接口，请检查网络或代理');
			}
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
		return parseKlines(await this.request(instrument.market, 'klines', params, signal, 'candles'));
	}
	async getInstruments(market: Market, signal?: AbortSignal): Promise<InstrumentInfo[]> {
		return parseExchangeInfo(await this.request(market, 'exchangeInfo', {}, signal, 'aux'), market);
	}
	async getQuote(instrument: Instrument, signal?: AbortSignal): Promise<MarketQuote> {
		return parseQuote(await this.request(instrument.market, 'ticker/24hr', { symbol: exchangeSymbol(instrument) }, signal, 'aux'));
	}
	async getQuotes(instruments: Instrument[], signal?: AbortSignal): Promise<Map<string, MarketQuote>> {
		const result = new Map<string, MarketQuote>();
		const spotItems = instruments.filter(item => item.venue === 'binance' && item.market === 'spot');
		if (!spotItems.length) return result;
		const bySymbol = new Map(spotItems.map(item => [exchangeSymbol(item), item]));
		// Batch spot 24hr tickers into a single HTTP request (chunks of 50 symbols).
		const symbols = [...bySymbol.keys()];
		for (let i = 0; i < symbols.length; i += 50) {
			const chunk = symbols.slice(i, i + 50);
			const payload = await this.request('spot', 'ticker/24hr', { symbols: JSON.stringify(chunk) }, signal, 'aux');
			if (!Array.isArray(payload)) throw new Error('批量报价响应格式无效');
			for (const entry of payload as unknown[]) {
				const q = record(entry);
				const inst = typeof q.symbol === 'string' ? bySymbol.get(q.symbol) : undefined;
				if (inst) result.set(instrumentKey(inst), parseQuote(q));
			}
		}
		return result;
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
		if (this.relayOptions?.notReadyMessage) {
			observer.onState(this.relayOptions.waiting ? 'connecting' : 'error', this.relayOptions.notReadyMessage);
			return () => undefined;
		}
		const base = market === 'spot' ? this.endpoints.spotWs : this.endpoints.perpetualWs;
		const rawUrl = `${base.replace(/\/$/, '')}/stream?streams=${streams.join('/')}`;
		const resolveWsUrl = this.relayOptions?.resolveWsUrl;
		return connectStream(resolveWsUrl ? () => resolveWsUrl(rawUrl) : rawUrl, observer, this.socketFactory);
	}
}
