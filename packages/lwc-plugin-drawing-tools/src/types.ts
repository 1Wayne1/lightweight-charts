import type { LineStyle, Logical, PrimitivePaneViewZOrder, Time } from 'lightweight-charts';

import type { ExtendedToolType } from './tools/catalog';

export type DrawingToolType =
	| ExtendedToolType
	| 'trend-line'
	| 'ray'
	| 'horizontal-line'
	| 'vertical-line'
	| 'rectangle'
	| 'parallel-channel'
	| 'fib-retracement'
	| 'price-date-range'
	| 'text';

export type MagnetMode = 'off' | 'weak' | 'strong';

export type DrawingTheme = 'dark' | 'light';

export interface AnchorPoint {
	/**
	 * Primary horizontal coordinate (logical bar index).
	 * Supports fractional values and future/whitespace positions past the last bar.
	 */
	logical: Logical;
	/** Host already reprojects canonical UTC time, including fractional bars. */
	logicalIsExact?: boolean;
	/**
	 * Optional bar time for re-anchoring when historical data is prepended.
	 * Omitted when the anchor sits in whitespace/future space.
	 */
	time?: Time;
	/** Price value on the attached series price scale. */
	price: number;
}

export interface ScreenPoint {
	x: number;
	y: number;
}

export interface FibLevelConfig {
	text?: string;
	value: number;
	color: string;
	visible: boolean;
}

export interface DrawingStyleOptions {
	color: string;
	fillColor: string;
	fillOpacity: number;
	lineWidth: number;
	lineStyle: LineStyle;
	extendLeft: boolean;
	extendRight: boolean;
	showLabels: boolean;
	showMidline: boolean;
	text: string;
	/** Optional object note; separate from legacy primary annotation text. */
	attachedText: string;
	showText: boolean;
	textBold: boolean;
	textItalic: boolean;
	textOpacity: number;
	textAlign: 'left' | 'center' | 'right';
	textPosition: 'top' | 'middle' | 'bottom';
	textOrientation: 'horizontal' | 'vertical';
	fontSize: number;
	textColor: string;
	backgroundColor: string;
	fibLevels: FibLevelConfig[];
	locked: boolean;
	visible: boolean;
	zOrder: PrimitivePaneViewZOrder;
	/** Position sizing and analytical tool parameters. */
	accountSize: number;
	riskPercent: number;
	deviations: number;
	profileRows: number;
	/** Normalized viewport location for anchored text only. */
	anchorX?: number;
	anchorY?: number;
}

export interface SerializedDrawing {
	id: string;
	type: DrawingToolType;
	points: AnchorPoint[];
	options: Partial<DrawingStyleOptions>;
}

export interface DrawingSnapshot {
	version: 1;
	drawings: SerializedDrawing[];
}

export interface HitPart {
	drawingId: string;
	part: 'anchor' | 'body';
	anchorIndex?: number;
}

export interface ToolCapabilities {
	hasStroke: boolean;
	hasFill: boolean;
	hasLineWidth: boolean;
	hasLineStyle: boolean;
	hasExtend: boolean;
	hasText: boolean;
	hasMidline: boolean;
}

export interface ToolDefinition {
	type: DrawingToolType;
	label: string;
	shortLabel: string;
	pointCount: number;
	group?: string;
	creation?: 'points' | 'path' | 'freehand';
	capabilities: ToolCapabilities;
	defaultOptions: Partial<DrawingStyleOptions>;
}

export const DEFAULT_FIB_LEVELS: readonly FibLevelConfig[] = [
	{ value: 0, color: '#787B86', visible: true },
	{ value: 0.236, color: '#F44336', visible: true },
	{ value: 0.382, color: '#81C784', visible: true },
	{ value: 0.5, color: '#4CAF50', visible: true },
	{ value: 0.618, color: '#009688', visible: true },
	{ value: 0.786, color: '#64B5F6', visible: true },
	{ value: 1, color: '#787B86', visible: true },
];

export const BASE_DRAWING_OPTIONS: DrawingStyleOptions = {
	color: '#2962FF',
	fillColor: '#2962FF',
	fillOpacity: 0.16,
	lineWidth: 2,
	lineStyle: 0 as LineStyle,
	extendLeft: false,
	extendRight: false,
	showLabels: true,
	showMidline: true,
	text: 'Text',
	attachedText: '',
	showText: true,
	textBold: false,
	textItalic: false,
	textOpacity: 1,
	textAlign: 'center',
	textPosition: 'top',
	textOrientation: 'vertical',
	fontSize: 13,
	textColor: '#FFFFFF',
	backgroundColor: '#2962FF',
	fibLevels: DEFAULT_FIB_LEVELS.map(level => ({ ...level })),
	locked: false,
	visible: true,
	zOrder: 'top',
	accountSize: 10000,
	riskPercent: 1,
	deviations: 2,
	profileRows: 24,
};

export function encodeExternalId(hit: HitPart): string {
	return hit.part === 'anchor'
		? `dt:${hit.drawingId}:anchor:${hit.anchorIndex ?? 0}`
		: `dt:${hit.drawingId}:body`;
}

export function decodeExternalId(externalId: unknown): HitPart | null {
	if (typeof externalId !== 'string' || !externalId.startsWith('dt:')) {
		return null;
	}
	const parts = externalId.split(':');
	if (parts.length < 3) {
		return null;
	}
	const drawingId = parts[1];
	const part = parts[2];
	if (part === 'body') {
		return { drawingId, part: 'body' };
	}
	if (part === 'anchor' && parts.length >= 4) {
		const anchorIndex = Number(parts[3]);
		if (Number.isInteger(anchorIndex) && anchorIndex >= 0) {
			return { drawingId, part: 'anchor', anchorIndex };
		}
	}
	return null;
}
