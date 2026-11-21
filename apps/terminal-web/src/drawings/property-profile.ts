import { attachedTextKind, getToolDefinition, type DrawingToolType } from '@tradingview/lwc-plugin-drawing-tools';

/** UI capabilities follow the current renderers, not the broader TradingView catalogue. */
export function propertyProfile(type: DrawingToolType) {
	const def = getToolDefinition(type);
	const attached = attachedTextKind(type);
	const primaryText = def.capabilities.hasText && type !== 'price-label';
	const is = (...types: DrawingToolType[]) => types.includes(type);
	const annotation = def.capabilities.hasText || is('price-label', 'flag', 'arrow-up', 'arrow-down');
	const pattern = def.group === '形态';
	const position = is('long-position', 'short-position');
	const volume = is('fixed-volume-profile', 'anchored-volume-profile');
	const levels = is('fib-retracement', 'fib-extension', 'fib-channel', 'trend-fib-time', 'fib-fan', 'fib-arcs', 'fib-circles', 'fib-wedge');
	const labels = pattern || position || volume || is('horizontal-line', 'vertical-line', 'price-date-range', 'horizontal-ray', 'trend-angle', 'info-line', 'forecast', 'pitchfan', 'regression-channel', 'fib-retracement', 'fib-extension', 'fib-channel', 'fib-time-zone', 'trend-fib-time', 'fib-fan', 'fib-arcs', 'fib-circles', 'gann-fan', 'projection', 'ghost-feed', 'price-range', 'date-range', 'anchored-vwap');
	const extendedLabels = labels && !is('horizontal-line', 'vertical-line', 'price-date-range', 'fib-retracement');
	const stroke = !annotation || is('text', 'callout', 'price-note', 'pin', 'signpost', 'flag', 'arrow-up', 'arrow-down');
	const fill = is('rectangle', 'parallel-channel', 'price-date-range', 'text', 'flat-channel', 'disjoint-channel', 'regression-channel', 'rotated-rectangle', 'ellipse', 'circle', 'triangle', 'xabcd', 'cypher', 'abcd', 'gann-box', 'gann-square', 'gann-square-fixed', 'price-range', 'date-range') || volume;
	return {
		stroke: stroke && !is('bars-pattern', 'ghost-feed') && !volume,
		width: stroke && type !== 'text' && attached !== 'mark',
		lineStyle: stroke && attached !== 'mark' && !is('text', 'price-date-range', 'brush', 'highlighter'),
		fill,
		opacity: fill || position || is('fib-retracement', 'highlighter', 'bars-pattern', 'ghost-feed'),
		text: primaryText || (attached !== null && attached !== 'levels'),
		primaryText, attached,
		font: annotation || extendedLabels || attached !== null,
		textColor: (attached !== null && attached !== 'levels') || annotation || (extendedLabels && !is('fib-extension', 'fib-channel', 'fib-fan', 'fib-arcs', 'fib-circles')),
		background: (annotation && !is('text', 'emoji', 'flag', 'arrow-up', 'arrow-down')) || extendedLabels,
		labels,
		extend: is('trend-line', 'ray', 'parallel-channel', 'fib-retracement', 'extended-line', 'horizontal-ray', 'trend-angle', 'info-line', 'flat-channel', 'pitchfan', 'disjoint-channel', 'regression-channel', 'pitchfork', 'schiff-pitchfork', 'modified-schiff', 'inside-pitchfork', 'fib-extension', 'fib-channel', 'fib-fan'),
		midline: type === 'parallel-channel',
		levels,
		levelColors: levels && type !== 'trend-fib-time' && type !== 'fib-wedge',
		position,
		volume,
		regression: type === 'regression-channel',
		annotation,
	};
}
