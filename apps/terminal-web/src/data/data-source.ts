import type { Instrument } from '@terminal/domain';
import { requestMarketWsTicket } from '../sync/client';
import type { MarketRelayTarget } from '../sync/engine';
import { BinanceProvider, defaultEndpoints, type BinanceEndpoints, type BinanceRelayOptions } from './binance';
import { GenericMarketProvider, type GenericProviderConfig } from './generic-provider';
import type { Market, MarketFeedProvider } from './provider';
import type { SocketFactory } from './stream';

export const DATA_SOURCE_STORAGE_KEY = 'crypto-terminal.data-source.v1';

export type DataSourceType = 'binance' | 'generic';
export type BinanceTransportMode = 'relay' | 'direct';

export interface BinanceSourceSettings extends BinanceEndpoints {
	transport: BinanceTransportMode;
}

export interface DataSourceSettings {
	schemaVersion: 1;
	activeType: DataSourceType;
	binance: BinanceSourceSettings;
	generic: GenericProviderConfig;
}

export interface ProviderRegistry {
	readonly settings: DataSourceSettings;
	readonly active: MarketFeedProvider;
	readonly binance: BinanceProvider;
	readonly generic?: GenericMarketProvider;
	resolve(venue: string): MarketFeedProvider | undefined;
	labelForVenue(venue: string): string;
}

export interface DataSourceTestResult {
	ok: true;
	latencyMs: number;
	summary: string;
}

export const DEFAULT_GENERIC_SYMBOLS = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'BNB-USDT'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateHttpUrl(raw: string, fieldName: string, required = true): string {
	const trimmed = raw.trim().replace(/\/+$/, '');
	if (!trimmed) {
		if (required) throw new Error(`请填写${fieldName}`);
		return '';
	}
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new Error(`${fieldName}格式无效，请以 http:// 或 https:// 开头`);
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new Error(`${fieldName}仅支持 http:// 或 https:// 协议`);
	}
	return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
}

export function validateWsUrl(raw: string, fieldName: string, required = true): string {
	const trimmed = raw.trim().replace(/\/+$/, '');
	if (!trimmed) {
		if (required) throw new Error(`请填写${fieldName}`);
		return '';
	}
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new Error(`${fieldName}格式无效，请以 ws:// 或 wss:// 开头`);
	}
	if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
		throw new Error(`${fieldName}仅支持 ws:// 或 wss:// 协议`);
	}
	return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
}

export function validateGenericVenue(raw: string): string {
	const venue = raw.trim().toLowerCase();
	if (!/^[a-z0-9-]{2,32}$/.test(venue)) {
		throw new Error('数据源标识仅支持 2-32 位小写字母、数字或连字符（例如 custom、my-feed）');
	}
	if (venue === 'binance') {
		throw new Error('通用协议源标识不能使用保留名称 binance，以确保画线与币安数据严格隔离');
	}
	return venue;
}

export function parseDefaultSymbolList(raw: string | readonly string[]): string[] {
	const entries = Array.isArray(raw)
		? raw
		: String(raw).split(/[\s,，;；]+/);
	const seen = new Set<string>();
	const result: string[] = [];
	for (const entry of entries) {
		const normalized = String(entry).trim().toUpperCase();
		if (!normalized) continue;
		if (!/^[A-Z0-9]+-[A-Z0-9]+$/.test(normalized)) {
			throw new Error(`备用交易对格式无效：${normalized}（需为 BASE-QUOTE，例如 BTC-USDT）`);
		}
		if (seen.has(normalized)) continue;
		seen.add(normalized);
		result.push(normalized);
	}
	return result.length > 0 ? result : [...DEFAULT_GENERIC_SYMBOLS];
}

function hasCustomBinanceEndpoints(endpoints: BinanceEndpoints): boolean {
	return endpoints.spotRest !== defaultEndpoints.spotRest ||
		endpoints.perpetualRest !== defaultEndpoints.perpetualRest ||
		endpoints.spotWs !== defaultEndpoints.spotWs ||
		endpoints.perpetualWs !== defaultEndpoints.perpetualWs;
}

