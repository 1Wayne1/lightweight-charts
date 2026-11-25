import { EXTENDED_DEFINITIONS } from './catalog';
import { ExtendedDrawing } from './extended-drawing';
import { LineStyle } from 'lightweight-charts';
import { BaseDrawing } from '../base-drawing';
import {
	DrawingToolType,
	SerializedDrawing,
	ToolDefinition,
} from '../types';
import { FibChannelDrawing, FibExtensionDrawing, TrendFibTimeDrawing } from './fib-extension';
import { FibRetracementDrawing } from './fib-retracement';
import { HorizontalLineDrawing } from './horizontal-line';
import { ParallelChannelDrawing } from './parallel-channel';
import { isElliottTool, PATTERN_TOOL_TYPES, PatternDrawing, patternStepHint, type PatternToolType } from './patterns';
import { PositionDrawing } from './position';
import { PriceDateRangeDrawing } from './price-date-range';
import { RayDrawing } from './ray';
import { RectangleDrawing } from './rectangle';
import { TextAnnotationDrawing } from './text-annotation';
import { TrendLineDrawing } from './trend-line';
import { VerticalLineDrawing } from './vertical-line';

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
	{
		type: 'trend-line',
		label: 'Trend Line',
		shortLabel: '趋势线',
		pointCount: 2,
		capabilities: {
			hasStroke: true,
			hasFill: false,
			hasLineWidth: true,
			hasLineStyle: true,
			hasExtend: true,
			hasText: false,
			hasMidline: false,
		},
		defaultOptions: {
			color: '#2962FF',
			lineWidth: 2,
			lineStyle: LineStyle.Solid,
			extendLeft: false,
			extendRight: false,
		},
	},
	{
		type: 'horizontal-line',
		label: 'Horizontal Line',
		shortLabel: '水平线',
		pointCount: 1,
		capabilities: {
			hasStroke: true,
			hasFill: false,
			hasLineWidth: true,
			hasLineStyle: true,
			hasExtend: false,
			hasText: false,
			hasMidline: false,
		},
		defaultOptions: {
			color: '#F23645',
			lineWidth: 2,
			lineStyle: LineStyle.Solid,
			showLabels: true,
		},
	},
	{
		type: 'ray',
		label: 'Ray',
		shortLabel: '射线',
		pointCount: 2,
		capabilities: {
			hasStroke: true,
			hasFill: false,
			hasLineWidth: true,
			hasLineStyle: true,
			hasExtend: true,
			hasText: false,
			hasMidline: false,
		},
		defaultOptions: {
			color: '#2962FF',
			lineWidth: 2,
			lineStyle: LineStyle.Solid,
			extendLeft: false,
			extendRight: true,
		},
	},
	{
		type: 'vertical-line',
		label: 'Vertical Line',
		shortLabel: '垂直线',
		pointCount: 1,
		capabilities: {
			hasStroke: true,
			hasFill: false,
			hasLineWidth: true,
			hasLineStyle: true,
			hasExtend: false,
			hasText: false,
			hasMidline: false,
		},
		defaultOptions: {
			color: '#089981',
			lineWidth: 2,
			lineStyle: LineStyle.Dashed,
			showLabels: true,
		},
	},
	{
		type: 'rectangle',
		label: 'Rectangle',
		shortLabel: '矩形',
		pointCount: 2,
		capabilities: {
			hasStroke: true,
			hasFill: true,
			hasLineWidth: true,
			hasLineStyle: true,
			hasExtend: false,
			hasText: false,
			hasMidline: false,
		},
		defaultOptions: {
			color: '#2962FF',
			fillColor: '#2962FF',
			fillOpacity: 0.18,
			lineWidth: 2,
			lineStyle: LineStyle.Solid,
		},
	},
	{
		type: 'parallel-channel',
		label: 'Parallel Channel',
		shortLabel: '平行通道',
		pointCount: 3,
		capabilities: {
			hasStroke: true,
			hasFill: true,
			hasLineWidth: true,
			hasLineStyle: true,
			hasExtend: true,
			hasText: false,
			hasMidline: true,
		},
		defaultOptions: {
			color: '#2962FF',
			fillColor: '#2962FF',
			fillOpacity: 0.14,
			lineWidth: 2,
			lineStyle: LineStyle.Solid,
			showMidline: true,
		},
	},
	{
		type: 'fib-retracement',
		label: 'Fib Retracement',
		shortLabel: '斐波那契回撤',
		pointCount: 2,
		capabilities: {
			hasStroke: true,
			hasFill: false,
			hasLineWidth: true,
			hasLineStyle: true,
			hasExtend: true,
			hasText: false,
			hasMidline: false,
		},
		defaultOptions: {
			color: '#787B86',
			fillOpacity: 0.12,
			lineWidth: 1.5,
			lineStyle: LineStyle.Solid,
			showLabels: true,
		},
	},
	{
		type: 'price-date-range',
		label: 'Price & Date Range',
		shortLabel: '价格时间测量尺',
		pointCount: 2,
		capabilities: {
			hasStroke: true,
			hasFill: true,
			hasLineWidth: true,
			hasLineStyle: false,
			hasExtend: false,
			hasText: false,
			hasMidline: false,
		},
		defaultOptions: {
			color: '#2962FF',
			fillColor: '#2962FF',
			fillOpacity: 0.18,
			lineWidth: 1.5,
			showLabels: true,
		},
	},
	{
		type: 'text',
		label: 'Text Annotation',
		shortLabel: '文本标注',
		pointCount: 1,
		capabilities: {
			hasStroke: true,
			hasFill: true,
			hasLineWidth: false,
			hasLineStyle: false,
			hasExtend: false,
			hasText: true,
			hasMidline: false,
		},
		defaultOptions: {
			color: '#2962FF',
			fillColor: '#1E222D',
			fillOpacity: 0.9,
			textColor: '#E0E3EB',
			fontSize: 13,
			text: 'Note',
		},
	},
	...EXTENDED_DEFINITIONS,
];

