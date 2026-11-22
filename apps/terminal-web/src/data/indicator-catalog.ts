import type { Candle } from '@terminal/domain';
import {
	AD, ADX, Alligator, AO, Aroon, ATR,
	BollingerBands, BollingerBandsWidth, CCI, CHOP, CMF, CMO,
	DEMA, DonchianChannels, ElderRay, EMA, ForceIndex, HMA,
	IchimokuCloud, KAMA, KeltnerChannels, MACD, MFI, MOM, NATR,
	OBV, PercentB, PSAR, RMA, ROC, RSI, RVOL, SMA,
	StochasticOscillator, StochasticRSI, SuperTrend, TEMA, TRIX, TSI,
	UltimateOscillator, VortexIndicator, VWAP, VWMA, WaveTrend, WilliamsR, WMA, ZLEMA,
} from 'trading-signals';

export type IndicatorCategory = '趋势均线' | '通道与波动' | '动量摆动' | '成交量';

export interface IndicatorParamSpec {
	key: string;
	label: string;
	min: number;
	max: number;
	step: number;
	defaultValue: number;
	integer?: boolean;
}

export interface HistogramPalette {
	growUp: string;
	fallUp: string;
	growDown: string;
	fallDown: string;
}

export interface IndicatorColorSpec {
	key: string;
	label: string;
	defaultColor: string;
}

export interface IndicatorPlotSpec {
	key: string;
	label: string;
	kind: 'line' | 'histogram';
	color: string;
	lineWidth?: 1 | 2 | 3 | 4;
	lineStyle?: number;
	lastValueVisible?: boolean;
	histogramPalette?: HistogramPalette;
}

export const DEFAULT_HISTOGRAM_PALETTE: HistogramPalette = {
	growUp: '#26A69A',
	fallUp: '#B2DFDB',
	growDown: '#FF5252',
	fallDown: '#FFCDD2',
};

/** TradingView standard 4-color histogram palette: distinguishes above/below zero and growing/falling momentum. */
export function histogramBarColor(
	value: number,
	previous: number | undefined,
	palette: HistogramPalette = DEFAULT_HISTOGRAM_PALETTE,
): string {
	if (value >= 0) {
		return previous === undefined || value >= previous ? palette.growUp : palette.fallUp;
	}
	return previous === undefined || value <= previous ? palette.growDown : palette.fallDown;
}

export interface IndicatorRefLine {
	price: number;
	color: string;
	dashed?: boolean;
	title?: string;
}

export interface IndicatorRunner {
	plots: readonly IndicatorPlotSpec[];
	refLines?: readonly IndicatorRefLine[];
	fixedRange?: { minValue: number; maxValue: number };
	update(candle: Candle, replace: boolean): Record<string, number | null>;
}

export interface CatalogIndicator {
	id: string;
	shortName: string;
	name: string;
	description: string;
	category: IndicatorCategory;
	placement: 'overlay' | 'pane';
	popular: boolean;
	special?: 'ma' | 'ema' | 'volume';
	defaultColor?: string;
	colorSpecs?: readonly IndicatorColorSpec[];
	params: readonly IndicatorParamSpec[];
	createRunner?(params: Record<string, number>, color: string, plotColors?: Record<string, string>): IndicatorRunner;
}

const num = (params: Record<string, number>, key: string, fallback: number): number =>
	typeof params[key] === 'number' && Number.isFinite(params[key]) ? params[key] : fallback;

const int = (params: Record<string, number>, key: string, fallback: number, min = 1): number =>
	Math.max(min, Math.round(num(params, key, fallback)));

const safe = (v: number | null | undefined): number | null =>
	typeof v === 'number' && Number.isFinite(v) ? v : null;

function singlePrice(
	label: string,
	color: string,
	factory: () => { update(v: number, replace: boolean): number | null },
	refLines?: readonly IndicatorRefLine[],
	fixedRange?: { minValue: number; maxValue: number },
): IndicatorRunner {
	const ind = factory();
	return {
		plots: [{ key: 'value', label, kind: 'line', color, lineWidth: 2 }],
		refLines,
		fixedRange,
		update: (c, replace) => ({ value: safe(ind.update(c.close, replace)) }),
	};
}

function singleCandle(
	label: string,
	color: string,
	factory: () => { update(c: Candle, replace: boolean): number | null },
	refLines?: readonly IndicatorRefLine[],
	fixedRange?: { minValue: number; maxValue: number },
): IndicatorRunner {
	const ind = factory();
	return {
		plots: [{ key: 'value', label, kind: 'line', color, lineWidth: 2 }],
		refLines,
		fixedRange,
		update: (c, replace) => ({ value: safe(ind.update(c, replace)) }),
	};
}

export const INDICATOR_CATEGORIES: readonly IndicatorCategory[] = ['趋势均线', '通道与波动', '动量摆动', '成交量'];