export function defaultDataSourceSettings(env?: Partial<BinanceEndpoints>): DataSourceSettings {
	const endpoints: BinanceEndpoints = {
		spotRest: env?.spotRest?.trim() || defaultEndpoints.spotRest,
		perpetualRest: env?.perpetualRest?.trim() || defaultEndpoints.perpetualRest,
		spotWs: env?.spotWs?.trim() || defaultEndpoints.spotWs,
		perpetualWs: env?.perpetualWs?.trim() || defaultEndpoints.perpetualWs,
	};
	return {
		schemaVersion: 1,
		activeType: 'binance',
		binance: {
			...endpoints,
			transport: hasCustomBinanceEndpoints(endpoints) ? 'direct' : 'relay',
		},
		generic: {
			venue: 'custom',
			label: '自定义行情源',
			restBaseUrl: '',
			wsUrl: '',
			pollIntervalMs: 5000,
			markets: ['spot', 'perpetual'],
			defaultSymbols: [...DEFAULT_GENERIC_SYMBOLS],
		},
	};
}

export function parseDataSourceSettings(raw: unknown, env?: Partial<BinanceEndpoints>): DataSourceSettings {
	const defaults = defaultDataSourceSettings(env);
	if (!isRecord(raw) || raw.schemaVersion !== 1) {
		throw new Error('数据源配置格式无效或版本不受支持');
	}
	const activeType: DataSourceType = raw.activeType === 'generic' ? 'generic' : raw.activeType === 'binance' ? 'binance' : (() => {
		throw new Error('不支持的数据源类型');
	})();

	const rawBinance = isRecord(raw.binance) ? raw.binance : {};
	const binanceEndpoints: BinanceEndpoints = {
		spotRest: validateHttpUrl(typeof rawBinance.spotRest === 'string' && rawBinance.spotRest.trim() ? rawBinance.spotRest : defaults.binance.spotRest, 'Binance 现货 REST 地址'),
		perpetualRest: validateHttpUrl(typeof rawBinance.perpetualRest === 'string' && rawBinance.perpetualRest.trim() ? rawBinance.perpetualRest : defaults.binance.perpetualRest, 'Binance 永续 REST 地址'),
		spotWs: validateWsUrl(typeof rawBinance.spotWs === 'string' && rawBinance.spotWs.trim() ? rawBinance.spotWs : defaults.binance.spotWs, 'Binance 现货 WebSocket 地址'),
		perpetualWs: validateWsUrl(typeof rawBinance.perpetualWs === 'string' && rawBinance.perpetualWs.trim() ? rawBinance.perpetualWs : defaults.binance.perpetualWs, 'Binance 永续 WebSocket 地址'),
	};
	const transport: BinanceTransportMode = rawBinance.transport === 'direct'
		? 'direct'
		: rawBinance.transport === 'relay'
			? 'relay'
			: (hasCustomBinanceEndpoints(binanceEndpoints) ? 'direct' : 'relay');
	const binance: BinanceSourceSettings = {
		...binanceEndpoints,
		transport,
	};

	const rawGeneric = isRecord(raw.generic) ? raw.generic : {};
	const venue = validateGenericVenue(typeof rawGeneric.venue === 'string' && rawGeneric.venue.trim() ? rawGeneric.venue : defaults.generic.venue);
	const label = typeof rawGeneric.label === 'string' && rawGeneric.label.trim() ? rawGeneric.label.trim().slice(0, 40) : defaults.generic.label;
	const restBaseUrl = validateHttpUrl(
		typeof rawGeneric.restBaseUrl === 'string' ? rawGeneric.restBaseUrl : '',
		'通用协议 REST 地址',
		activeType === 'generic',
	);
	const wsUrl = validateWsUrl(
		typeof rawGeneric.wsUrl === 'string' ? rawGeneric.wsUrl : '',
		'通用协议 WebSocket 地址',
		false,
	);
	const rawPoll = typeof rawGeneric.pollIntervalMs === 'number' ? rawGeneric.pollIntervalMs : Number(rawGeneric.pollIntervalMs ?? 5000);
	const pollIntervalMs = Number.isFinite(rawPoll) ? Math.max(2000, Math.min(60000, Math.round(rawPoll))) : 5000;

	const rawMarkets = Array.isArray(rawGeneric.markets) ? rawGeneric.markets : defaults.generic.markets;
	const markets = (['spot', 'perpetual'] as const).filter(market => rawMarkets.includes(market));
	if (markets.length === 0) throw new Error('通用协议源至少需要启用一种市场类型（现货或永续）');

	const defaultSymbols = Array.isArray(rawGeneric.defaultSymbols)
		? parseDefaultSymbolList(rawGeneric.defaultSymbols.map(String))
		: typeof rawGeneric.defaultSymbols === 'string'
			? parseDefaultSymbolList(rawGeneric.defaultSymbols)
			: [...DEFAULT_GENERIC_SYMBOLS];

	return {
		schemaVersion: 1,
		activeType,
		binance,
		generic: {
			venue,
			label,
			restBaseUrl,
			wsUrl,
			pollIntervalMs,
			markets,
			defaultSymbols,
		},
	};
}