const definitionMap = new Map<DrawingToolType, ToolDefinition>(
	TOOL_DEFINITIONS.map(def => [def.type, def])
);

export function getToolDefinition(type: DrawingToolType): ToolDefinition {
	const def = definitionMap.get(type);
	if (!def) {
		throw new Error(`Unknown drawing tool type: ${type}`);
	}
	return def;
}

export function getToolStepHint(
	type: DrawingToolType,
	draftCount: number,
	options?: Partial<import('../types').DrawingStyleOptions>
): string {
	const def = getToolDefinition(type);
	if (type === 'long-position' || type === 'short-position') {
		return `${def.shortLabel} · 点击图上任意位置放置入场点`;
	}
	if ((PATTERN_TOOL_TYPES as readonly string[]).includes(type)) {
		return patternStepHint(type as PatternToolType, draftCount, options?.waveDegree);
	}
	if (type === 'fib-extension') {
		if (draftCount === 0) return '趋势斐波那契扩展 (1/3) · 点击放置趋势起点 A';
		if (draftCount === 1) return '趋势斐波那契扩展 (2/3) · 点击放置趋势终点 B';
		return '趋势斐波那契扩展 (3/3) · 点击放置回撤起点 C';
	}
	if (type === 'fib-channel') {
		if (draftCount === 0) return '斐波那契通道 (1/3) · 点击放置基线起点';
		if (draftCount === 1) return '斐波那契通道 (2/3) · 点击放置基线终点';
		return '斐波那契通道 (3/3) · 移动并点击确定通道宽度';
	}
	if (type === 'trend-fib-time') {
		if (draftCount === 0) return '趋势斐波那契时间 (1/3) · 点击放置基准起点 A';
		if (draftCount === 1) return '趋势斐波那契时间 (2/3) · 点击放置基准终点 B';
		return '趋势斐波那契时间 (3/3) · 点击放置投射起点 C';
	}
	if (type === 'fib-retracement') {
		return draftCount === 0
			? '斐波那契回撤 (1/2) · 点击放置回撤起点'
			: '斐波那契回撤 (2/2) · 移动至回撤终点点击';
	}
	if (def.creation === 'freehand') {
		return `${def.shortLabel} · 按住拖动画线，松手完成`;
	}
	if (def.creation === 'path') {
		return draftCount === 0
			? `${def.shortLabel} · 依次点击放置折点`
			: `${def.shortLabel} (${draftCount} 点) · 点击继续，双击/右键或点完成结束`;
	}
	if (def.pointCount === 1) {
		return `${def.shortLabel} · 点击或拖动定位后松手`;
	}
	if (def.pointCount === 2) {
		return draftCount === 0
			? `${def.shortLabel} · 点击两点或按住拖动绘制`
			: `${def.shortLabel} (1/2) · 移动至终点点击`;
	}
	return `${def.shortLabel} (${Math.min(draftCount + 1, def.pointCount)}/${def.pointCount}) · 依次点击锚点`;
}