export const INDICATOR_CATALOG: readonly CatalogIndicator[] = [
	// === 常用指标（TradingView 风格置顶）===
	{
		id: 'ma', shortName: 'MA', name: '移动平均线', description: '简单移动平均线（SMA），支持最多 5 条自定义周期与颜色',
		category: '趋势均线', placement: 'overlay', popular: true, special: 'ma', params: [],
	},
	{
		id: 'ema', shortName: 'EMA', name: '指数移动平均线', description: '指数加权移动平均线，支持最多 5 条自定义周期与颜色',
		category: '趋势均线', placement: 'overlay', popular: true, special: 'ema', params: [],
	},
	{
		id: 'boll', shortName: 'BOLL', name: '布林带', description: 'Bollinger Bands 上中下轨通道，衡量价格波动区间',
		category: '通道与波动', placement: 'overlay', popular: true, defaultColor: '#2962ff',
		params: [
			{ key: 'period', label: '周期', min: 2, max: 200, step: 1, defaultValue: 20, integer: true },
			{ key: 'multiplier', label: '标准差倍数', min: 0.5, max: 5, step: 0.1, defaultValue: 2 },
		],
		createRunner(params, color) {
			const period = int(params, 'period', 20, 2);
			const mult = num(params, 'multiplier', 2);
			const ind = new BollingerBands(period, mult);
			return {
				plots: [
					{ key: 'upper', label: `BOLL上轨(${period})`, kind: 'line', color, lineWidth: 1 },
					{ key: 'middle', label: '中轨', kind: 'line', color: '#ff9800', lineWidth: 1, lineStyle: 2 },
					{ key: 'lower', label: '下轨', kind: 'line', color, lineWidth: 1 },
				],
				update(c, replace) {
					const r = ind.update(c.close, replace);
					return r ? { upper: safe(r.upper), middle: safe(r.middle), lower: safe(r.lower) } : { upper: null, middle: null, lower: null };
				},
			};
		},
	},
	{
		id: 'volume', shortName: 'VOL', name: '成交量', description: '交易所真实基础币成交量柱状图',
		category: '成交量', placement: 'overlay', popular: true, special: 'volume', params: [],
	},
	{
		id: 'macd', shortName: 'MACD', name: '指数平滑异同移动平均线', description: '经典趋势与动量副图（DIF / DEA / 能量柱）',
		category: '动量摆动', placement: 'pane', popular: true, defaultColor: '#4285ff',
		colorSpecs: [
			{ key: 'macd', label: '快线颜色 (DIF)', defaultColor: '#4285ff' },
			{ key: 'signal', label: '慢线颜色 (DEA)', defaultColor: '#ff9e2c' },
			{ key: 'histGrowUp', label: '能量柱 · 上涨增强', defaultColor: '#26a69a' },
			{ key: 'histFallUp', label: '能量柱 · 上涨减弱', defaultColor: '#b2dfdb' },
			{ key: 'histGrowDown', label: '能量柱 · 下跌增强', defaultColor: '#ff5252' },
			{ key: 'histFallDown', label: '能量柱 · 下跌减弱', defaultColor: '#ffcdd2' },
		],
		params: [
			{ key: 'fast', label: '快线周期', min: 2, max: 100, step: 1, defaultValue: 12, integer: true },
			{ key: 'slow', label: '慢线周期', min: 3, max: 200, step: 1, defaultValue: 26, integer: true },
			{ key: 'signal', label: '信号周期', min: 2, max: 100, step: 1, defaultValue: 9, integer: true },
		],
		createRunner(params, color, plotColors) {
			const fast = int(params, 'fast', 12, 2);
			const slow = int(params, 'slow', 26, 3);
			const sig = int(params, 'signal', 9, 2);
			const ind = new MACD(new EMA(fast), new EMA(slow), new EMA(sig));
			const macdColor = plotColors?.macd ?? color;
			const signalColor = plotColors?.signal ?? '#ff9e2c';
			const histogramPalette: HistogramPalette = {
				growUp: plotColors?.histGrowUp ?? DEFAULT_HISTOGRAM_PALETTE.growUp,
				fallUp: plotColors?.histFallUp ?? DEFAULT_HISTOGRAM_PALETTE.fallUp,
				growDown: plotColors?.histGrowDown ?? DEFAULT_HISTOGRAM_PALETTE.growDown,
				fallDown: plotColors?.histFallDown ?? DEFAULT_HISTOGRAM_PALETTE.fallDown,
			};
			return {
				plots: [
					{ key: 'histogram', label: '柱', kind: 'histogram', color: histogramPalette.growUp, lastValueVisible: true, histogramPalette },
					{ key: 'macd', label: `DIF(${fast},${slow})`, kind: 'line', color: macdColor, lineWidth: 1, lastValueVisible: true },
					{ key: 'signal', label: `DEA(${sig})`, kind: 'line', color: signalColor, lineWidth: 1, lastValueVisible: true },
				],
				update(c, replace) {
					const r = ind.update(c.close, replace);
					return r ? { histogram: safe(r.histogram), macd: safe(r.macd), signal: safe(r.signal) } : { histogram: null, macd: null, signal: null };
				},
			};
		},
	},
	{
		id: 'rsi', shortName: 'RSI', name: '相对强弱指标', description: 'Wilder RSI 超买超卖指标（70 / 30 参考线）',
		category: '动量摆动', placement: 'pane', popular: true, defaultColor: '#a78bfa',
		params: [{ key: 'period', label: '周期', min: 2, max: 200, step: 1, defaultValue: 14, integer: true }],
		createRunner(params, color) {
			const period = int(params, 'period', 14, 2);
			return singlePrice(
				`RSI(${period})`,
				color,
				() => new RSI(period),
				[
					{ price: 70, color: '#ef535066', dashed: true, title: '70' },
					{ price: 50, color: '#787b8644', dashed: true },
					{ price: 30, color: '#26a69a66', dashed: true, title: '30' },
				],
				{ minValue: 15, maxValue: 85 },
			);
		},
	},
	{
		id: 'kdj', shortName: 'KDJ', name: '随机指标 (KDJ / Stoch)', description: 'Stochastic Oscillator K / D / J 三线随机摆动指标',
		category: '动量摆动', placement: 'pane', popular: true, defaultColor: '#f5c542',
		params: [
			{ key: 'kPeriod', label: 'K 周期', min: 2, max: 100, step: 1, defaultValue: 9, integer: true },
			{ key: 'kSlow', label: 'K 平滑', min: 1, max: 50, step: 1, defaultValue: 3, integer: true },
			{ key: 'dPeriod', label: 'D 周期', min: 1, max: 50, step: 1, defaultValue: 3, integer: true },
		],
		createRunner(params, color) {
			const kPeriod = int(params, 'kPeriod', 9, 2);
			const kSlowingPeriod = int(params, 'kSlow', 3, 1);
			const dPeriod = int(params, 'dPeriod', 3, 1);
			const ind = new StochasticOscillator({ kPeriod, kSlowingPeriod, dPeriod });
			return {
				plots: [
					{ key: 'k', label: 'K', kind: 'line', color, lineWidth: 1 },
					{ key: 'd', label: 'D', kind: 'line', color: '#42a5f5', lineWidth: 1 },
					{ key: 'j', label: 'J', kind: 'line', color: '#e964a4', lineWidth: 1 },
				],
				refLines: [
					{ price: 80, color: '#ef535066', dashed: true, title: '80' },
					{ price: 20, color: '#26a69a66', dashed: true, title: '20' },
				],
				fixedRange: { minValue: 0, maxValue: 100 },
				update(c, replace) {
					const r = ind.update(c, replace);
					return r ? { k: safe(r.stochK), d: safe(r.stochD), j: safe(r.stochJ) } : { k: null, d: null, j: null };
				},
			};
		},
	},
	{
		id: 'vwap', shortName: 'VWAP', name: '成交量加权平均价', description: 'Volume Weighted Average Price 机构成本均价线',
		category: '趋势均线', placement: 'overlay', popular: true, defaultColor: '#ff9800',
		params: [],
		createRunner(_params, color) {
			return singleCandle('VWAP', color, () => new VWAP());
		},
	},

	// === 全部指标（扩展 trading-signals 全量常用技术指标）===
	{
		id: 'supertrend', shortName: 'ST', name: 'SuperTrend 超级趋势', description: '基于 ATR 的趋势跟踪止损线',
		category: '趋势均线', placement: 'overlay', popular: false, defaultColor: '#26a69a',
		params: [
			{ key: 'period', label: 'ATR 周期', min: 2, max: 100, step: 1, defaultValue: 10, integer: true },
			{ key: 'multiplier', label: '倍数', min: 0.5, max: 10, step: 0.1, defaultValue: 3 },
		],
		createRunner(params, color) {
			const interval = int(params, 'period', 10, 2);
			const multiplier = num(params, 'multiplier', 3);
			const ind = new SuperTrend({ interval, multiplier });
			return {
				plots: [{ key: 'value', label: `SuperTrend(${interval},${multiplier})`, kind: 'line', color, lineWidth: 2 }],
				update(c, replace) {
					const r = ind.update(c, replace);
					return { value: safe(r?.supertrend) };
				},
			};
		},
	},
	{
		id: 'psar', shortName: 'SAR', name: '抛物线转向指标', description: 'Parabolic SAR 趋势反转与跟踪止损点位',
		category: '趋势均线', placement: 'overlay', popular: false, defaultColor: '#f59e0b',
		params: [
			{ key: 'step', label: '加速步长', min: 0.005, max: 0.2, step: 0.005, defaultValue: 0.02 },
			{ key: 'max', label: '加速上限', min: 0.05, max: 1, step: 0.05, defaultValue: 0.2 },
		],
		createRunner(params, color) {
			const ind = new PSAR({ accelerationStep: num(params, 'step', 0.02), accelerationMax: num(params, 'max', 0.2) });
			return singleCandle('SAR', color, () => ind);
		},
	},
	{
		id: 'ichimoku', shortName: 'ICHI', name: '一目均衡表', description: 'Ichimoku Cloud 转换线 / 基准线 / 先行带 A / 先行带 B',
		category: '趋势均线', placement: 'overlay', popular: false, defaultColor: '#2962ff',
		params: [
			{ key: 'conversion', label: '转换周期', min: 2, max: 100, step: 1, defaultValue: 9, integer: true },
			{ key: 'base', label: '基准周期', min: 2, max: 200, step: 1, defaultValue: 26, integer: true },
			{ key: 'spanB', label: '先行 B 周期', min: 2, max: 300, step: 1, defaultValue: 52, integer: true },
		],
		createRunner(params, color) {
			const ind = new IchimokuCloud({
				conversionInterval: int(params, 'conversion', 9, 2),
				baseInterval: int(params, 'base', 26, 2),
				spanBInterval: int(params, 'spanB', 52, 2),
			});
			return {
				plots: [
					{ key: 'conversion', label: '转换线', kind: 'line', color, lineWidth: 1 },
					{ key: 'base', label: '基准线', kind: 'line', color: '#ef5350', lineWidth: 1 },
					{ key: 'spanA', label: '先行A', kind: 'line', color: '#26a69a', lineWidth: 1, lineStyle: 2 },
					{ key: 'spanB', label: '先行B', kind: 'line', color: '#f23645', lineWidth: 1, lineStyle: 2 },
				],
				update(c, replace) {
					const r = ind.update(c, replace);
					return r ? { conversion: safe(r.conversion), base: safe(r.base), spanA: safe(r.spanA), spanB: safe(r.spanB) } : { conversion: null, base: null, spanA: null, spanB: null };
				},
			};
		},
	},
	{
		id: 'wma', shortName: 'WMA', name: '加权移动平均线', description: 'Weighted Moving Average 线性加权均线',
		category: '趋势均线', placement: 'overlay', popular: false, defaultColor: '#38bdf8',
		params: [{ key: 'period', label: '周期', min: 2, max: 300, step: 1, defaultValue: 20, integer: true }],
		createRunner: (p, c) => singlePrice(`WMA(${int(p, 'period', 20, 2)})`, c, () => new WMA(int(p, 'period', 20, 2))),
	},
	{
		id: 'dema', shortName: 'DEMA', name: '双重指数移动平均线', description: 'Double EMA 降低均线滞后性',
		category: '趋势均线', placement: 'overlay', popular: false, defaultColor: '#34d399',
		params: [{ key: 'period', label: '周期', min: 2, max: 300, step: 1, defaultValue: 20, integer: true }],
		createRunner: (p, c) => singlePrice(`DEMA(${int(p, 'period', 20, 2)})`, c, () => new DEMA(int(p, 'period', 20, 2))),
	},
	{
		id: 'tema', shortName: 'TEMA', name: '三重指数移动平均线', description: 'Triple EMA 更灵敏的趋势追踪均线',
		category: '趋势均线', placement: 'overlay', popular: false, defaultColor: '#fb7185',
		params: [{ key: 'period', label: '周期', min: 2, max: 300, step: 1, defaultValue: 20, integer: true }],
		createRunner: (p, c) => singlePrice(`TEMA(${int(p, 'period', 20, 2)})`, c, () => new TEMA(int(p, 'period', 20, 2))),
	},
	{
		id: 'hma', shortName: 'HMA', name: '赫尔移动平均线', description: 'Hull Moving Average 兼具平滑与低延迟',
		category: '趋势均线', placement: 'overlay', popular: false, defaultColor: '#c084fc',
		params: [{ key: 'period', label: '周期', min: 2, max: 300, step: 1, defaultValue: 20, integer: true }],
		createRunner: (p, c) => singlePrice(`HMA(${int(p, 'period', 20, 2)})`, c, () => new HMA(int(p, 'period', 20, 2))),
	},
	{
		id: 'rma', shortName: 'RMA', name: '威尔德平滑均线', description: 'Running / Wilder Moving Average',
		category: '趋势均线', placement: 'overlay', popular: false, defaultColor: '#fbbf24',
		params: [{ key: 'period', label: '周期', min: 2, max: 300, step: 1, defaultValue: 20, integer: true }],
		createRunner: (p, c) => singlePrice(`RMA(${int(p, 'period', 20, 2)})`, c, () => new RMA(int(p, 'period', 20, 2))),
	},
	{
		id: 'kama', shortName: 'KAMA', name: '考夫曼自适应均线', description: 'Kaufman Adaptive MA 根据市场噪音自动调节灵敏度',
		category: '趋势均线', placement: 'overlay', popular: false, defaultColor: '#22d3ee',
		params: [{ key: 'period', label: '周期', min: 2, max: 200, step: 1, defaultValue: 10, integer: true }],
		createRunner: (p, c) => singlePrice(`KAMA(${int(p, 'period', 10, 2)})`, c, () => new KAMA(int(p, 'period', 10, 2))),
	},
	{
		id: 'zlema', shortName: 'ZLEMA', name: '零延迟指数均线', description: 'Zero-Lag EMA 减少相位延迟',
		category: '趋势均线', placement: 'overlay', popular: false, defaultColor: '#f472b6',
		params: [{ key: 'period', label: '周期', min: 2, max: 300, step: 1, defaultValue: 20, integer: true }],
		createRunner: (p, c) => singlePrice(`ZLEMA(${int(p, 'period', 20, 2)})`, c, () => new ZLEMA(int(p, 'period', 20, 2))),
	},
	{
		id: 'vwma', shortName: 'VWMA', name: '成交量加权移动平均', description: 'Volume Weighted Moving Average',
		category: '趋势均线', placement: 'overlay', popular: false, defaultColor: '#a3e635',
		params: [{ key: 'period', label: '周期', min: 2, max: 300, step: 1, defaultValue: 20, integer: true }],
		createRunner: (p, c) => singleCandle(`VWMA(${int(p, 'period', 20, 2)})`, c, () => new VWMA(int(p, 'period', 20, 2))),
	},
	{
		id: 'alligator', shortName: 'ALLIG', name: '鳄鱼指标', description: 'Williams Alligator 颌线 / 齿线 / 唇线三线组合',
		category: '趋势均线', placement: 'overlay', popular: false, defaultColor: '#3b82f6',
		params: [],
		createRunner(_params, color) {
			const ind = new Alligator();
			return {
				plots: [
					{ key: 'jaw', label: '颌线', kind: 'line', color, lineWidth: 1 },
					{ key: 'teeth', label: '齿线', kind: 'line', color: '#ef4444', lineWidth: 1 },
					{ key: 'lips', label: '唇线', kind: 'line', color: '#22c55e', lineWidth: 1 },
				],
				update(c, replace) {
					const r = ind.update(c, replace);
					return r ? { jaw: safe(r.jaw), teeth: safe(r.teeth), lips: safe(r.lips) } : { jaw: null, teeth: null, lips: null };
				},
			};
		},
	},

	// 通道与波动
	{
		id: 'kc', shortName: 'KC', name: '肯特纳通道', description: 'Keltner Channels 基于 EMA 与 ATR 的价格通道',
		category: '通道与波动', placement: 'overlay', popular: false, defaultColor: '#06b6d4',
		params: [
			{ key: 'emaPeriod', label: 'EMA 周期', min: 2, max: 200, step: 1, defaultValue: 20, integer: true },
			{ key: 'atrPeriod', label: 'ATR 周期', min: 2, max: 200, step: 1, defaultValue: 10, integer: true },
			{ key: 'multiplier', label: '倍数', min: 0.5, max: 5, step: 0.1, defaultValue: 2 },
		],
		createRunner(params, color) {
			const ind = new KeltnerChannels({
				emaInterval: int(params, 'emaPeriod', 20, 2),
				atrInterval: int(params, 'atrPeriod', 10, 2),
				multiplier: num(params, 'multiplier', 2),
			});
			return {
				plots: [
					{ key: 'upper', label: 'KC上轨', kind: 'line', color, lineWidth: 1 },
					{ key: 'middle', label: '中轨', kind: 'line', color: '#f59e0b', lineWidth: 1, lineStyle: 2 },
					{ key: 'lower', label: '下轨', kind: 'line', color, lineWidth: 1 },
				],
				update(c, replace) {
					const r = ind.update(c, replace);
					return r ? { upper: safe(r.upper), middle: safe(r.middle), lower: safe(r.lower) } : { upper: null, middle: null, lower: null };
				},
			};
		},
	},
	{
		id: 'dc', shortName: 'DC', name: '唐奇安通道', description: 'Donchian Channels 周期最高/最低突破通道',
		category: '通道与波动', placement: 'overlay', popular: false, defaultColor: '#60a5fa',
		params: [{ key: 'period', label: '周期', min: 2, max: 200, step: 1, defaultValue: 20, integer: true }],
		createRunner(params, color) {
			const period = int(params, 'period', 20, 2);
			const ind = new DonchianChannels(period);
			return {
				plots: [
					{ key: 'upper', label: `DC上轨(${period})`, kind: 'line', color, lineWidth: 1 },
					{ key: 'middle', label: '中轨', kind: 'line', color: '#94a3b8', lineWidth: 1, lineStyle: 2 },
					{ key: 'lower', label: '下轨', kind: 'line', color, lineWidth: 1 },
				],
				update(c, replace) {
					const r = ind.update(c, replace);
					return r ? { upper: safe(r.upper), middle: safe(r.middle), lower: safe(r.lower) } : { upper: null, middle: null, lower: null };
				},
			};
		},
	},
	{
		id: 'atr', shortName: 'ATR', name: '平均真实波幅', description: 'Average True Range 衡量市场波动率强度',
		category: '通道与波动', placement: 'pane', popular: false, defaultColor: '#f97316',
		params: [{ key: 'period', label: '周期', min: 2, max: 200, step: 1, defaultValue: 14, integer: true }],
		createRunner: (p, c) => singleCandle(`ATR(${int(p, 'period', 14, 2)})`, c, () => new ATR(int(p, 'period', 14, 2))),
	},
	{
		id: 'natr', shortName: 'NATR', name: '标准化真实波幅', description: 'Normalized ATR 百分比形式的波动率指标',
		category: '通道与波动', placement: 'pane', popular: false, defaultColor: '#fb923c',
		params: [{ key: 'period', label: '周期', min: 2, max: 200, step: 1, defaultValue: 14, integer: true }],
		createRunner: (p, c) => singleCandle(`NATR(${int(p, 'period', 14, 2)})`, c, () => new NATR(int(p, 'period', 14, 2))),
	},
	{
		id: 'bbw', shortName: 'BBW', name: '布林带宽度', description: 'Bollinger Bands Width 识别挤压变盘前兆',
		category: '通道与波动', placement: 'pane', popular: false, defaultColor: '#38bdf8',
		params: [
			{ key: 'period', label: '周期', min: 2, max: 200, step: 1, defaultValue: 20, integer: true },
			{ key: 'multiplier', label: '倍数', min: 0.5, max: 5, step: 0.1, defaultValue: 2 },
		],
		createRunner: (p, c) => singlePrice(
			`BBW(${int(p, 'period', 20, 2)})`,
			c,
			() => new BollingerBandsWidth(new BollingerBands(int(p, 'period', 20, 2), num(p, 'multiplier', 2))),
		),
	},
	{
		id: 'pb', shortName: '%B', name: '布林带百分比 (%B)', description: '衡量收盘价处于布林带上下轨的相对位置',
		category: '通道与波动', placement: 'pane', popular: false, defaultColor: '#6366f1',
		params: [
			{ key: 'period', label: '周期', min: 2, max: 200, step: 1, defaultValue: 20, integer: true },
			{ key: 'multiplier', label: '倍数', min: 0.5, max: 5, step: 0.1, defaultValue: 2 },
		],
		createRunner: (p, c) => singlePrice(
			`%B(${int(p, 'period', 20, 2)})`,
			c,
			() => new PercentB({ interval: int(p, 'period', 20, 2), deviationMultiplier: num(p, 'multiplier', 2) }),
			[
				{ price: 1, color: '#ef535066', dashed: true, title: '1' },
				{ price: 0, color: '#26a69a66', dashed: true, title: '0' },
			],
		),
	},
	{
		id: 'chop', shortName: 'CHOP', name: '震荡指数', description: 'Choppiness Index 区分趋势行情与震荡区间',
		category: '通道与波动', placement: 'pane', popular: false, defaultColor: '#eab308',
		params: [{ key: 'period', label: '周期', min: 2, max: 100, step: 1, defaultValue: 14, integer: true }],
		createRunner: (p, c) => singleCandle(
			`CHOP(${int(p, 'period', 14, 2)})`,
			c,
			() => new CHOP(int(p, 'period', 14, 2)),
			[
				{ price: 61.8, color: '#ef535066', dashed: true, title: '61.8' },
				{ price: 38.2, color: '#26a69a66', dashed: true, title: '38.2' },
			],
			{ minValue: 20, maxValue: 80 },
		),
	},

	// 动量摆动
	{
		id: 'stochrsi', shortName: 'StochRSI', name: '随机相对强弱指标', description: 'Stochastic RSI 更灵敏的超买超卖信号',
		category: '动量摆动', placement: 'pane', popular: false, defaultColor: '#818cf8',
		params: [{ key: 'period', label: '周期', min: 2, max: 200, step: 1, defaultValue: 14, integer: true }],
		createRunner: (p, c) => singlePrice(
			`StochRSI(${int(p, 'period', 14, 2)})`,
			c,
			() => new StochasticRSI(int(p, 'period', 14, 2)),
			[
				{ price: 0.8, color: '#ef535066', dashed: true, title: '0.8' },
				{ price: 0.2, color: '#26a69a66', dashed: true, title: '0.2' },
			],
			{ minValue: 0, maxValue: 1 },
		),
	},
	{
		id: 'adx', shortName: 'ADX', name: '平均趋向指数', description: 'ADX / +DI / -DI 衡量趋势强度与方向',
		category: '动量摆动', placement: 'pane', popular: false, defaultColor: '#f43f5e',
		params: [{ key: 'period', label: '周期', min: 2, max: 100, step: 1, defaultValue: 14, integer: true }],
		createRunner(params, color) {
			const period = int(params, 'period', 14, 2);
			const ind = new ADX(period);
			return {
				plots: [
					{ key: 'adx', label: `ADX(${period})`, kind: 'line', color, lineWidth: 2 },
					{ key: 'pdi', label: '+DI', kind: 'line', color: '#26a69a', lineWidth: 1 },
					{ key: 'mdi', label: '-DI', kind: 'line', color: '#ef5350', lineWidth: 1 },
				],
				refLines: [{ price: 25, color: '#787b8666', dashed: true, title: '25' }],
				fixedRange: { minValue: 0, maxValue: 60 },
				update(c, replace) {
					const adx = ind.update(c, replace);
					return { adx: safe(adx), pdi: safe(typeof ind.pdi === 'number' ? ind.pdi : null), mdi: safe(typeof ind.mdi === 'number' ? ind.mdi : null) };
				},
			};
		},
	},
	{
		id: 'cci', shortName: 'CCI', name: '顺势指标', description: 'Commodity Channel Index 识别极端偏离区间',
		category: '动量摆动', placement: 'pane', popular: false, defaultColor: '#2dd4bf',
		params: [{ key: 'period', label: '周期', min: 2, max: 200, step: 1, defaultValue: 20, integer: true }],
		createRunner: (p, c) => singleCandle(
			`CCI(${int(p, 'period', 20, 2)})`,
			c,
			() => new CCI(int(p, 'period', 20, 2)),
			[
				{ price: 100, color: '#ef535066', dashed: true, title: '100' },
				{ price: -100, color: '#26a69a66', dashed: true, title: '-100' },
			],
		),
	},
	{
		id: 'willr', shortName: 'W%R', name: '威廉指标', description: 'Williams %R 动量反转指标（-20 / -80 参考线）',
		category: '动量摆动', placement: 'pane', popular: false, defaultColor: '#ec4899',
		params: [{ key: 'period', label: '周期', min: 2, max: 200, step: 1, defaultValue: 14, integer: true }],
		createRunner: (p, c) => singleCandle(
			`W%R(${int(p, 'period', 14, 2)})`,
			c,
			() => new WilliamsR(int(p, 'period', 14, 2)),
			[
				{ price: -20, color: '#ef535066', dashed: true, title: '-20' },
				{ price: -80, color: '#26a69a66', dashed: true, title: '-80' },
			],
			{ minValue: -100, maxValue: 0 },
		),
	},
	{
		id: 'ao', shortName: 'AO', name: '动量震荡指标', description: 'Awesome Oscillator 5/34 中价差柱状图',
		category: '动量摆动', placement: 'pane', popular: false, defaultColor: '#26a69a',
		params: [
			{ key: 'short', label: '短周期', min: 2, max: 100, step: 1, defaultValue: 5, integer: true },
			{ key: 'long', label: '长周期', min: 3, max: 200, step: 1, defaultValue: 34, integer: true },
		],
		createRunner(params, color) {
			const ind = new AO(int(params, 'short', 5, 2), int(params, 'long', 34, 3));
			return {
				plots: [{ key: 'value', label: 'AO', kind: 'histogram', color }],
				refLines: [{ price: 0, color: '#787b8644', dashed: true }],
				update: (c, replace) => ({ value: safe(ind.update(c, replace)) }),
			};
		},
	},
	{
		id: 'aroon', shortName: 'AROON', name: '阿隆指标', description: 'Aroon Up / Down 监测趋势起始与衰竭',
		category: '动量摆动', placement: 'pane', popular: false, defaultColor: '#22c55e',
		params: [{ key: 'period', label: '周期', min: 2, max: 100, step: 1, defaultValue: 14, integer: true }],
		createRunner(params, color) {
			const ind = new Aroon(int(params, 'period', 14, 2));
			return {
				plots: [
					{ key: 'up', label: 'Aroon Up', kind: 'line', color, lineWidth: 1 },
					{ key: 'down', label: 'Aroon Down', kind: 'line', color: '#ef4444', lineWidth: 1 },
				],
				fixedRange: { minValue: 0, maxValue: 100 },
				update(c, replace) {
					const r = ind.update(c, replace);
					return r ? { up: safe(r.aroonUp), down: safe(r.aroonDown) } : { up: null, down: null };
				},
			};
		},
	},
	{
		id: 'vortex', shortName: 'VI', name: '漩涡指标', description: 'Vortex Indicator VI+ / VI- 趋势交叉信号',
		category: '动量摆动', placement: 'pane', popular: false, defaultColor: '#3b82f6',
		params: [{ key: 'period', label: '周期', min: 2, max: 100, step: 1, defaultValue: 14, integer: true }],
		createRunner(params, color) {
			const ind = new VortexIndicator(int(params, 'period', 14, 2));
			return {
				plots: [
					{ key: 'plus', label: 'VI+', kind: 'line', color, lineWidth: 1 },
					{ key: 'minus', label: 'VI-', kind: 'line', color: '#f97316', lineWidth: 1 },
				],
				refLines: [{ price: 1, color: '#787b8644', dashed: true }],
				update(c, replace) {
					const r = ind.update(c, replace);
					return r ? { plus: safe(r.plus), minus: safe(r.minus) } : { plus: null, minus: null };
				},
			};
		},
	},
	{
		id: 'mom', shortName: 'MOM', name: '动量指标', description: 'Momentum 收盘价动量差值',
		category: '动量摆动', placement: 'pane', popular: false, defaultColor: '#60a5fa',
		params: [{ key: 'period', label: '周期', min: 1, max: 200, step: 1, defaultValue: 10, integer: true }],
		createRunner: (p, c) => singlePrice(`MOM(${int(p, 'period', 10, 1)})`, c, () => new MOM(int(p, 'period', 10, 1)), [{ price: 0, color: '#787b8644', dashed: true }]),
	},
	{
		id: 'roc', shortName: 'ROC', name: '变动率指标', description: 'Rate of Change 价格变化速率百分比',
		category: '动量摆动', placement: 'pane', popular: false, defaultColor: '#34d399',
		params: [{ key: 'period', label: '周期', min: 1, max: 200, step: 1, defaultValue: 12, integer: true }],
		createRunner: (p, c) => singlePrice(`ROC(${int(p, 'period', 12, 1)})`, c, () => new ROC(int(p, 'period', 12, 1)), [{ price: 0, color: '#787b8644', dashed: true }]),
	},
	{
		id: 'cmo', shortName: 'CMO', name: '钱德动量摆动指标', description: 'Chande Momentum Oscillator（+50 / -50）',
		category: '动量摆动', placement: 'pane', popular: false, defaultColor: '#f472b6',
		params: [{ key: 'period', label: '周期', min: 2, max: 200, step: 1, defaultValue: 14, integer: true }],
		createRunner: (p, c) => singlePrice(
			`CMO(${int(p, 'period', 14, 2)})`,
			c,
			() => new CMO(int(p, 'period', 14, 2)),
			[
				{ price: 50, color: '#ef535066', dashed: true, title: '50' },
				{ price: -50, color: '#26a69a66', dashed: true, title: '-50' },
			],
		),
	},
	{
		id: 'trix', shortName: 'TRIX', name: '三重指数平滑平均线', description: 'TRIX 过滤短期噪声的动量摆动线',
		category: '动量摆动', placement: 'pane', popular: false, defaultColor: '#c084fc',
		params: [{ key: 'period', label: '周期', min: 2, max: 100, step: 1, defaultValue: 15, integer: true }],
		createRunner: (p, c) => singlePrice(`TRIX(${int(p, 'period', 15, 2)})`, c, () => new TRIX(int(p, 'period', 15, 2)), [{ price: 0, color: '#787b8644', dashed: true }]),
	},
	{
		id: 'tsi', shortName: 'TSI', name: '真实强度指数', description: 'True Strength Index 双重平滑动量指标',
		category: '动量摆动', placement: 'pane', popular: false, defaultColor: '#38bdf8',
		params: [
			{ key: 'long', label: '长周期', min: 2, max: 100, step: 1, defaultValue: 25, integer: true },
			{ key: 'short', label: '短周期', min: 2, max: 50, step: 1, defaultValue: 13, integer: true },
		],
		createRunner: (p, c) => singlePrice(`TSI`, c, () => new TSI({ longPeriod: int(p, 'long', 25, 2), shortPeriod: int(p, 'short', 13, 2) }), [{ price: 0, color: '#787b8644', dashed: true }]),
	},
	{
		id: 'ultosc', shortName: 'UO', name: '终极震荡指标', description: 'Ultimate Oscillator 多周期加权动量指标',
		category: '动量摆动', placement: 'pane', popular: false, defaultColor: '#f59e0b',
		params: [
			{ key: 'short', label: '短周期', min: 2, max: 50, step: 1, defaultValue: 7, integer: true },
			{ key: 'medium', label: '中周期', min: 3, max: 100, step: 1, defaultValue: 14, integer: true },
			{ key: 'long', label: '长周期', min: 4, max: 200, step: 1, defaultValue: 28, integer: true },
		],
		createRunner: (p, c) => singleCandle(
			'UO',
			c,
			() => new UltimateOscillator({ shortPeriod: int(p, 'short', 7, 2), mediumPeriod: int(p, 'medium', 14, 3), longPeriod: int(p, 'long', 28, 4) }),
			[
				{ price: 70, color: '#ef535066', dashed: true, title: '70' },
				{ price: 30, color: '#26a69a66', dashed: true, title: '30' },
			],
			{ minValue: 10, maxValue: 90 },
		),
	},
	{
		id: 'wavetrend', shortName: 'WT', name: '浪潮趋势指标', description: 'WaveTrend WT1 / WT2 加密市场常用波段反转指标',
		category: '动量摆动', placement: 'pane', popular: false, defaultColor: '#22c55e',
		params: [
			{ key: 'channel', label: '通道周期', min: 2, max: 100, step: 1, defaultValue: 10, integer: true },
			{ key: 'average', label: '均线周期', min: 2, max: 100, step: 1, defaultValue: 21, integer: true },
		],
		createRunner(params, color) {
			const ind = new WaveTrend({ channelInterval: int(params, 'channel', 10, 2), averageInterval: int(params, 'average', 21, 2), smoothingInterval: 4 });
			return {
				plots: [
					{ key: 'wt1', label: 'WT1', kind: 'line', color, lineWidth: 2 },
					{ key: 'wt2', label: 'WT2', kind: 'line', color: '#ef4444', lineWidth: 1, lineStyle: 2 },
				],
				refLines: [
					{ price: 60, color: '#ef535066', dashed: true, title: '60' },
					{ price: -60, color: '#26a69a66', dashed: true, title: '-60' },
				],
				update(c, replace) {
					const r = ind.update(c, replace);
					return r ? { wt1: safe(r.wt1), wt2: safe(r.wt2) } : { wt1: null, wt2: null };
				},
			};
		},
	},
	{
		id: 'elderray', shortName: 'ERI', name: '艾达透视指标', description: 'Elder Ray 多头力量 (Bull) 与空头力量 (Bear)',
		category: '动量摆动', placement: 'pane', popular: false, defaultColor: '#26a69a',
		params: [{ key: 'period', label: '周期', min: 2, max: 100, step: 1, defaultValue: 13, integer: true }],
		createRunner(params, color) {
			const ind = new ElderRay(int(params, 'period', 13, 2));
			return {
				plots: [
					{ key: 'bull', label: '多头力量', kind: 'line', color, lineWidth: 1 },
					{ key: 'bear', label: '空头力量', kind: 'line', color: '#ef5350', lineWidth: 1 },
				],
				refLines: [{ price: 0, color: '#787b8644', dashed: true }],
				update(c, replace) {
					const r = ind.update(c, replace);
					return r ? { bull: safe(r.bullPower), bear: safe(r.bearPower) } : { bull: null, bear: null };
				},
			};
		},
	},

	// 成交量副图
	{
		id: 'obv', shortName: 'OBV', name: '能量潮指标', description: 'On-Balance Volume 量价累计动能',
		category: '成交量', placement: 'pane', popular: false, defaultColor: '#38bdf8',
		params: [{ key: 'period', label: '周期', min: 2, max: 100, step: 1, defaultValue: 10, integer: true }],
		createRunner: (p, c) => singleCandle(`OBV(${int(p, 'period', 10, 2)})`, c, () => new OBV(int(p, 'period', 10, 2))),
	},
	{
		id: 'mfi', shortName: 'MFI', name: '资金流量指标', description: 'Money Flow Index 带成交量权重的 RSI（80 / 20）',
		category: '成交量', placement: 'pane', popular: false, defaultColor: '#10b981',
		params: [{ key: 'period', label: '周期', min: 2, max: 200, step: 1, defaultValue: 14, integer: true }],
		createRunner: (p, c) => singleCandle(
			`MFI(${int(p, 'period', 14, 2)})`,
			c,
			() => new MFI(int(p, 'period', 14, 2)),
			[
				{ price: 80, color: '#ef535066', dashed: true, title: '80' },
				{ price: 20, color: '#26a69a66', dashed: true, title: '20' },
			],
			{ minValue: 10, maxValue: 90 },
		),
	},
	{
		id: 'cmf', shortName: 'CMF', name: '蔡金资金流量', description: 'Chaikin Money Flow 资金净流入强度',
		category: '成交量', placement: 'pane', popular: false, defaultColor: '#4ade80',
		params: [{ key: 'period', label: '周期', min: 2, max: 200, step: 1, defaultValue: 20, integer: true }],
		createRunner: (p, c) => singleCandle(`CMF(${int(p, 'period', 20, 2)})`, c, () => new CMF(int(p, 'period', 20, 2)), [{ price: 0, color: '#787b8644', dashed: true }]),
	},
	{
		id: 'ad', shortName: 'A/D', name: '累积/派发线', description: 'Accumulation/Distribution 资金吸筹与派发趋势',
		category: '成交量', placement: 'pane', popular: false, defaultColor: '#818cf8',
		params: [],
		createRunner: (_p, c) => singleCandle('A/D', c, () => new AD()),
	},
	{
		id: 'fi', shortName: 'FI', name: '强力指数', description: 'Force Index 结合价格变动与成交量衡量推力',
		category: '成交量', placement: 'pane', popular: false, defaultColor: '#f59e0b',
		params: [{ key: 'period', label: '周期', min: 2, max: 100, step: 1, defaultValue: 13, integer: true }],
		createRunner: (p, c) => singleCandle(`FI(${int(p, 'period', 13, 2)})`, c, () => new ForceIndex(int(p, 'period', 13, 2)), [{ price: 0, color: '#787b8644', dashed: true }]),
	},
	{
		id: 'rvol', shortName: 'RVOL', name: '相对成交量', description: 'Relative Volume 当前成交量与均量比值',
		category: '成交量', placement: 'pane', popular: false, defaultColor: '#a78bfa',
		params: [{ key: 'period', label: '周期', min: 2, max: 200, step: 1, defaultValue: 20, integer: true }],
		createRunner(params, color) {
			const period = int(params, 'period', 20, 2);
			const ind = new RVOL(period);
			return {
				plots: [{ key: 'value', label: `RVOL(${period})`, kind: 'line', color, lineWidth: 2 }],
				refLines: [{ price: 1, color: '#787b8666', dashed: true, title: '1x' }],
				update: (c, replace) => ({ value: safe(ind.update(c.volume, replace)) }),
			};
		},
	},
];

const catalogMap = new Map<string, CatalogIndicator>(INDICATOR_CATALOG.map(item => [item.id, item]));

export function getCatalogIndicator(id: string): CatalogIndicator | undefined {
	return catalogMap.get(id);
}

export function defaultParamsFor(item: CatalogIndicator): Record<string, number> {
	const out: Record<string, number> = {};
	for (const p of item.params) out[p.key] = p.defaultValue;
	return out;
}

export function createMaRunner(kind: 'ma' | 'ema', period: number): { update(close: number, replace: boolean): number | null } {
	return kind === 'ma' ? new SMA(period) : new EMA(period);
}