export function loadDataSourceSettings(env?: Partial<BinanceEndpoints>): { settings: DataSourceSettings; corrupted: boolean } {
	try {
		const raw = localStorage.getItem(DATA_SOURCE_STORAGE_KEY);
		if (!raw) return { settings: defaultDataSourceSettings(env), corrupted: false };
		return { settings: parseDataSourceSettings(JSON.parse(raw), env), corrupted: false };
	} catch {
		return { settings: defaultDataSourceSettings(env), corrupted: true };
	}
}

export function saveDataSourceSettings(settings: DataSourceSettings): void {
	const validated = parseDataSourceSettings(settings);
	localStorage.setItem(DATA_SOURCE_STORAGE_KEY, JSON.stringify(validated));
}

export function buildBinanceRelayProvider(
	relayTarget: MarketRelayTarget,
	fetcher?: typeof fetch,
	socketFactory?: SocketFactory,
): BinanceProvider {
	if (!relayTarget.ready) {
		return new BinanceProvider(defaultEndpoints, fetcher, socketFactory, {
			label: 'Binance (服务中继)',
			notReadyMessage: relayTarget.reason ?? '等待连接行情中继服务…',
			waiting: relayTarget.checking,
		});
	}
	const httpBase = relayTarget.baseUrl.replace(/\/+$/, '');
	const wsBase = httpBase.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');
	const endpoints: BinanceEndpoints = {
		spotRest: `${httpBase}/v1/market/binance/spot`,
		perpetualRest: `${httpBase}/v1/market/binance/perpetual`,
		spotWs: `${wsBase}/v1/market/binance/spot`,
		perpetualWs: `${wsBase}/v1/market/binance/perpetual`,
	};
	const auth = relayTarget.auth;
	const relayOptions: BinanceRelayOptions = {
		label: 'Binance (服务中继)',
		headers: (): Record<string, string> => (auth.mode === 'local'
			? { 'X-Terminal-Local': '1' }
			: { Authorization: `Bearer ${auth.token}` }),
		resolveWsUrl: auth.mode === 'token'
			? async rawUrl => {
				const ticket = await requestMarketWsTicket(httpBase, auth, fetcher ?? fetch);
				const sep = rawUrl.includes('?') ? '&' : '?';
				return `${rawUrl}${sep}ticket=${encodeURIComponent(ticket)}`;
			}
			: undefined,
	};
	return new BinanceProvider(endpoints, fetcher, socketFactory, relayOptions);
}

