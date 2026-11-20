import { LineStyle } from 'lightweight-charts';
import { BaseDrawing } from '../base-drawing';
import {
	DrawingToolType,
	SerializedDrawing,
	ToolDefinition,
} from '../types';
import { FibRetracementDrawing } from './fib-retracement';
import { HorizontalLineDrawing } from './horizontal-line';
import { ParallelChannelDrawing } from './parallel-channel';
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

export function createDrawingInstance(data: SerializedDrawing): BaseDrawing {
	const def = getToolDefinition(data.type);
	const mergedOptions = { ...def.defaultOptions, ...data.options };
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
		case 'price-date-range':
			return new PriceDateRangeDrawing(data.id, data.points, mergedOptions);
		case 'text':
			return new TextAnnotationDrawing(data.id, data.points, mergedOptions);
	}
}

export {
	FibRetracementDrawing,
	HorizontalLineDrawing,
	ParallelChannelDrawing,
	PriceDateRangeDrawing,
	RayDrawing,
	RectangleDrawing,
	TextAnnotationDrawing,
	TrendLineDrawing,
	VerticalLineDrawing,
};
