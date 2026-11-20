import {
	BarData,
	Coordinate,
	IChartApi,
	ISeriesApi,
	isBusinessDay,
	Logical,
	MismatchDirection,
	SeriesType,
	Time,
} from 'lightweight-charts';
import { AnchorPoint, MagnetMode, ScreenPoint } from './types';

const WEAK_MAGNET_THRESHOLD_PX = 24;

function isOhlcBar(item: unknown): item is BarData<Time> {
	return (
		typeof item === 'object' &&
		item !== null &&
		'open' in item &&
		'high' in item &&
		'low' in item &&
		'close' in item
	);
}

function hasSingleValue(item: unknown): item is { value: number } {
	return (
		typeof item === 'object' &&
		item !== null &&
		'value' in item &&
		typeof (item as { value: unknown }).value === 'number'
	);
}

/**
 * Resolves a business-space AnchorPoint into pane-local CSS coordinates.
 * Prefers `timeToCoordinate` when `anchor.time` is present so drawings stay
 * anchored across historical data prepends, and falls back to `logicalToCoordinate`
 * for future whitespace or fractional positions.
 */
export function anchorToScreen(
	chart: IChartApi,
	series: ISeriesApi<SeriesType>,
	anchor: AnchorPoint
): ScreenPoint | null {
	const timeScale = chart.timeScale();
	let x: Coordinate | null = null;
	if (anchor.time !== undefined) {
		x = timeScale.timeToCoordinate(anchor.time);
	}
	if (x === null) {
		x = timeScale.logicalToCoordinate(anchor.logical);
	}
	const y = series.priceToCoordinate(anchor.price);
	if (x === null || y === null) {
		return null;
	}
	return { x, y };
}

export function anchorToX(chart: IChartApi, anchor: AnchorPoint): number | null {
	const timeScale = chart.timeScale();
	if (anchor.time !== undefined) {
		const byTime = timeScale.timeToCoordinate(anchor.time);
		if (byTime !== null) {
			return byTime;
		}
	}
	return timeScale.logicalToCoordinate(anchor.logical);
}

export function anchorToY(
	series: ISeriesApi<SeriesType>,
	anchor: AnchorPoint
): number | null {
	return series.priceToCoordinate(anchor.price);
}

/**
 * Resolves an exact bar Time only if the given logical index sits on an actual bar
 * (not in future/past whitespace).
 */
function resolveTimeForLogical(chart: IChartApi, logical: Logical): Time | undefined {
	const timeScale = chart.timeScale();
	const rounded = Math.round(logical) as Logical;
	if (Math.abs(logical - rounded) > 0.35) {
		return undefined;
	}
	const x = timeScale.logicalToCoordinate(rounded);
	if (x === null) {
		return undefined;
	}
	const time = timeScale.coordinateToTime(x);
	if (time === null) {
		return undefined;
	}
	const verifiedX = timeScale.timeToCoordinate(time);
	if (verifiedX === null || Math.abs(verifiedX - x) > 2) {
		return undefined;
	}
	return time;
}

/**
 * Converts pane-local CSS coordinates (x, y) into an AnchorPoint,
 * optionally applying Weak or Strong OHLC Magnet snapping.
 */
export function screenToAnchor(
	chart: IChartApi,
	series: ISeriesApi<SeriesType>,
	x: number,
	y: number,
	magnetMode: MagnetMode = 'off'
): AnchorPoint | null {
	const timeScale = chart.timeScale();
	const rawLogical = timeScale.coordinateToLogical(x);
	const rawPrice = series.coordinateToPrice(y);
	if (rawLogical === null || rawPrice === null) {
		return null;
	}

	let logical = rawLogical;
	let price = rawPrice as number;

	if (magnetMode !== 'off') {
		const nearestIndex = Math.round(rawLogical);
		const bar = series.dataByIndex(nearestIndex, MismatchDirection.None);
		if (bar !== null) {
			const candidates: number[] = [];
			if (isOhlcBar(bar)) {
				candidates.push(bar.open, bar.high, bar.low, bar.close);
			} else if (hasSingleValue(bar)) {
				candidates.push(bar.value);
			}

			let bestPrice: number | null = null;
			let bestDist = Infinity;
			for (const candidate of candidates) {
				const cy = series.priceToCoordinate(candidate);
				if (cy === null) continue;
				const dist = Math.abs(cy - y);
				if (dist < bestDist) {
					bestDist = dist;
					bestPrice = candidate;
				}
			}

			if (
				bestPrice !== null &&
				(magnetMode === 'strong' || bestDist <= WEAK_MAGNET_THRESHOLD_PX)
			) {
				price = bestPrice;
				logical = nearestIndex as Logical;
			}
		}
	}

	const time = resolveTimeForLogical(chart, logical);
	return time !== undefined ? { logical, time, price } : { logical, price };
}

/**
 * Shifts an AnchorPoint by `(deltaLogical, deltaPrice)` while cleanly clearing
 * `time` when moving into future/empty whitespace so the anchor never snaps back.
 */
export function shiftAnchor(
	chart: IChartApi,
	anchor: AnchorPoint,
	deltaLogical: number,
	deltaPrice: number
): AnchorPoint {
	const logical = (anchor.logical + deltaLogical) as Logical;
	const price = anchor.price + deltaPrice;
	const time = resolveTimeForLogical(chart, logical);
	return time !== undefined ? { logical, time, price } : { logical, price };
}

export function formatPrice(series: ISeriesApi<SeriesType>, price: number): string {
	try {
		return series.priceFormatter().format(price);
	} catch {
		return price.toFixed(2);
	}
}

export function formatTime(chart: IChartApi, anchor: AnchorPoint): string {
	if (anchor.time !== undefined) {
		try {
			const behaviour = chart.horzBehaviour();
			return behaviour.formatHorzItem(
				behaviour.convertHorzItemToInternal(anchor.time)
			);
		} catch {
			if (typeof anchor.time === 'string') {
				return anchor.time;
			}
			if (isBusinessDay(anchor.time)) {
				const m = String(anchor.time.month).padStart(2, '0');
				const d = String(anchor.time.day).padStart(2, '0');
				return `${anchor.time.year}-${m}-${d}`;
			}
			return new Date((anchor.time as number) * 1000).toISOString().slice(0, 10);
		}
	}
	return `Bar ${Math.round(anchor.logical)}`;
}

export function timeToEpochSeconds(time: Time | undefined): number | null {
	if (time === undefined) return null;
	if (typeof time === 'number') return time;
	if (isBusinessDay(time)) {
		return Math.floor(Date.UTC(time.year, time.month - 1, time.day) / 1000);
	}
	const parsed = Date.parse(time);
	return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
}

export function formatDuration(seconds: number): string {
	const abs = Math.abs(Math.round(seconds));
	if (abs < 60) return `${abs}s`;
	const mins = Math.floor(abs / 60);
	if (mins < 60) return `${mins}m`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) {
		const remMins = mins % 60;
		return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
	}
	const days = Math.floor(hours / 24);
	const remHours = hours % 24;
	return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}
