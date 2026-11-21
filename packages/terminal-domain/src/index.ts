export const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
export type Timeframe = typeof TIMEFRAMES[number];
export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
	'1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400,
};

export interface Instrument {
	venue: string;
	market: 'spot' | 'perpetual';
	symbol: string;
}

/** Exchange + market + symbol; BTC spot and perpetual must never share drawings. */
export function instrumentKey(instrument: Instrument): string {
	if (!/^[a-z0-9-]+$/.test(instrument.venue) ||
		!['spot', 'perpetual'].includes(instrument.market) ||
		!/^[A-Z0-9]+-[A-Z0-9]+$/.test(instrument.symbol)) {
		throw new Error('Invalid instrument');
	}
	return `${instrument.venue}:${instrument.market}:${instrument.symbol}`;
}

export interface InstrumentPreferences {
	instrument: Instrument;
	timeframe: Timeframe;
}

export interface ChartTab {
	id: string;
	instrumentKey: string;
}

export interface Workspace {
	schemaVersion: 1;
	tabs: ChartTab[];
	activeTabId: string | null;
	preferences: Record<string, InstrumentPreferences>;
}

/** Drawing contract. Tool kinds/styles are validated against the client tool registry. Time is UTC epoch seconds, including future anchors. */
export interface DrawingDocument {
	schemaVersion: 1;
	id: string;
	instrumentKey: string;
	kind: string;
	anchors: { time: number; price: number }[];
	style: Record<string, unknown>;
	revision: number;
	deleted: boolean;
}

/** Planned optimistic concurrency envelope; revision is assigned by the server. */
export interface SyncMutation<T> {
	mutationId: string;
	deviceId: string;
	baseRevision: number;
	value: T;
}

export interface Candle {
	time: number;
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number;
}

export interface CandleQuery { before?: number; after?: number; limit?: number; }
export interface MarketQuote {
	price: number; change: number; percent: number; high: number; low: number; updatedAt: number;
}
export interface InstrumentInfo { instrument: Instrument; tickSize: number; }
export interface CandleEvent { candle: Candle; eventTime: number; }
export type ConnectionState = 'connecting' | 'syncing' | 'live' | 'reconnecting' | 'error';
export interface StreamObserver<T> {
	onData(value: T): void;
	onOpen(): void;
	onState(state: ConnectionState, message?: string): void;
}
export interface MarketDataProvider {
	getCandles(instrument: Instrument, timeframe: Timeframe, signal?: AbortSignal, query?: CandleQuery): Promise<Candle[]>;
}

export function emptyWorkspace(): Workspace {
	return { schemaVersion: 1, tabs: [], activeTabId: null, preferences: {} };
}

/** V1 keeps one tab per instrument. Reopening focuses the existing tab. */
export function openInstrument(state: Workspace, instrument: Instrument): Workspace {
	const key = instrumentKey(instrument);
	const existing = state.tabs.find(tab => tab.instrumentKey === key);
	if (existing) {
		return { ...state, activeTabId: existing.id };
	}
	return {
		...state,
		tabs: [...state.tabs, { id: key, instrumentKey: key }],
		activeTabId: key,
		preferences: {
			...state.preferences,
			[key]: state.preferences[key] ?? { instrument: { ...instrument }, timeframe: '1h' },
		},
	};
}

export function setTimeframe(state: Workspace, tabId: string, timeframe: Timeframe): Workspace {
	if (!TIMEFRAMES.includes(timeframe)) {
		throw new Error('Unsupported timeframe');
	}
	const tab = state.tabs.find(item => item.id === tabId);
	if (!tab) {
		throw new Error('Unknown tab');
	}
	return {
		...state,
		preferences: {
			...state.preferences,
			[tab.instrumentKey]: { ...state.preferences[tab.instrumentKey], timeframe },
		},
	};
}

export function closeTab(state: Workspace, tabId: string): Workspace {
	const index = state.tabs.findIndex(tab => tab.id === tabId);
	if (index < 0) {
		return state;
	}
	const tabs = state.tabs.filter(tab => tab.id !== tabId);
	return {
		...state,
		tabs,
		activeTabId: state.activeTabId === tabId
			? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null) : state.activeTabId,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate persisted data and construct a fresh object; never trust JSON as Workspace. */
export function parseWorkspace(value: unknown): Workspace {
	if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.tabs) ||
		!isRecord(value.preferences) || value.tabs.length > 100) {
		throw new Error('Invalid workspace or unsupported schema');
	}
	const preferences: Workspace['preferences'] = {};
	for (const [key, preference] of Object.entries(value.preferences)) {
		if (!isRecord(preference) || !isRecord(preference.instrument)) {
			throw new Error('Invalid preferences');
		}
		const instrument = preference.instrument;
		if (typeof instrument.venue !== 'string' || typeof instrument.symbol !== 'string' ||
			(instrument.market !== 'spot' && instrument.market !== 'perpetual') ||
			!TIMEFRAMES.some(timeframe => timeframe === preference.timeframe)) {
			throw new Error('Invalid instrument preferences');
		}
		const parsed: Instrument = { venue: instrument.venue, symbol: instrument.symbol, market: instrument.market };
		if (instrumentKey(parsed) !== key) {
			throw new Error('Instrument key mismatch');
		}
		preferences[key] = { instrument: parsed, timeframe: preference.timeframe as Timeframe };
	}
	const ids = new Set<string>();
	const keys = new Set<string>();
	const tabs = value.tabs.map((tab: unknown): ChartTab => {
		if (!isRecord(tab) || typeof tab.id !== 'string' || !tab.id ||
			typeof tab.instrumentKey !== 'string' || !Object.hasOwn(preferences, tab.instrumentKey) ||
			ids.has(tab.id) || keys.has(tab.instrumentKey)) {
			throw new Error('Invalid or duplicate tab');
		}
		ids.add(tab.id);
		keys.add(tab.instrumentKey);
		return { id: tab.id, instrumentKey: tab.instrumentKey };
	});
	if ((tabs.length === 0 && value.activeTabId !== null) ||
		(tabs.length > 0 && (typeof value.activeTabId !== 'string' || !ids.has(value.activeTabId)))) {
		throw new Error('Invalid active tab');
	}
	return { schemaVersion: 1, tabs, activeTabId: value.activeTabId as string | null, preferences };
}
