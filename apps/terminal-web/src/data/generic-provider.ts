import { instrumentKey, type Candle, type CandleEvent, type CandleQuery, type Instrument, type InstrumentInfo, type MarketQuote, type StreamObserver, type Timeframe } from '@terminal/domain';
import { MarketDataError, record } from './binance';
import type { Market, MarketFeedProvider } from './provider';
import { connectStream, type SocketFactory } from './stream';

export interface GenericProviderConfig {
	venue: string;
	label: string;
	restBaseUrl: string;
	wsUrl: string;
	pollIntervalMs: number;
	markets: readonly Market[];
	defaultSymbols: readonly string[];
}

function numeric(value: unknown): number {
	if ((typeof value !== 'number' && typeof value !== 'string') || value === '') throw new Error('行情数值无效');
	const num = Number(value);
	if (!Number.isFinite(num)) throw new Error('行情数值无效');
	return num;
}

export function normalizeGenericTimestampSeconds(value: unknown): number {
	const raw = numeric(value);
	if (raw <= 0) throw new Error('行情时间无效');
	const seconds = raw >= 1e12 ? raw / 1000 : raw;
	if (!Number.isSafeInteger(seconds) || seconds <= 0) throw new Error('行情时间必须为整数 UTC 秒或毫秒');
	return seconds;
}

function normalizeGenericTimestampMs(value: unknown): number {
	const raw = numeric(value);
	if (raw <= 0) throw new Error('报价时间无效');
	return raw >= 1e12 ? Math.round(raw) : Math.round(raw * 1000);
}

function buildCandle(time: unknown, open: unknown, high: unknown, low: unknown, close: unknown, volume: unknown): Candle {
	const result: Candle = {
		time: normalizeGenericTimestampSeconds(time),
		open: numeric(open),
		high: numeric(high),
		low: numeric(low),
		close: numeric(close),
		volume: volume === undefined || volume === null ? 0 : numeric(volume),
	};
	if (result.low <= 0 || result.volume < 0 || result.high < Math.max(result.open, result.close) || result.low > Math.min(result.open, result.close)) {
		throw new Error('K 线数据无效');
	}
	return result;
}

export function parseGenericCandle(value: unknown): Candle {
	if (Array.isArray(value)) {
		if (value.length < 5) throw new Error('K 线数组字段不足');
		return buildCandle(value[0], value[1], value[2], value[3], value[4], value[5]);
	}
	const item = record(value);
	return buildCandle(
		item.time ?? item.t,
		item.open ?? item.o,
		item.high ?? item.h,
		item.low ?? item.l,
		item.close ?? item.c,
		item.volume ?? item.v,
	);
}

export function parseGenericCandles(value: unknown): Candle[] {
	let list: unknown;
	if (Array.isArray(value)) {
		list = value;
	} else {
		const obj = record(value);
		list = obj.candles ?? obj.data ?? obj.klines;
	}
	if (!Array.isArray(list)) throw new Error('通用协议 K 线响应必须为数组或包含 candles/data 数组');
	const unique = new Map<number, Candle>();
	for (const entry of list as unknown[]) {
		const item = parseGenericCandle(entry);
		unique.set(item.time, item);
	}
	return [...unique.values()].sort((a, b) => a.time - b.time);
}

function normalizeSymbol(raw: string): string {
	const trimmed = raw.trim().toUpperCase();
	if (/^[A-Z0-9]+-[A-Z0-9]+$/.test(trimmed)) return trimmed;
	throw new Error(`交易对格式无效：${raw}（需为 BASE-QUOTE，例如 BTC-USDT）`);
}

