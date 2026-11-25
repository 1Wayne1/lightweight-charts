export const TIMEFRAMES = [
	'1m', '3m', '5m', '15m', '30m',
	'1h', '2h', '4h', '6h', '8h', '12h',
	'1d', '3d', '1w', '1M',
] as const;
export type Timeframe = typeof TIMEFRAMES[number];
export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
	'1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
	'1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600, '8h': 28800, '12h': 43200,
	'1d': 86400, '3d': 259200, '1w': 604800, '1M': 2592000,
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

export function parseInstrumentKey(key: string): Instrument {
	const parts = key.split(':');
	if (parts.length !== 3) throw new Error('Invalid instrument key');
	const [venue, market, symbol] = parts;
	if (market !== 'spot' && market !== 'perpetual') throw new Error('Invalid instrument market');
	const instrument: Instrument = { venue, market, symbol };
	if (instrumentKey(instrument) !== key) throw new Error('Invalid instrument key');
	return instrument;
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

/** Optimistic concurrency envelope; revision is assigned by the server. */
export interface SyncMutation<T> {
	mutationId: string;
	deviceId: string;
	baseRevision: number;
	value: T;
}

export const SYNC_SETTING_KEYS = ['indicators', 'timeframes', 'drawing-defaults', 'watchlist', 'workspace-tabs', 'custom-colors'] as const;
export type SyncSettingKey = typeof SYNC_SETTING_KEYS[number];

export interface WorkspaceTabsSnapshot {
	schemaVersion: 1;
	tabs: ChartTab[];
	activeTabId: string | null;
}

export interface SyncedInstrumentState {
	instrumentKey: string;
	instrument: Instrument;
	timeframe: Timeframe;
	revision: number;
	updatedAt: string;
}

export interface SyncedDrawingRecord extends DrawingDocument {
	updatedAt: string;
}

export interface SyncedSettingRecord {
	key: SyncSettingKey;
	value: Record<string, unknown>;
	revision: number;
	updatedAt: string;
}

export interface SyncSnapshot {
	schemaVersion: 1;
	storeId: string;
	exportedAt: string;
	instruments: SyncedInstrumentState[];
	drawings: SyncedDrawingRecord[];
	settings: Record<string, SyncedSettingRecord>;
}

export interface SyncCapabilities {
	apiVersion: 1;
	mode: 'single-user';
	storage: 'sqlite';
	storeId: string;
	authentication: 'token' | 'local';
	sync: boolean;
	backup: boolean;
	staticWeb: boolean;
	marketRelay?: {
		enabled: boolean;
		binance: boolean;
	};
}

export type PendingSyncMutation =
	| {
		mutationId: string;
		kind: 'preference';
		instrumentKey: string;
		baseRevision: number;
		timeframe: Timeframe;
		queuedAt: number;
	}
	| {
		mutationId: string;
		kind: 'drawing';
		instrumentKey: string;
		drawingId: string;
		baseRevision: number;
		document: DrawingDocument;
		queuedAt: number;
	}
	| {
		mutationId: string;
		kind: 'setting';
		key: SyncSettingKey;
		baseRevision: number;
		value: Record<string, unknown>;
		queuedAt: number;
	};

export type SyncStatusState =
	| 'disabled'
	| 'syncing'
	| 'synced'
	| 'offline'
	| 'pending'
	| 'conflict'
	| 'auth_error'
	| 'store_mismatch'
	| 'error';

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

/** Move a tab to its final index without changing the active chart or instrument preferences. */
export function moveTab(state: Workspace, tabId: string, targetIndex: number): Workspace {
	const from = state.tabs.findIndex(tab => tab.id === tabId);
	if (from < 0 || !Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= state.tabs.length || from === targetIndex) {
		return state;
	}
	const tabs = [...state.tabs];
	const [tab] = tabs.splice(from, 1);
	tabs.splice(targetIndex, 0, tab);
	return { ...state, tabs };
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

/** Validate synced open tabs & active tab layout independently of instrument preferences. */
export function parseWorkspaceTabsSnapshot(value: unknown): WorkspaceTabsSnapshot {
	if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.tabs) || value.tabs.length > 100) {
		throw new Error('Invalid workspace tabs snapshot');
	}
	const ids = new Set<string>();
	const keys = new Set<string>();
	const tabs = value.tabs.map((tab: unknown): ChartTab => {
		if (!isRecord(tab) || typeof tab.id !== 'string' || !tab.id ||
			typeof tab.instrumentKey !== 'string' || ids.has(tab.id) || keys.has(tab.instrumentKey)) {
			throw new Error('Invalid or duplicate synced tab');
		}
		parseInstrumentKey(tab.instrumentKey);
		ids.add(tab.id);
		keys.add(tab.instrumentKey);
		return { id: tab.id, instrumentKey: tab.instrumentKey };
	});
	if ((tabs.length === 0 && value.activeTabId !== null) ||
		(tabs.length > 0 && (typeof value.activeTabId !== 'string' || !ids.has(value.activeTabId)))) {
		throw new Error('Invalid synced active tab');
	}
	return { schemaVersion: 1, tabs, activeTabId: value.activeTabId as string | null };
}

