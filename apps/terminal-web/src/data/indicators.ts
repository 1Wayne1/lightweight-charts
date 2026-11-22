import type { Candle } from '@terminal/domain';
import { EMA, RSI, SMA } from 'trading-signals';
import { INDICATOR_CATALOG, defaultParamsFor, getCatalogIndicator } from './indicator-catalog';

export const MAX_MA_LINES = 5;
export const INDICATOR_STORAGE_KEY = 'crypto-terminal.indicators.v1';
export type PaneId = string; // 'price' or any catalog pane indicator id (e.g. 'macd', 'rsi', 'kdj', ...)

export interface MovingAverageLineConfig {
	id: string;
	period: number;
	color: string;
	visible: boolean;
}

export interface IndicatorSettings {
	schemaVersion: 2;
	maEnabled: boolean;
	maLines: MovingAverageLineConfig[];
	emaEnabled: boolean;
	emaLines: MovingAverageLineConfig[];
	volume: boolean;
	enabled: Record<string, boolean>;
	params: Record<string, Record<string, number>>;
	colors: Record<string, string>;
	plotColors: Record<string, Record<string, string>>;
	paneOrder: PaneId[];
	hidden: string[];
	legendCollapsed: boolean;
}

export interface IndicatorPoint {
	fast: number;
	slow: number;
	ema12: number;
	ema26: number;
	macd: number;
	signal: number;
	histogram: number;
}

const MA_PRESETS: readonly { period: number; color: string }[] = [
	{ period: 7, color: '#f5c542' },
	{ period: 25, color: '#e964a4' },
	{ period: 99, color: '#8f6ef5' },
	{ period: 120, color: '#42a5f5' },
	{ period: 200, color: '#ff8a65' },
];

const EMA_PRESETS: readonly { period: number; color: string }[] = [
	{ period: 20, color: '#83bd8c' },
	{ period: 60, color: '#e8ae37' },
	{ period: 120, color: '#56b6c2' },
	{ period: 200, color: '#e06c75' },
	{ period: 9, color: '#c678dd' },
];

export function defaultIndicatorSettings(): IndicatorSettings {
	return {
		schemaVersion: 2,
		maEnabled: true,
		maLines: [
			{ id: 'ma-1', period: 7, color: '#f5c542', visible: true },
			{ id: 'ma-2', period: 25, color: '#e964a4', visible: true },
			{ id: 'ma-3', period: 99, color: '#8f6ef5', visible: false },
		],
		emaEnabled: true,
		emaLines: [
			{ id: 'ema-1', period: 20, color: '#83bd8c', visible: true },
			{ id: 'ema-2', period: 60, color: '#e8ae37', visible: true },
		],
		volume: true,
		enabled: { macd: true },
		params: {},
		colors: {},
		plotColors: {},
		paneOrder: ['price', 'macd'],
		hidden: [],
		legendCollapsed: false,
	};
}

export function isIndicatorEnabled(settings: IndicatorSettings, id: string): boolean {
	if (id === 'ma') return settings.maEnabled;
	if (id === 'ema') return settings.emaEnabled;
	if (id === 'volume') return settings.volume;
	return Boolean(settings.enabled[id]);
}

export function setIndicatorEnabled(settings: IndicatorSettings, id: string, value: boolean): void {
	if (!value) settings.hidden = settings.hidden.filter(item => item !== id);
	if (id === 'ma') { settings.maEnabled = value; return; }
	if (id === 'ema') { settings.emaEnabled = value; return; }
	if (id === 'volume') { settings.volume = value; return; }
	const def = getCatalogIndicator(id);
	if (!def) return;
	if (value) {
		settings.enabled[id] = true;
		if (def.placement === 'pane' && !settings.paneOrder.includes(id)) {
			settings.paneOrder.push(id);
		}
	} else {
		delete settings.enabled[id];
	}
}

export function isIndicatorVisible(settings: IndicatorSettings, id: string): boolean {
	return isIndicatorEnabled(settings, id) && !settings.hidden.includes(id);
}

