import { instrumentKey, parseInstrumentKey, type Instrument } from '@terminal/domain';

export const WATCHLIST_STORAGE_KEY = 'crypto-terminal.watchlist.v1';

export interface WatchlistStore {
	schemaVersion: 1;
	items: Instrument[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseWatchlistStore(input: unknown): WatchlistStore {
	if (!isRecord(input) || input.schemaVersion !== 1 || !Array.isArray(input.items) || input.items.length > 500) {
		throw new Error('Invalid watchlist store');
	}
	const seen = new Set<string>();
	const items: Instrument[] = [];
	for (const entry of input.items) {
		let parsed: Instrument;
		if (typeof entry === 'string') {
			parsed = parseInstrumentKey(entry);
		} else if (isRecord(entry) && typeof entry.venue === 'string' &&
			(entry.market === 'spot' || entry.market === 'perpetual') &&
			typeof entry.symbol === 'string') {
			parsed = { venue: entry.venue, market: entry.market, symbol: entry.symbol };
			instrumentKey(parsed);
		} else {
			throw new Error('Invalid watchlist instrument');
		}
		const key = instrumentKey(parsed);
		if (seen.has(key)) continue;
		seen.add(key);
		items.push(parsed);
	}
	return { schemaVersion: 1, items };
}

export function hasInWatchlist(items: readonly Instrument[], target: Instrument): boolean {
	const key = instrumentKey(target);
	return items.some(item => instrumentKey(item) === key);
}

export function removeFromWatchlist(items: readonly Instrument[], target: Instrument): Instrument[] {
	const key = instrumentKey(target);
	return items.filter(item => instrumentKey(item) !== key);
}

export function toggleWatchlistItem(items: readonly Instrument[], target: Instrument): { items: Instrument[]; added: boolean } {
	const key = instrumentKey(target);
	if (items.some(item => instrumentKey(item) === key)) {
		return { items: items.filter(item => instrumentKey(item) !== key), added: false };
	}
	return { items: [...items, { ...target }], added: true };
}

export function reorderWatchlist(items: readonly Instrument[], fromIndex: number, toIndex: number): Instrument[] {
	if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return [...items];
	if (fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length || fromIndex === toIndex) {
		return [...items];
	}
	const next = [...items];
	const [moved] = next.splice(fromIndex, 1);
	next.splice(toIndex, 0, moved);
	return next;
}

export function moveWatchlistItemToEdge(items: readonly Instrument[], target: Instrument, edge: 'top' | 'bottom'): Instrument[] {
	const key = instrumentKey(target);
	const index = items.findIndex(item => instrumentKey(item) === key);
	if (index < 0) return [...items];
	return reorderWatchlist(items, index, edge === 'top' ? 0 : items.length - 1);
}