export function parseGenericInstruments(value: unknown, venue: string, market: Market): InstrumentInfo[] {
	let list: unknown;
	if (Array.isArray(value)) {
		list = value;
	} else {
		const obj = record(value);
		list = obj.instruments ?? obj.symbols ?? obj.data;
	}
	if (!Array.isArray(list)) throw new Error('通用协议交易对目录必须为数组或包含 instruments/data 数组');
	const result: InstrumentInfo[] = [];
	const seen = new Set<string>();
	for (const entry of list as unknown[]) {
		let symbol: string;
		let itemMarket: Market = market;
		let tickSize = 0.01;
		if (typeof entry === 'string') {
			try {
				symbol = normalizeSymbol(entry);
			} catch {
				continue;
			}
		} else {
			const obj = record(entry);
			if (typeof obj.symbol !== 'string') continue;
			if (obj.market !== undefined && obj.market !== 'spot' && obj.market !== 'perpetual') continue;
			if (obj.market !== undefined) itemMarket = obj.market;
			if (itemMarket !== market) continue;
			try {
				symbol = normalizeSymbol(obj.symbol);
			} catch {
				continue;
			}
			if (obj.tickSize !== undefined) {
				const parsedTick = numeric(obj.tickSize);
				if (parsedTick <= 0) continue;
				tickSize = parsedTick;
			}
		}
		const instrument: Instrument = { venue, market: itemMarket, symbol };
		const key = instrumentKey(instrument);
		if (seen.has(key)) continue;
		seen.add(key);
		result.push({ instrument, tickSize });
	}
	return result;
}

export function parseGenericQuote(value: unknown): MarketQuote {
	const root = record(value);
	const q = root.quote && typeof root.quote === 'object' && !Array.isArray(root.quote)
		? record(root.quote)
		: root.data && typeof root.data === 'object' && !Array.isArray(root.data)
			? record(root.data)
			: root;
	const price = numeric(q.price ?? q.lastPrice ?? q.close ?? q.c);
	const high = q.high !== undefined || q.highPrice !== undefined ? numeric(q.high ?? q.highPrice) : price;
	const low = q.low !== undefined || q.lowPrice !== undefined ? numeric(q.low ?? q.lowPrice) : price;
	const change = q.change !== undefined || q.priceChange !== undefined ? numeric(q.change ?? q.priceChange) : 0;
	const percent = q.percent !== undefined || q.priceChangePercent !== undefined ? numeric(q.percent ?? q.priceChangePercent) : 0;
	const updatedAt = q.updatedAt !== undefined || q.time !== undefined || q.timestamp !== undefined
		? normalizeGenericTimestampMs(q.updatedAt ?? q.time ?? q.timestamp)
		: Date.now();
	if (price <= 0 || low <= 0 || high < low) throw new Error('通用协议报价数据无效');
	return { price, change, percent, high, low, updatedAt };
}

function symbolMatches(rawSymbol: unknown, targetSymbol: string): boolean {
	if (typeof rawSymbol !== 'string') return false;
	const normalized = rawSymbol.trim().toUpperCase();
	return normalized === targetSymbol || normalized === targetSymbol.replace('-', '');
}

export function parseGenericKlineEvent(value: unknown, instrument: Instrument, timeframe: Timeframe): CandleEvent | null {
	const msg = record(value);
	if (msg.type !== undefined && msg.type !== 'kline' && msg.channel !== 'kline') return null;
	if (!symbolMatches(msg.symbol ?? msg.s, instrument.symbol)) return null;
	if (msg.market !== undefined && msg.market !== instrument.market) return null;
	const msgInterval = msg.interval ?? msg.timeframe ?? msg.i;
	if (msgInterval !== undefined && msgInterval !== timeframe) return null;
	const candlePayload = msg.candle ?? msg.k ?? msg;
	const parsed = parseGenericCandle(candlePayload);
	const eventTime = msg.eventTime !== undefined || msg.E !== undefined
		? normalizeGenericTimestampMs(msg.eventTime ?? msg.E)
		: Date.now();
	return { candle: parsed, eventTime };
}

export class GenericMarketProvider implements MarketFeedProvider {
	readonly id: string;
	readonly venue: string;
	readonly label: string;
	readonly protocol = 'generic' as const;
	readonly maxCandleLimit = 500;
	readonly realtime: boolean;
	private readonly baseUrl: string;

	constructor(
		private readonly config: GenericProviderConfig,
		private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
		private readonly socketFactory?: SocketFactory,
	) {
		this.venue = config.venue;
		this.id = `generic:${config.venue}`;
		this.label = config.label;
		this.realtime = Boolean(config.wsUrl.trim());
		this.baseUrl = config.restBaseUrl.trim().replace(/\/+$/, '');
	}