export function setIndicatorVisible(settings: IndicatorSettings, id: string, visible: boolean): void {
	if (!isIndicatorEnabled(settings, id)) return;
	settings.hidden = settings.hidden.filter(item => item !== id);
	if (!visible) settings.hidden.push(id);
}

export function indicatorParams(settings: IndicatorSettings, id: string): Record<string, number> {
	const def = getCatalogIndicator(id);
	if (!def) return {};
	return { ...defaultParamsFor(def), ...(settings.params[id] ?? {}) };
}

export function indicatorColor(settings: IndicatorSettings, id: string): string {
	return settings.colors[id] ?? getCatalogIndicator(id)?.defaultColor ?? '#2962ff';
}

export function indicatorPlotColors(settings: IndicatorSettings, id: string): Record<string, string> {
	const def = getCatalogIndicator(id);
	if (!def?.colorSpecs?.length) return {};
	const saved = settings.plotColors[id] ?? {};
	const resolved: Record<string, string> = {};
	for (const spec of def.colorSpecs) {
		resolved[spec.key] = saved[spec.key] ?? (spec.key === id ? settings.colors[id] : undefined) ?? spec.defaultColor;
	}
	return resolved;
}

export function activePaneOrder(settings: IndicatorSettings): PaneId[] {
	const activeSubPanes = new Set<string>(
		INDICATOR_CATALOG.filter(item => item.placement === 'pane' && isIndicatorEnabled(settings, item.id)).map(item => item.id)
	);
	const ordered: PaneId[] = [];
	for (const id of settings.paneOrder) {
		if (id === 'price' || activeSubPanes.has(id)) {
			if (!ordered.includes(id)) ordered.push(id);
		}
	}
	if (!ordered.includes('price')) ordered.unshift('price');
	for (const id of activeSubPanes) {
		if (!ordered.includes(id)) ordered.push(id);
	}
	return ordered;
}

export function nextLinePreset(kind: 'ma' | 'ema', existing: readonly MovingAverageLineConfig[]): MovingAverageLineConfig | null {
	if (existing.length >= MAX_MA_LINES) return null;
	const presets = kind === 'ma' ? MA_PRESETS : EMA_PRESETS;
	const usedPeriods = new Set(existing.map(line => line.period));
	const usedColors = new Set(existing.map(line => line.color.toLowerCase()));
	const chosen = presets.find(p => !usedPeriods.has(p.period))
		?? presets.find(p => !usedColors.has(p.color.toLowerCase()))
		?? presets[existing.length % presets.length];
	const usedIds = new Set(existing.map(line => line.id));
	let suffix = existing.length + 1;
	while (usedIds.has(`${kind}-${suffix}`)) suffix++;
	return { id: `${kind}-${suffix}`, period: chosen.period, color: chosen.color, visible: true };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isHexColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v);

function parseLines(value: unknown, kind: 'ma' | 'ema'): MovingAverageLineConfig[] {
	if (!Array.isArray(value) || value.length < 1 || value.length > MAX_MA_LINES) {
		throw new Error(`Invalid ${kind} lines`);
	}
	const ids = new Set<string>();
	return value.map((item, index) => {
		if (!isRecord(item) || typeof item.id !== 'string' || !/^[\w-]{1,32}$/.test(item.id) || ids.has(item.id) ||
			!Number.isInteger(item.period) || (item.period as number) < 1 || (item.period as number) > 500 ||
			!isHexColor(item.color) || typeof item.visible !== 'boolean') {
			throw new Error(`Invalid ${kind} line at ${index}`);
		}
		ids.add(item.id);
		return { id: item.id, period: item.period as number, color: item.color, visible: item.visible };
	});
}

function isValidPaneId(id: string): boolean {
	return id === 'price' || getCatalogIndicator(id)?.placement === 'pane';
}

