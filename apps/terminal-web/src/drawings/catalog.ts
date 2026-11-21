import { TOOL_DEFINITIONS, type DrawingToolType, type ToolDefinition } from '@tradingview/lwc-plugin-drawing-tools';

export interface DrawingToolSection {
	label: string;
	tools: readonly DrawingToolType[];
}
export interface DrawingToolGroup {
	id: string;
	label: string;
	sections: readonly DrawingToolSection[];
}

// Presentation only: keep the plugin's stable tool IDs and persistence format intact.
export const DRAWING_TOOL_GROUPS: readonly DrawingToolGroup[] = [
	{ id: 'lines', label: '趋势线工具', sections: [
		{ label: '线条', tools: ['trend-line', 'ray', 'info-line', 'extended-line', 'trend-angle', 'horizontal-line', 'horizontal-ray', 'vertical-line', 'cross-line'] },
		{ label: '通道', tools: ['parallel-channel', 'regression-channel', 'flat-channel', 'disjoint-channel'] },
		{ label: '分叉线', tools: ['pitchfork', 'schiff-pitchfork', 'modified-schiff', 'inside-pitchfork'] },
	] },
	{ id: 'fibonacci', label: '江恩与斐波那契工具', sections: [
		{ label: '斐波那契', tools: ['fib-retracement', 'fib-extension', 'fib-channel', 'fib-time-zone', 'fib-fan', 'trend-fib-time', 'fib-circles', 'fib-spiral', 'fib-arcs', 'fib-wedge', 'pitchfan'] },
		{ label: '江恩', tools: ['gann-box', 'gann-square-fixed', 'gann-square', 'gann-fan'] },
	] },
	{ id: 'patterns', label: '形态', sections: [
		{ label: '经典 / 谐波形态', tools: ['xabcd', 'cypher', 'head-shoulders', 'abcd', 'triangle-pattern', 'three-drives'] },
		{ label: '艾略特波浪', tools: ['elliott-impulse', 'elliott-correction', 'elliott-triangle', 'elliott-double', 'elliott-triple'] },
		{ label: '周期', tools: ['cycle-lines', 'time-cycles', 'sine-line'] },
	] },
	{ id: 'forecasting', label: '预测与测量工具', sections: [
		{ label: '预测', tools: ['long-position', 'short-position', 'forecast', 'bars-pattern', 'ghost-feed', 'projection'] },
		{ label: '成交量分析', tools: ['anchored-vwap', 'fixed-volume-profile', 'anchored-volume-profile'] },
		{ label: '测量', tools: ['price-range', 'date-range', 'price-date-range'] },
	] },
	{ id: 'shapes', label: '几何图形与画笔', sections: [
		{ label: '画笔', tools: ['brush', 'highlighter'] },
		{ label: '箭头', tools: ['arrow', 'double-arrow', 'arrow-path', 'arrow-up', 'arrow-down'] },
		{ label: '图形', tools: ['rectangle', 'rotated-rectangle', 'path', 'circle', 'ellipse', 'triangle', 'arc', 'curve', 'double-curve'] },
	] },
	{ id: 'annotations', label: '文字与标注工具', sections: [
		{ label: '文字', tools: ['text', 'anchored-text', 'note', 'price-note', 'pin', 'callout', 'comment', 'price-label', 'signpost', 'flag'] },
	] },
	{ id: 'icons', label: '图标', sections: [{ label: '图标', tools: ['emoji'] }] },
];

export const FEATURED_TOOLS: readonly DrawingToolType[] = ['trend-line', 'horizontal-line', 'ray', 'rectangle', 'fib-retracement', 'text'];
const definitions = new Map(TOOL_DEFINITIONS.map(def => [def.type, def]));
const labels: Partial<Record<DrawingToolType, string>> = {
	'price-date-range': '价格与日期范围', text: '文本', 'arrow-up': '向上箭头标记', 'arrow-down': '向下箭头标记', flag: '旗形标记',
};
export function toolLabel(type: DrawingToolType): string {
	return labels[type] ?? definitions.get(type)?.shortLabel ?? type;
}
export function sectionTools(section: DrawingToolSection): ToolDefinition[] {
	return section.tools.flatMap(type => { const definition = definitions.get(type); return definition ? [definition] : []; });
}