	private async request(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<{ status: number; body: unknown }> {
		signal?.throwIfAborted();
		const query = new URLSearchParams(params).toString();
		const url = `${this.baseUrl}/${path}${query ? `?${query}` : ''}`;
		const controller = new AbortController();
		const abort = (): void => controller.abort(signal?.reason);
		signal?.addEventListener('abort', abort, { once: true });
		const timeout = setTimeout(() => controller.abort(new Error(`${this.label} 请求超时`)), 12000);
		try {
			const response = await this.fetcher(url, { signal: controller.signal, credentials: 'omit' });
			if (response.status === 404 || response.status === 405 || response.status === 501) {
				return { status: response.status, body: null };
			}
			if (!response.ok) {
				if (response.status === 429) {
					const header = response.headers.get('Retry-After');
					const delay = header && Number.isFinite(Number(header)) ? Number(header) * 1000 : 15000;
					throw new MarketDataError(`${this.label} 请求限流，稍后自动重试`, Math.max(1000, delay));
				}
				throw new MarketDataError(`${this.label} 行情请求失败 (${response.status})`);
			}
			return { status: response.status, body: await response.json() as unknown };
		} catch (error) {
			if (signal?.aborted || error instanceof MarketDataError) throw error;
			if (controller.signal.aborted && controller.signal.reason instanceof Error) throw controller.signal.reason;
			if (error instanceof TypeError) {
				throw new MarketDataError(`无法连接 ${this.label}（请检查地址、网络或服务端 CORS 配置）`);
			}
			throw error;
		} finally {
			clearTimeout(timeout);
			signal?.removeEventListener('abort', abort);
		}
	}

	private assertInstrument(instrument: Instrument): void {
		instrumentKey(instrument);
		if (instrument.venue !== this.venue) {
			throw new MarketDataError(`交易对不属于数据源 ${this.label}`);
		}
		if (!this.config.markets.includes(instrument.market)) {
			throw new MarketDataError(`${this.label} 未启用${instrument.market === 'spot' ? '现货' : '永续'}市场`);
		}
	}

	async getCandles(instrument: Instrument, timeframe: Timeframe, signal?: AbortSignal, query: CandleQuery = {}): Promise<Candle[]> {
		this.assertInstrument(instrument);
		const params: Record<string, string> = {
			symbol: instrument.symbol,
			market: instrument.market,
			interval: timeframe,
			limit: String(Math.min(this.maxCandleLimit, Math.max(1, query.limit ?? this.maxCandleLimit))),
		};
		if (query.before !== undefined) params.before = String(query.before);
		if (query.after !== undefined) params.after = String(query.after);
		const res = await this.request('klines', params, signal);
		if (res.status === 404 || res.status === 405 || res.status === 501) {
			throw new MarketDataError(`${this.label} 未实现 /klines 接口 (${res.status})`);
		}
		return parseGenericCandles(res.body);
	}

	async getInstruments(market: Market, signal?: AbortSignal): Promise<InstrumentInfo[]> {
		if (!this.config.markets.includes(market)) return [];
		const fallback = (): InstrumentInfo[] => this.config.defaultSymbols.map(symbol => ({
			instrument: { venue: this.venue, market, symbol },
			tickSize: 0.01,
		}));
		const res = await this.request('instruments', { market }, signal);
		if (res.status === 404 || res.status === 405 || res.status === 501) {
			return fallback();
		}
		const parsed = parseGenericInstruments(res.body, this.venue, market);
		return parsed.length > 0 ? parsed : fallback();
	}

	async getQuote(instrument: Instrument, signal?: AbortSignal): Promise<MarketQuote> {
		this.assertInstrument(instrument);
		const res = await this.request('ticker', { symbol: instrument.symbol, market: instrument.market }, signal);
		if (res.status === 404 || res.status === 405 || res.status === 501) {
			// Minimal kline-only generic server fallback: derive latest quote from the last 2 bars.
			const bars = await this.getCandles(instrument, '1d', signal, { limit: 2 });
			const latest = bars.at(-1);
			if (!latest) throw new MarketDataError(`${this.label} 暂无报价数据`);
			const prevClose = bars.length >= 2 ? bars[bars.length - 2].close : latest.open;
			const change = latest.close - prevClose;
			const percent = prevClose > 0 ? (change / prevClose) * 100 : 0;
			return {
				price: latest.close,
				change,
				percent,
				high: latest.high,
				low: latest.low,
				updatedAt: Date.now(),
			};
		}
		return parseGenericQuote(res.body);
	}

	subscribeCandles(instrument: Instrument, timeframe: Timeframe, observer: StreamObserver<CandleEvent>): () => void {
		this.assertInstrument(instrument);
		const wsUrl = this.config.wsUrl.trim();
		if (wsUrl) {
			return connectStream(wsUrl, {
				...observer,
				onData: value => {
					try {
						const event = parseGenericKlineEvent(value, instrument, timeframe);
						if (event) observer.onData(event);
					} catch {
						// Ignore unrelated or malformed auxiliary WS frames (e.g. ack/pong).
					}
				},
			}, this.socketFactory, { retry: 1000, watchdog: 45000 }, {
				unwrapData: false,
				onConnect: socket => {
					socket.send?.(JSON.stringify({
						type: 'subscribe',
						channel: 'kline',
						symbol: instrument.symbol,
						market: instrument.market,
						interval: timeframe,
					}));
				},
			});
		}

		// HTTP-only polling mode when no WebSocket endpoint is configured.
		let stopped = false;
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const pollMs = Math.max(2000, Math.min(60000, this.config.pollIntervalMs));

		const poll = async (): Promise<void> => {
			if (stopped) return;
			try {
				const latest = await this.getCandles(instrument, timeframe, controller.signal, { limit: 2 });
				if (stopped) return;
				const last = latest.at(-1);
				if (last) {
					observer.onData({ candle: last, eventTime: Date.now() });
				}
			} catch {
				if (!stopped) observer.onState('reconnecting', `${this.label} 轮询失败，重试中`);
			}
			if (!stopped) {
				timer = setTimeout(() => { void poll(); }, pollMs);
			}
		};

		timer = setTimeout(() => { void poll(); }, pollMs);
		return () => {
			stopped = true;
			clearTimeout(timer);
			controller.abort();
		};
	}

	subscribeQuotes(instruments: Instrument[], observer: StreamObserver<{ instrument: Instrument; quote: MarketQuote }>): () => void {
		const valid = instruments.filter(item => item.venue === this.venue && this.config.markets.includes(item.market));
		if (!valid.length) return () => undefined;
		const wsUrl = this.config.wsUrl.trim();
		if (wsUrl) {
			const byKey = new Map(valid.map(item => [`${item.market}:${item.symbol}`, item]));
			const bySymbol = new Map(valid.map(item => [item.symbol, item]));
			return connectStream(wsUrl, {
				...observer,
				onData: value => {
					try {
						const msg = record(value);
						if (msg.type !== undefined && msg.type !== 'ticker' && msg.channel !== 'ticker') return;
						const rawSymbol = typeof msg.symbol === 'string' ? msg.symbol.trim().toUpperCase() : '';
						const rawMarket = msg.market === 'spot' || msg.market === 'perpetual' ? msg.market : valid[0].market;
						const target = byKey.get(`${rawMarket}:${rawSymbol}`) ?? bySymbol.get(rawSymbol);
						if (!target) return;
						observer.onData({ instrument: target, quote: parseGenericQuote(msg) });
					} catch {
						// Ignore non-ticker frames.
					}
				},
			}, this.socketFactory, { retry: 1000, watchdog: 45000 }, {
				unwrapData: false,
				onConnect: socket => {
					socket.send?.(JSON.stringify({
						type: 'subscribe',
						channel: 'ticker',
						market: valid[0].market,
						symbols: valid.map(item => item.symbol),
					}));
				},
			});
		}

		// HTTP-only quote polling fallback.
		let stopped = false;
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const pollMs = Math.max(5000, Math.min(60000, this.config.pollIntervalMs));

		const poll = async (): Promise<void> => {
			if (stopped) return;
			for (let i = 0; i < valid.length && !stopped; i += 3) {
				await Promise.all(valid.slice(i, i + 3).map(async instrument => {
					try {
						const quote = await this.getQuote(instrument, controller.signal);
						if (!stopped) observer.onData({ instrument, quote });
					} catch {
						// Individual quote polling error is tolerated.
					}
				}));
			}
			if (!stopped) {
				timer = setTimeout(() => { void poll(); }, pollMs);
			}
		};

		timer = setTimeout(() => { void poll(); }, pollMs);
		return () => {
			stopped = true;
			clearTimeout(timer);
			controller.abort();
		};
	}
}