/** Validate a portable or server sync snapshot at runtime. */
export function parseSyncSnapshot(value: unknown): SyncSnapshot {
	if (!isRecord(value) || value.schemaVersion !== 1 ||
		typeof value.storeId !== 'string' || !/^[\w-]{1,128}$/.test(value.storeId) ||
		typeof value.exportedAt !== 'string' || !value.exportedAt ||
		!Array.isArray(value.instruments) || !Array.isArray(value.drawings)) {
		throw new Error('Invalid sync snapshot or unsupported schema');
	}
	const instrumentKeys = new Set<string>();
	const instruments: SyncedInstrumentState[] = value.instruments.map((entry: unknown): SyncedInstrumentState => {
		if (!isRecord(entry) || typeof entry.instrumentKey !== 'string' ||
			!TIMEFRAMES.some(tf => tf === entry.timeframe) ||
			!Number.isSafeInteger(entry.revision) || Number(entry.revision) < 0 ||
			typeof entry.updatedAt !== 'string' || !entry.updatedAt) {
			throw new Error('Invalid synced instrument state');
		}
		const instrument = parseInstrumentKey(entry.instrumentKey);
		if (instrumentKeys.has(entry.instrumentKey)) throw new Error('Duplicate instrument in snapshot');
		instrumentKeys.add(entry.instrumentKey);
		return {
			instrumentKey: entry.instrumentKey,
			instrument,
			timeframe: entry.timeframe as Timeframe,
			revision: Number(entry.revision),
			updatedAt: entry.updatedAt,
		};
	});
	const drawingIds = new Set<string>();
	const drawings: SyncedDrawingRecord[] = value.drawings.map((entry: unknown): SyncedDrawingRecord => {
		if (!isRecord(entry) || entry.schemaVersion !== 1 ||
			typeof entry.id !== 'string' || !/^[\w-]{1,128}$/.test(entry.id) || drawingIds.has(entry.id) ||
			typeof entry.instrumentKey !== 'string' ||
			typeof entry.kind !== 'string' || !entry.kind ||
			!Array.isArray(entry.anchors) || entry.anchors.length > 2000 ||
			!isRecord(entry.style) ||
			!Number.isSafeInteger(entry.revision) || Number(entry.revision) < 0 ||
			typeof entry.deleted !== 'boolean' ||
			typeof entry.updatedAt !== 'string' || !entry.updatedAt) {
			throw new Error('Invalid synced drawing record');
		}
		parseInstrumentKey(entry.instrumentKey);
		drawingIds.add(entry.id);
		const anchors = entry.anchors.map((anchor: unknown) => {
			if (!isRecord(anchor) || typeof anchor.time !== 'number' || !Number.isFinite(anchor.time) ||
				typeof anchor.price !== 'number' || !Number.isFinite(anchor.price)) {
				throw new Error('Invalid drawing anchor');
			}
			return { time: anchor.time, price: anchor.price };
		});
		return {
			schemaVersion: 1,
			id: entry.id,
			instrumentKey: entry.instrumentKey,
			kind: entry.kind,
			anchors,
			style: structuredClone(entry.style),
			revision: Number(entry.revision),
			deleted: entry.deleted,
			updatedAt: entry.updatedAt,
		};
	});
	const settings: Record<string, SyncedSettingRecord> = {};
	const rawSettings = value.settings === undefined ? {} : value.settings;
	if (!isRecord(rawSettings)) throw new Error('Invalid synced settings');
	for (const [key, entry] of Object.entries(rawSettings)) {
		if (!SYNC_SETTING_KEYS.some(allowed => allowed === key)) throw new Error(`Unsupported setting key: ${key}`);
		if (!isRecord(entry) || !isRecord(entry.value) ||
			!Number.isSafeInteger(entry.revision) || Number(entry.revision) < 0 ||
			typeof entry.updatedAt !== 'string' || !entry.updatedAt) {
			throw new Error('Invalid synced setting entry');
		}
		settings[key] = {
			key: key as SyncSettingKey,
			value: structuredClone(entry.value),
			revision: Number(entry.revision),
			updatedAt: entry.updatedAt,
		};
	}
	return {
		schemaVersion: 1,
		storeId: value.storeId,
		exportedAt: value.exportedAt,
		instruments,
		drawings,
		settings,
	};
}