/** Validate persisted indicator configuration strictly; migrates schemaVersion 1 -> 2 seamlessly. */
export function parseIndicatorSettings(value: unknown): IndicatorSettings {
	if (!isRecord(value)) throw new Error('Invalid indicator settings');

	// Migrate schemaVersion 1 (previous format with boolean macd + rsi object)
	if (value.schemaVersion === 1) {
		if (typeof value.maEnabled !== 'boolean' || typeof value.emaEnabled !== 'boolean' ||
			typeof value.volume !== 'boolean' || typeof value.macd !== 'boolean' ||
			!isRecord(value.rsi) || typeof value.rsi.enabled !== 'boolean' ||
			!Number.isInteger(value.rsi.period) || (value.rsi.period as number) < 2 || (value.rsi.period as number) > 200 ||
			!isHexColor(value.rsi.color) || !Array.isArray(value.paneOrder)) {
			throw new Error('Invalid v1 indicator settings');
		}
		const enabled: Record<string, boolean> = {};
		if (value.macd) enabled.macd = true;
		if (value.rsi.enabled) enabled.rsi = true;
		const paneOrder: PaneId[] = [];
		for (const item of value.paneOrder) {
			if (typeof item !== 'string' || !isValidPaneId(item) || paneOrder.includes(item)) {
				throw new Error('Invalid v1 pane order');
			}
			paneOrder.push(item);
		}
		if (!paneOrder.includes('price')) throw new Error('Missing price pane');
		return {
			schemaVersion: 2,
			maEnabled: value.maEnabled,
			maLines: parseLines(value.maLines, 'ma'),
			emaEnabled: value.emaEnabled,
			emaLines: parseLines(value.emaLines, 'ema'),
			volume: value.volume,
			enabled,
			params: { rsi: { period: value.rsi.period as number } },
			colors: { rsi: value.rsi.color },
			plotColors: {},
			paneOrder,
			hidden: [],
			legendCollapsed: false,
		};
	}

	if (value.schemaVersion !== 2 ||
		typeof value.maEnabled !== 'boolean' || typeof value.emaEnabled !== 'boolean' ||
		typeof value.volume !== 'boolean' ||
		!isRecord(value.enabled) || !isRecord(value.params) || !isRecord(value.colors) ||
		!Array.isArray(value.paneOrder) || value.paneOrder.length < 1 || value.paneOrder.length > 32) {
		throw new Error('Invalid v2 indicator settings');
	}

	const enabled: Record<string, boolean> = {};
	for (const [id, flag] of Object.entries(value.enabled)) {
		const def = getCatalogIndicator(id);
		if (!def || def.special || typeof flag !== 'boolean') throw new Error(`Invalid enabled indicator ${id}`);
		if (flag) enabled[id] = true;
	}

	const params: Record<string, Record<string, number>> = {};
	for (const [id, rawParams] of Object.entries(value.params)) {
		const def = getCatalogIndicator(id);
		if (!def || !isRecord(rawParams)) throw new Error(`Invalid params for ${id}`);
		const clean: Record<string, number> = {};
		for (const [key, val] of Object.entries(rawParams)) {
			const spec = def.params.find(p => p.key === key);
			if (!spec || typeof val !== 'number' || !Number.isFinite(val) || val < spec.min || val > spec.max || (spec.integer && !Number.isInteger(val))) {
				throw new Error(`Invalid param ${id}.${key}`);
			}
			clean[key] = val;
		}
		params[id] = clean;
	}

	const colors: Record<string, string> = {};
	for (const [id, col] of Object.entries(value.colors)) {
		if (!getCatalogIndicator(id) || !isHexColor(col)) throw new Error(`Invalid color for ${id}`);
		colors[id] = col;
	}

	const plotColors: Record<string, Record<string, string>> = {};
	if (value.plotColors !== undefined) {
		if (!isRecord(value.plotColors)) throw new Error('Invalid plotColors');
		for (const [id, rawMap] of Object.entries(value.plotColors)) {
			const def = getCatalogIndicator(id);
			if (!def?.colorSpecs?.length || !isRecord(rawMap)) throw new Error(`Invalid plotColors for ${id}`);
			const validKeys = new Set(def.colorSpecs.map(spec => spec.key));
			const clean: Record<string, string> = {};
			for (const [key, col] of Object.entries(rawMap)) {
				if (!validKeys.has(key) || !isHexColor(col)) throw new Error(`Invalid plotColor ${id}.${key}`);
				clean[key] = col;
			}
			plotColors[id] = clean;
		}
	}

	const paneOrder: PaneId[] = [];
	for (const item of value.paneOrder) {
		if (typeof item !== 'string' || !isValidPaneId(item) || paneOrder.includes(item)) {
			throw new Error('Invalid pane order');
		}
		paneOrder.push(item);
	}
	if (!paneOrder.includes('price')) throw new Error('Missing price pane');
	const hidden = value.hidden === undefined ? [] : value.hidden;
	if (!Array.isArray(hidden) || hidden.some(id => typeof id !== 'string' || !getCatalogIndicator(id)) || new Set(hidden).size !== hidden.length ||
		(value.legendCollapsed !== undefined && typeof value.legendCollapsed !== 'boolean')) throw new Error('Invalid indicator legend settings');

	return {
		schemaVersion: 2,
		maEnabled: value.maEnabled,
		maLines: parseLines(value.maLines, 'ma'),
		emaEnabled: value.emaEnabled,
		emaLines: parseLines(value.emaLines, 'ema'),
		volume: value.volume,
		enabled,
		params,
		colors,
		plotColors,
		paneOrder,
		hidden: hidden as string[],
		legendCollapsed: value.legendCollapsed === true,
	};
}

