import type { ToolDefinition, DrawingStyleOptions } from '../types';

/** Tool identifiers are stable persistence keys; labels may be localized independently. */
export const EXTENDED_TOOLS = [
	['extended-line', '延长线', '线条', 2], ['horizontal-ray', '水平射线', '线条', 1],
	['cross-line', '十字线', '线条', 1], ['trend-angle', '趋势角度', '线条', 2],
	['info-line', '信息线', '线条', 2], ['arrow', '箭头', '线条', 2], ['double-arrow', '双向箭头', '线条', 2],
	['flat-channel', '平顶 / 平底通道', '通道', 3], ['pitchfan', '分叉扇', '分叉线', 3],
	['disjoint-channel', '不相交通道', '通道', 4], ['regression-channel', '回归趋势通道', '通道', 2],
	['pitchfork', '安德鲁斯分叉线', '分叉线', 3], ['schiff-pitchfork', '希夫分叉线', '分叉线', 3],
	['modified-schiff', '修正希夫分叉线', '分叉线', 3], ['inside-pitchfork', '内部分叉线', '分叉线', 3],
	['fib-extension', '趋势斐波那契扩展', '斐波那契', 3], ['fib-channel', '斐波那契通道', '斐波那契', 3],
	['fib-time-zone', '斐波那契时间区间', '斐波那契', 2], ['trend-fib-time', '趋势斐波那契时间', '斐波那契', 3],
	['fib-fan', '斐波那契速度阻力扇', '斐波那契', 2], ['fib-arcs', '斐波那契速度阻力弧', '斐波那契', 2],
	['fib-circles', '斐波那契圆', '斐波那契', 2], ['fib-spiral', '斐波那契螺旋', '斐波那契', 2],
	['fib-wedge', '斐波那契楔形', '斐波那契', 3],
	['gann-square-fixed', '固定江恩正方', '江恩', 2],
	['gann-fan', '江恩扇', '江恩', 2], ['gann-box', '江恩箱', '江恩', 2], ['gann-square', '江恩正方', '江恩', 2],
	['brush', '画笔', '几何与画笔', 0], ['highlighter', '荧光笔', '几何与画笔', 0],
	['path', '路径', '几何与画笔', 0], ['arrow-path', '箭头路径', '几何与画笔', 0],
	['rotated-rectangle', '旋转矩形', '几何与画笔', 3], ['ellipse', '椭圆', '几何与画笔', 2],
	['circle', '圆', '几何与画笔', 2], ['triangle', '三角形', '几何与画笔', 3],
	['arc', '圆弧', '几何与画笔', 3], ['curve', '曲线', '几何与画笔', 3], ['double-curve', '双曲线', '几何与画笔', 4],
	['xabcd', 'XABCD 形态', '形态', 5], ['cypher', '赛福形态', '形态', 5], ['abcd', 'ABCD 形态', '形态', 4],
	['triangle-pattern', '三角形形态', '形态', 5], ['three-drives', '三驱动形态', '形态', 7],
	['head-shoulders', '头肩形态', '形态', 7], ['elliott-impulse', '艾略特推动浪 (12345)', '形态', 6],
	['elliott-correction', '艾略特修正浪 (ABC)', '形态', 4], ['elliott-triangle', '艾略特三角浪 (ABCDE)', '形态', 6],
	['elliott-double', '艾略特双重组合 (WXY)', '形态', 4], ['elliott-triple', '艾略特三重组合 (WXYXZ)', '形态', 6],
	['cycle-lines', '周期线', '周期', 2], ['time-cycles', '时间周期', '周期', 2], ['sine-line', '正弦线', '周期', 2],
	['long-position', '多头仓位', '预测与测量', 3], ['short-position', '空头仓位', '预测与测量', 3],
	['projection', '投射', '预测与测量', 3], ['ghost-feed', '幽灵 K 线', '预测与测量', 0],
	['forecast', '预测', '预测与测量', 2], ['bars-pattern', 'K 线形态复制', '预测与测量', 3],
	['price-range', '价格范围', '预测与测量', 2], ['date-range', '日期范围', '预测与测量', 2],
	['anchored-volume-profile', '锚定成交量分布', '成交量', 1],
	['anchored-vwap', '锚定 VWAP', '成交量', 1], ['fixed-volume-profile', '固定范围成交量分布', '成交量', 2],
	['anchored-text', '锚定文本', '文字与标注', 1], ['note', '笔记', '文字与标注', 1],
	['price-note', '价格笔记', '文字与标注', 2], ['pin', '图钉', '文字与标注', 1],
	['callout', '标注气泡', '文字与标注', 2], ['comment', '评论', '文字与标注', 1],
	['price-label', '价格标签', '文字与标注', 1], ['signpost', '路标', '文字与标注', 1],
	['flag', '旗形标记', '图标', 1], ['arrow-up', '向上箭头', '图标', 1], ['arrow-down', '向下箭头', '图标', 1],
	['emoji', '表情 / 图标', '图标', 1],
] as const;
export type ExtendedToolType = typeof EXTENDED_TOOLS[number][0];

export const EXTENDED_DEFINITIONS: ToolDefinition[] = EXTENDED_TOOLS.map(([type, label, group, pointCount]) => {
	const text = group === '文字与标注' || type === 'emoji';
	const options: Partial<DrawingStyleOptions> = { text: type === 'emoji' ? '★' : '标注', color: '#7c83ff' };
	if (type === 'highlighter') Object.assign(options, { lineWidth: 16, fillOpacity: 0.3, color: '#ffca28' });
	if (type === 'extended-line') Object.assign(options, { extendLeft: true, extendRight: true });
	if (group === '分叉线' || type === 'fib-fan' || type === 'gann-fan') options.extendRight = true;
	if (type === 'fib-extension') options.fibLevels = [0, 0.618, 1, 1.618, 2.618, 3.618, 4.236].map(value => ({ value, color: '#7c83ff', visible: true }));
	return {
		type, label, shortLabel: label, group, pointCount,
		creation: type === 'brush' || type === 'highlighter' ? 'freehand' : pointCount === 0 ? 'path' : 'points',
		capabilities: { hasStroke: true, hasFill: true, hasLineWidth: true, hasLineStyle: true, hasExtend: ['线条', '通道', '分叉线', '斐波那契'].includes(group), hasText: text, hasMidline: false },
		defaultOptions: options,
	};
});