export function createDrawingInstance(data: SerializedDrawing): BaseDrawing {
	const def = getToolDefinition(data.type);
	const centered = ['rectangle', 'circle', 'ellipse', 'parallel-channel', 'flat-channel', 'disjoint-channel'].includes(data.type);
	const mergedOptions: Partial<import('../types').DrawingStyleOptions> = { ...(centered ? { textPosition: 'middle' } as const : {}), ...def.defaultOptions, ...data.options };
	switch (data.type) {
		case 'trend-line':
			return new TrendLineDrawing(data.id, data.points, mergedOptions);
		case 'ray':
			return new RayDrawing(data.id, data.points, mergedOptions);
		case 'horizontal-line':
			return new HorizontalLineDrawing(data.id, data.points, mergedOptions);
		case 'vertical-line':
			return new VerticalLineDrawing(data.id, data.points, mergedOptions);
		case 'rectangle':
			return new RectangleDrawing(data.id, data.points, mergedOptions);
		case 'parallel-channel':
			return new ParallelChannelDrawing(data.id, data.points, mergedOptions);
		case 'fib-retracement':
			return new FibRetracementDrawing(data.id, data.points, mergedOptions);
		case 'fib-extension':
			return new FibExtensionDrawing(data.id, data.points, mergedOptions);
		case 'fib-channel':
			return new FibChannelDrawing(data.id, data.points, mergedOptions);
		case 'trend-fib-time':
			return new TrendFibTimeDrawing(data.id, data.points, mergedOptions);
		case 'long-position':
		case 'short-position':
			return new PositionDrawing(data.type, data.id, data.points, mergedOptions);
		case 'price-date-range':
			return new PriceDateRangeDrawing(data.id, data.points, mergedOptions);
		case 'text':
			return new TextAnnotationDrawing(data.id, data.points, mergedOptions);
		default:
			if ((PATTERN_TOOL_TYPES as readonly string[]).includes(data.type)) {
				return new PatternDrawing(data.type as PatternToolType, data.id, data.points, mergedOptions);
			}
			return new ExtendedDrawing(data.type, data.id, data.points, mergedOptions);
	}
}

export {
	FibChannelDrawing,
	FibExtensionDrawing,
	FibRetracementDrawing,
	HorizontalLineDrawing,
	isElliottTool,
	ParallelChannelDrawing,
	PatternDrawing,
	PositionDrawing,
	PriceDateRangeDrawing,
	RayDrawing,
	RectangleDrawing,
	TextAnnotationDrawing,
	TrendFibTimeDrawing,
	TrendLineDrawing,
	VerticalLineDrawing,
};