export function movePaneOrder(order: readonly PaneId[], pane: PaneId, direction: -1 | 1): PaneId[] {
	const index = order.indexOf(pane);
	const target = index + direction;
	if (index < 0 || target < 0 || target >= order.length) return [...order];
	const next = [...order];
	[next[index], next[target]] = [next[target], next[index]];
	return next;
}

export function moveVisiblePane(order: readonly PaneId[], visible: ReadonlySet<PaneId>, pane: PaneId, direction: -1 | 1): PaneId[] {
	const visibleOrder = order.filter(id => visible.has(id));
	const visibleIndex = visibleOrder.indexOf(pane);
	const neighbor = visibleOrder[visibleIndex + direction];
	if (visibleIndex < 0 || !neighbor) return [...order];
	const next = [...order];
	const fromIdx = next.indexOf(pane);
	const toIdx = next.indexOf(neighbor);
	[next[fromIdx], next[toIdx]] = [next[toIdx], next[fromIdx]];
	return next;
}

/** SMA via trading-signals. */
export function calculateSmaSeries(candles: readonly Candle[], period: number): (number | null)[] {
	const sma = new SMA(period);
	return candles.map(c => sma.update(c.close, false));
}

/** EMA via trading-signals. */
export function calculateEmaSeries(candles: readonly Candle[], period: number): number[] {
	const ema = new EMA(period);
	return candles.map(c => ema.update(c.close, false));
}

/** Wilder RSI via trading-signals. */
export function calculateRsiSeries(candles: readonly Candle[], period: number): (number | null)[] {
	const rsi = new RSI(period);
	return candles.map(c => rsi.update(c.close, false));
}

/** Legacy incremental helper kept for existing feed/indicator unit tests. */
export function nextIndicators(close: number, previous?: IndicatorPoint): IndicatorPoint {
	const step = (val: number | undefined, period: number): number => val === undefined ? close : val + (close - val) * (2 / (period + 1));
	const fast = step(previous?.fast, 20);
	const slow = step(previous?.slow, 60);
	const ema12 = step(previous?.ema12, 12);
	const ema26 = step(previous?.ema26, 26);
	const macd = ema12 - ema26;
	const signal = previous ? previous.signal + (macd - previous.signal) * 0.2 : macd;
	return { fast, slow, ema12, ema26, macd, signal, histogram: macd - signal };
}

export function calculateIndicators(candles: readonly Candle[]): IndicatorPoint[] {
	const result: IndicatorPoint[] = [];
	for (const candle of candles) result.push(nextIndicators(candle.close, result.at(-1)));
	return result;
}
