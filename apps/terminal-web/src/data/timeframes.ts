import { TIMEFRAMES, type Timeframe } from '@terminal/domain';

export const TIMEFRAME_STORAGE_KEY = 'crypto-terminal.timeframes.v1';
export const MOBILE_TIMEFRAME_STORAGE_KEY = 'crypto-terminal.mobile-timeframe.v1';

export type TimeframeGroupId = 'minutes' | 'hours' | 'days';

export interface TimeframeGroup {
	id: TimeframeGroupId;
	label: string;
	timeframes: readonly Timeframe[];
}

export const TIMEFRAME_GROUPS: readonly TimeframeGroup[] = [
	{ id: 'minutes', label: '分', timeframes: ['1m', '3m', '5m', '15m', '30m'] },
	{ id: 'hours', label: '小时', timeframes: ['1h', '2h', '4h', '6h', '8h', '12h'] },
	{ id: 'days', label: '天', timeframes: ['1d', '3d', '1w', '1M'] },
];

export const TIMEFRAME_SHORT_LABELS: Record<Timeframe, string> = {
	'1m': '1分', '3m': '3分', '5m': '5分', '15m': '15分', '30m': '30分',
	'1h': '1时', '2h': '2时', '4h': '4时', '6h': '6时', '8h': '8时', '12h': '12时',
	'1d': '1日', '3d': '3日', '1w': '1周', '1M': '1月',
};

export const TIMEFRAME_LONG_LABELS: Record<Timeframe, string> = {
	'1m': '1 分钟', '3m': '3 分钟', '5m': '5 分钟', '15m': '15 分钟', '30m': '30 分钟',
	'1h': '1 小时', '2h': '2 小时', '4h': '4 小时', '6h': '6 小时', '8h': '8 小时', '12h': '12 小时',
	'1d': '1 天', '3d': '3 天', '1w': '1 周', '1M': '1 个月',
};

export const DEFAULT_FAVORITE_TIMEFRAMES: readonly Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'];

export interface TimeframePreferences {
	schemaVersion: 1;
	favorites: Timeframe[];
	collapsedGroups: TimeframeGroupId[];
}

const VALID_TIMEFRAMES = new Set<string>(TIMEFRAMES);
const VALID_GROUPS = new Set<string>(TIMEFRAME_GROUPS.map(group => group.id));

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function defaultTimeframePreferences(): TimeframePreferences {
	return {
		schemaVersion: 1,
		favorites: [...DEFAULT_FAVORITE_TIMEFRAMES],
		collapsedGroups: [],
	};
}

export function parseTimeframePreferences(value: unknown): TimeframePreferences {
	if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.favorites)) {
		throw new Error('Invalid timeframe preferences');
	}
	const favorites: Timeframe[] = [];
	const seen = new Set<string>();
	for (const item of value.favorites) {
		if (typeof item !== 'string' || !VALID_TIMEFRAMES.has(item) || seen.has(item)) {
			throw new Error('Invalid favorite timeframe');
		}
		seen.add(item);
		favorites.push(item as Timeframe);
	}
	const rawCollapsed = value.collapsedGroups === undefined ? [] : value.collapsedGroups;
	if (!Array.isArray(rawCollapsed)) throw new Error('Invalid collapsed timeframe groups');
	const collapsedGroups: TimeframeGroupId[] = [];
	const seenGroups = new Set<string>();
	for (const group of rawCollapsed) {
		if (typeof group !== 'string' || !VALID_GROUPS.has(group) || seenGroups.has(group)) {
			throw new Error('Invalid collapsed timeframe group');
		}
		seenGroups.add(group);
		collapsedGroups.push(group as TimeframeGroupId);
	}
	return { schemaVersion: 1, favorites, collapsedGroups };
}

export function toggleFavoriteTimeframe(prefs: TimeframePreferences, timeframe: Timeframe): TimeframePreferences {
	const set = new Set<Timeframe>(prefs.favorites);
	if (set.has(timeframe)) set.delete(timeframe);
	else set.add(timeframe);
	return {
		...prefs,
		favorites: TIMEFRAMES.filter(tf => set.has(tf)),
	};
}

export function toggleTimeframeGroup(prefs: TimeframePreferences, groupId: TimeframeGroupId): TimeframePreferences {
	const set = new Set<TimeframeGroupId>(prefs.collapsedGroups);
	if (set.has(groupId)) set.delete(groupId);
	else set.add(groupId);
	return {
		...prefs,
		collapsedGroups: TIMEFRAME_GROUPS.map(group => group.id).filter(id => set.has(id)),
	};
}

/**
 * Visible quick-switch timeframes in the toolbar:
 * shows user favorites, and prepends the active timeframe if it is not currently favorited.
 */
export function visibleToolbarTimeframes(prefs: TimeframePreferences, active?: Timeframe): Timeframe[] {
	const list = [...prefs.favorites];
	if (active && !list.includes(active)) {
		return [active, ...list];
	}
	return list;
}

export function parseMobileTimeframe(value: unknown): Timeframe {
	if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.timeframe !== 'string' || !VALID_TIMEFRAMES.has(value.timeframe)) {
		throw new Error('Invalid mobile timeframe');
	}
	return value.timeframe as Timeframe;
}

export function serializeMobileTimeframe(timeframe: Timeframe): string {
	return JSON.stringify({ schemaVersion: 1, timeframe });
}

/**
 * Desktop keeps per-tab/per-instrument timeframes; mobile carries the current timeframe across instrument switches
 * without overwriting desktop tab preferences.
 */
export function resolveActiveTimeframe(isMobile: boolean, tabTimeframe: Timeframe, mobileTimeframe?: Timeframe): Timeframe {
	return isMobile ? (mobileTimeframe ?? tabTimeframe) : tabTimeframe;
}