export function createProviderRegistry(
	settings: DataSourceSettings,
	fetcher?: typeof fetch,
	socketFactory?: SocketFactory,
	relayTarget?: MarketRelayTarget,
): ProviderRegistry {
	const binance = settings.binance.transport === 'relay' && relayTarget
		? buildBinanceRelayProvider(relayTarget, fetcher, socketFactory)
		: new BinanceProvider(settings.binance, fetcher, socketFactory);
	const generic = settings.generic.restBaseUrl
		? new GenericMarketProvider(settings.generic, fetcher, socketFactory)
		: undefined;
	const active: MarketFeedProvider = settings.activeType === 'generic' && generic ? generic : binance;

	return {
		settings,
		active,
		binance,
		generic,
		resolve(venue: string): MarketFeedProvider | undefined {
			if (venue === 'binance') return binance;
			if (generic && venue === generic.venue) return generic;
			return undefined;
		},
		labelForVenue(venue: string): string {
			if (venue === 'binance') return binance.label;
			if (generic && venue === generic.venue) return generic.label;
			return venue.toUpperCase();
		},
	};
}

export async function testDataSourceConnection(
	settings: DataSourceSettings,
	type: DataSourceType,
	fetcher?: typeof fetch,
	relayTarget?: MarketRelayTarget,
): Promise<DataSourceTestResult> {
	const validated = parseDataSourceSettings({ ...settings, activeType: type });
	const startedAt = Date.now();
	if (type === 'binance') {
		const provider = validated.binance.transport === 'relay' && relayTarget
			? buildBinanceRelayProvider(relayTarget, fetcher)
			: new BinanceProvider(validated.binance, fetcher);
		const spotInstrument: Instrument = { venue: 'binance', market: 'spot', symbol: 'BTC-USDT' };
		const perpInstrument: Instrument = { venue: 'binance', market: 'perpetual', symbol: 'BTC-USDT' };
		const [spotCandles, perpResult] = await Promise.all([
			provider.getCandles(spotInstrument, '1h', undefined, { limit: 2 }),
			provider.getCandles(perpInstrument, '1h', undefined, { limit: 2 }).then(
				bars => ({ ok: true as const, count: bars.length }),
				error => ({ ok: false as const, message: error instanceof Error ? error.message : '永续接口不可达' }),
			),
		]);
		const latencyMs = Math.max(1, Date.now() - startedAt);
		if (!spotCandles.length) throw new Error('Binance 现货返回空 K 线数据');
		const modeNote = validated.binance.transport === 'relay' && relayTarget ? '服务中继 · ' : '';
		const perpNote = perpResult.ok ? '现货与 USDT 永续均正常' : `现货正常；永续异常（${perpResult.message}）`;
		return { ok: true, latencyMs, summary: `连接成功（${modeNote}${latencyMs}ms · ${perpNote}）` };
	}

	const provider = new GenericMarketProvider(validated.generic, fetcher);
	const testMarket: Market = validated.generic.markets[0] ?? 'spot';
	const instruments = await provider.getInstruments(testMarket);
	const sampleInstrument: Instrument = instruments[0]?.instrument ?? {
		venue: validated.generic.venue,
		market: testMarket,
		symbol: validated.generic.defaultSymbols[0] ?? 'BTC-USDT',
	};
	const candles = await provider.getCandles(sampleInstrument, '1h', undefined, { limit: 5 });
	const latencyMs = Math.max(1, Date.now() - startedAt);
	if (!candles.length) throw new Error(`接口可达，但 ${sampleInstrument.symbol} 返回了空 K 线列表`);
	const modeText = validated.generic.wsUrl ? 'REST + WebSocket' : `REST 轮询（${Math.round(validated.generic.pollIntervalMs / 1000)}s）`;
	return {
		ok: true,
		latencyMs,
		summary: `连接成功（${latencyMs}ms · ${sampleInstrument.symbol} 读取 ${candles.length} 根 K 线 · ${modeText}）`,
	};
}
