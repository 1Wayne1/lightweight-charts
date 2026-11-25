import { CanvasRenderingTarget2D } from 'fancy-canvas';
import { DrawingUtils, IChartApi, ISeriesApi, Logical, SeriesType } from 'lightweight-charts';
import {
	applyCanvasLineStyle,
	AxisLabelSpec,
	BaseDrawing,
	BodyHitResult,
	LINE_HIT_TOLERANCE,
} from '../base-drawing';
import { formatPrice, formatTime } from '../coordinates';
import { colorWithAlpha, distancePointToSegment, distanceToRectBorder, pointInRect } from '../geometry';
import { AnchorPoint, DrawingStyleOptions, EditHandle, ScreenPoint } from '../types';
import { POSITION_ENTRY_COLOR } from './catalog';

export type PositionToolType = 'long-position' | 'short-position';

const PROFIT_COLOR = '#089981';
const LOSS_COLOR = '#F23645';
const ENTRY_BADGE_BG = '#2A2E39';
const ENTRY_BADGE_BORDER = '#434651';

const compactNum = (n: number): string =>
	Number.isFinite(n)
		? new Intl.NumberFormat('en', {
			maximumFractionDigits: 4,
			notation: Math.abs(n) >= 1e6 ? 'compact' : 'standard',
		}).format(n)
		: '—';

function drawRoundedRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number
): void {
	const radius = Math.min(r, w / 2, h / 2);
	ctx.beginPath();
	ctx.moveTo(x + radius, y);
	ctx.lineTo(x + w - radius, y);
	ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
	ctx.lineTo(x + w, y + h - radius);
	ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
	ctx.lineTo(x + radius, y + h);
	ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
	ctx.lineTo(x, y + radius);
	ctx.quadraticCurveTo(x, y, x + radius, y);
	ctx.closePath();
}

/** Computes TradingView-style default 3 anchors [entry, stop, target] from a single entry click. */
export function buildPositionDefaultAnchors(
	type: PositionToolType,
	entry: AnchorPoint,
	chart: IChartApi,
	series: ISeriesApi<SeriesType>,
	normalize?: (point: AnchorPoint) => AnchorPoint
): AnchorPoint[] {
	const dir = type === 'long-position' ? 1 : -1;
	const timeScale = chart.timeScale();
	let widthBars = 15;
	if (typeof timeScale.getVisibleLogicalRange === 'function') {
		const range = timeScale.getVisibleLogicalRange();
		if (range && Number.isFinite(range.from) && Number.isFinite(range.to) && range.to > range.from) {
			widthBars = Math.max(8, Math.min(35, Math.round((range.to - range.from) * 0.14)));
		}
	}
	const endLogical = (entry.logical + widthBars) as Logical;

	let stopPrice = Math.max(1e-8, entry.price * (1 - dir * 0.02));
	let targetPrice = Math.max(1e-8, entry.price * (1 + dir * 0.04));

	const entryY = series.priceToCoordinate(entry.price);
	const paneHeight = series.getPane()?.getHeight?.() ?? 400;
	if (entryY !== null && paneHeight > 40) {
		const stopOffsetPx = Math.max(16, Math.min(72, paneHeight * 0.09));
		const targetOffsetPx = Math.max(32, Math.min(144, paneHeight * 0.18));
		const rawStop = series.coordinateToPrice(entryY + dir * stopOffsetPx);
		const rawTarget = series.coordinateToPrice(entryY - dir * targetOffsetPx);
		if (
			rawStop !== null &&
			rawTarget !== null &&
			Number.isFinite(rawStop) &&
			Number.isFinite(rawTarget) &&
			rawStop > 0 &&
			rawTarget > 0
		) {
			const validOrder =
				dir > 0
					? rawTarget > entry.price && rawStop < entry.price
					: rawTarget < entry.price && rawStop > entry.price;
			if (validOrder) {
				stopPrice = rawStop as number;
				targetPrice = rawTarget as number;
			}
		}
	}

	const raw: AnchorPoint[] = [
		{ ...entry },
		{ logical: endLogical, price: stopPrice },
		{ logical: endLogical, price: targetPrice },
	];
	return normalize ? raw.map(p => normalize(p)) : raw;
}

/** Converts a long position into a short position (and vice versa) while preserving R:R distances and width. */
export function flipPosition(
	type: PositionToolType,
	points: readonly AnchorPoint[],
	normalize?: (point: AnchorPoint) => AnchorPoint
): { type: PositionToolType; points: AnchorPoint[] } {
	const nextType: PositionToolType = type === 'long-position' ? 'short-position' : 'long-position';
	const entry = points[0];
	if (!entry) {
		return { type: nextType, points: [] };
	}
	const stop = points[1] ?? entry;
	const target = points[2] ?? entry;
	const risk = Math.abs(stop.price - entry.price);
	const reward = Math.abs(target.price - entry.price);
	const endLogical = Math.max(entry.logical + 1, stop.logical, target.logical) as Logical;
	const nextDir = nextType === 'long-position' ? 1 : -1;
	const minPrice = Math.max(1e-8, entry.price * 1e-6);
	const nextStopPrice = Math.max(minPrice, entry.price - nextDir * risk);
	const nextTargetPrice = Math.max(minPrice, entry.price + nextDir * reward);
	const nextPoints: AnchorPoint[] = [
		{ ...entry },
		{ logical: endLogical, price: nextStopPrice },
		{ logical: endLogical, price: nextTargetPrice },
	];
	return {
		type: nextType,
		points: normalize ? nextPoints.map(p => normalize(p)) : nextPoints,
	};
}

interface PositionGeometry {
	leftX: number;
	rightX: number;
	entryY: number;
	stopY: number;
	targetY: number;
	entryPrice: number;
	stopPrice: number;
	targetPrice: number;
	endLogical: Logical;
	dir: 1 | -1;
}

export class PositionDrawing extends BaseDrawing {
	public readonly type: PositionToolType;

	public constructor(
		type: PositionToolType,
		id: string,
		points: AnchorPoint[],
		options: Partial<DrawingStyleOptions> = {}
	) {
		// Restore legacy default entry styles with the current neutral, thin line.
		const color = options.color && !['#7c83ff', '#2962ff'].includes(options.color.toLowerCase())
			? options.color
			: POSITION_ENTRY_COLOR;
		const lineWidth = options.lineWidth === undefined || options.lineWidth === 2 ? 1 : options.lineWidth;
		super(id, points, { ...options, color, lineWidth });
		this.type = type;
	}

	private _geometry(): PositionGeometry | null {
		const chart = this.chartOrNull();
		const series = this.seriesOrNull();
		const a0 = this._points[0];
		if (!chart || !series || !a0) return null;
		const a1 = this._points[1] ?? a0;
		const a2 = this._points[2] ?? a1;
		const dir: 1 | -1 = this.type === 'long-position' ? 1 : -1;

		const stopPrice = a0.price - dir * Math.abs(a1.price - a0.price);
		const targetPrice = a0.price + dir * Math.abs(a2.price - a0.price);
		const endLogical = Math.max(a0.logical + 1, a1.logical, a2.logical) as Logical;

		const p0 = this._screenPoints[0];
		const p1 = this._screenPoints[1];
		const p2 = this._screenPoints[2];
		const leftX = p0?.x ?? chart.timeScale().logicalToCoordinate(a0.logical);
		const endCoord = chart.timeScale().logicalToCoordinate(endLogical);
		const entryY = p0?.y ?? series.priceToCoordinate(a0.price);
		const stopY = series.priceToCoordinate(stopPrice);
		const targetY = series.priceToCoordinate(targetPrice);

		if (leftX === null || entryY === null || stopY === null || targetY === null) {
			return null;
		}
		const fallbackRight = Math.max(p1?.x ?? -Infinity, p2?.x ?? -Infinity, endCoord ?? -Infinity);
		const rightX = Math.max(leftX + 24, Number.isFinite(fallbackRight) ? fallbackRight : leftX + 70);

		return {
			leftX,
			rightX,
			entryY,
			stopY,
			targetY,
			entryPrice: a0.price,
			stopPrice,
			targetPrice,
			endLogical,
			dir,
		};
	}

	public override previewStepLabel(): string {
		return `${this.type === 'long-position' ? '多头仓位' : '空头仓位'} · 点击或拖动定位入场点`;
	}

	public override editHandles(): readonly EditHandle[] {
		const g = this._geometry();
		if (!g) return [];
		const midX = (g.leftX + g.rightX) / 2;
		return [
			{ id: 'entry', point: { x: g.leftX, y: g.entryY }, cursor: 'move', axisAnchors: [0] },
			{ id: 'right', point: { x: g.rightX, y: g.entryY }, cursor: 'ew-resize', axisAnchors: [1] },
			{ id: 'target', point: { x: midX, y: g.targetY }, cursor: 'ns-resize', axisAnchors: [2] },
			{ id: 'stop', point: { x: midX, y: g.stopY }, cursor: 'ns-resize', axisAnchors: [1] },
		];
	}

	public override applyHandleDrag(
		handleId: string,
		targetAnchor: AnchorPoint,
		origPoints: readonly AnchorPoint[]
	): AnchorPoint[] | null {
		const origEntry = origPoints[0];
		if (!origEntry) return null;
		const origStop = origPoints[1] ?? origEntry;
		const origTarget = origPoints[2] ?? origEntry;
		const dir: 1 | -1 = this.type === 'long-position' ? 1 : -1;
		const curStopPrice = origEntry.price - dir * Math.abs(origStop.price - origEntry.price);
		const curTargetPrice = origEntry.price + dir * Math.abs(origTarget.price - origEntry.price);
		const endLogical = Math.max(origEntry.logical + 1, origStop.logical, origTarget.logical) as Logical;

		if (handleId === 'entry') {
			const nextLogical = Math.min(endLogical - 1, targetAnchor.logical) as Logical;
			const minP = Math.min(curStopPrice, curTargetPrice);
			const maxP = Math.max(curStopPrice, curTargetPrice);
			const nextPrice = Math.max(minP, Math.min(maxP, targetAnchor.price));
			return [
				{
					logical: nextLogical,
					price: nextPrice,
					...(nextLogical === targetAnchor.logical && targetAnchor.time !== undefined ? { time: targetAnchor.time } : {}),
				},
				{ logical: endLogical, price: curStopPrice, ...(origStop.time !== undefined ? { time: origStop.time } : {}) },
				{ logical: endLogical, price: curTargetPrice, ...(origTarget.time !== undefined ? { time: origTarget.time } : {}) },
			];
		}

		if (handleId === 'right') {
			const nextEnd = Math.max(origEntry.logical + 1, targetAnchor.logical) as Logical;
			return [
				{ ...origEntry },
				{ logical: nextEnd, price: curStopPrice },
				{ logical: nextEnd, price: curTargetPrice },
			];
		}

		if (handleId === 'target') {
			const nextTargetPrice =
				dir > 0
					? Math.max(origEntry.price, targetAnchor.price)
					: Math.min(origEntry.price, targetAnchor.price);
			return [
				{ ...origEntry },
				{ logical: endLogical, price: curStopPrice, ...(origStop.time !== undefined ? { time: origStop.time } : {}) },
				{ logical: endLogical, price: nextTargetPrice, ...(origTarget.time !== undefined ? { time: origTarget.time } : {}) },
			];
		}

		if (handleId === 'stop') {
			const nextStopPrice =
				dir > 0
					? Math.min(origEntry.price, targetAnchor.price)
					: Math.max(origEntry.price, targetAnchor.price);
			return [
				{ ...origEntry },
				{ logical: endLogical, price: nextStopPrice, ...(origStop.time !== undefined ? { time: origStop.time } : {}) },
				{ logical: endLogical, price: curTargetPrice, ...(origTarget.time !== undefined ? { time: origTarget.time } : {}) },
			];
		}

		return null;
	}

	public override customAxisLabels(
		chart: IChartApi,
		series: ISeriesApi<SeriesType>
	): { price: AxisLabelSpec[]; time: AxisLabelSpec[] } | null {
		const g = this._geometry();
		const a0 = this._points[0];
		const a1 = this._points[1];
		const a2 = this._points[2];
		if (!g || !a0) return null;
		const endTime = a1?.time ?? a2?.time;
		const showTime = this.isSelected() || this.isHovered() || this.isPreview();
		return {
			price: [
				{ coord: g.targetY, text: formatPrice(series, g.targetPrice), color: PROFIT_COLOR, visible: true },
				{ coord: g.entryY, text: formatPrice(series, g.entryPrice), color: '#5D606B', visible: true },
				{ coord: g.stopY, text: formatPrice(series, g.stopPrice), color: LOSS_COLOR, visible: true },
			],
			time: [
				{ coord: g.leftX, text: formatTime(chart, a0), color: '#5D606B', visible: showTime },
				{
					coord: g.rightX,
					text: formatTime(chart, {
						logical: g.endLogical,
						price: g.entryPrice,
						...(endTime !== undefined ? { time: endTime } : {}),
					}),
					color: '#5D606B',
					visible: showTime,
				},
			],
		};
	}

	public draw(target: CanvasRenderingTarget2D, utils?: DrawingUtils): void {
		const g = this._geometry();
		const series = this.seriesOrNull();
		if (!g || !series) return;

		const opts = this._options;
		const active = this.isHovered() || this.isSelected() || this.isPreview();
		const width = g.rightX - g.leftX;
		const profitTop = Math.min(g.entryY, g.targetY);
		const profitH = Math.abs(g.targetY - g.entryY);
		const lossTop = Math.min(g.entryY, g.stopY);
		const lossH = Math.abs(g.stopY - g.entryY);
		const fillAlpha = Math.max(0.06, Math.min(0.45, opts.fillOpacity));

		target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
			ctx.save();
			ctx.beginPath();
			ctx.rect(0, 0, mediaSize.width, mediaSize.height);
			ctx.clip();

			// Profit & Loss zones
			if (profitH > 0.5) {
				ctx.fillStyle = colorWithAlpha(PROFIT_COLOR, fillAlpha);
				ctx.fillRect(g.leftX, profitTop, width, profitH);
			}
			if (lossH > 0.5) {
				ctx.fillStyle = colorWithAlpha(LOSS_COLOR, fillAlpha);
				ctx.fillRect(g.leftX, lossTop, width, lossH);
			}

			// Entry line
			ctx.strokeStyle = opts.color;
			ctx.lineWidth = opts.lineWidth;
			applyCanvasLineStyle(ctx, opts.lineStyle, opts.lineWidth, utils);
			ctx.beginPath();
			ctx.moveTo(g.leftX, g.entryY);
			ctx.lineTo(g.rightX, g.entryY);
			ctx.stroke();

			const showStats = opts.showLabels && (active || opts.alwaysShowStats);
			if (showStats) {
				const risk = Math.abs(g.entryPrice - g.stopPrice);
				const reward = Math.abs(g.targetPrice - g.entryPrice);
				const riskPct = g.entryPrice ? (risk / Math.abs(g.entryPrice)) * 100 : 0;
				const rewardPct = g.entryPrice ? (reward / Math.abs(g.entryPrice)) * 100 : 0;
				const rr = risk > 1e-12 ? reward / risk : 0;
				const riskAmt = opts.accountSize * (opts.riskPercent / 100);
				const qty = risk > 1e-12 ? riskAmt / risk : 0;
				const rewardAmt = qty * reward;

				const fontSize = Math.max(10, Math.min(13, opts.fontSize - 1));
				ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, sans-serif`;
				ctx.textBaseline = 'middle';
				ctx.textAlign = 'center';
				ctx.setLineDash([]);

				const pillH = fontSize + 10;
				const drawPill = (
					centerX: number,
					topY: number,
					text: string,
					bg: string,
					border?: string
				): void => {
					const textW = ctx.measureText(text).width;
					const pillW = textW + 14;
					const x = Math.max(6, Math.min(mediaSize.width - pillW - 6, centerX - pillW / 2));
					const y = Math.max(4, Math.min(mediaSize.height - pillH - 4, topY));
					drawRoundedRect(ctx, x, y, pillW, pillH, 4);
					ctx.fillStyle = bg;
					ctx.fill();
					if (border) {
						ctx.strokeStyle = border;
						ctx.lineWidth = 1;
						ctx.stroke();
					}
					ctx.fillStyle = '#FFFFFF';
					ctx.fillText(text, x + pillW / 2, y + pillH / 2 + 0.5);
				};

				const centerX = (g.leftX + g.rightX) / 2;
				const targetPillY = g.dir === 1 ? g.targetY - pillH - 4 : g.targetY + 4;
				const stopPillY = g.dir === 1 ? g.stopY + 4 : g.stopY - pillH - 4;

				if (!opts.compactStats) {
					const targetText = `目标: ${formatPrice(series, g.targetPrice)} (+${rewardPct.toFixed(2)}%) · +${compactNum(rewardAmt)}`;
					const entryText = `盈亏比: ${risk > 1e-12 ? rr.toFixed(2) : '—'} · 数量: ${compactNum(qty)}`;
					const stopText = `止损: ${formatPrice(series, g.stopPrice)} (-${riskPct.toFixed(2)}%) · -${compactNum(riskAmt)}`;
					drawPill(centerX, targetPillY, targetText, PROFIT_COLOR);
					drawPill(centerX, g.entryY - pillH / 2, entryText, ENTRY_BADGE_BG, ENTRY_BADGE_BORDER);
					drawPill(centerX, stopPillY, stopText, LOSS_COLOR);
				} else {
					drawPill(centerX, targetPillY, `+${rewardPct.toFixed(2)}%`, PROFIT_COLOR);
					drawPill(
						centerX,
						g.entryY - pillH / 2,
						`R:R ${risk > 1e-12 ? rr.toFixed(2) : '—'}`,
						ENTRY_BADGE_BG,
						ENTRY_BADGE_BORDER
					);
					drawPill(centerX, stopPillY, `-${riskPct.toFixed(2)}%`, LOSS_COLOR);
				}
			}

			ctx.restore();
		});
	}

	protected hitTestBody(point: ScreenPoint, hitSlop: number = 0): BodyHitResult | null {
		const g = this._geometry();
		if (!g) return null;

		const tol = LINE_HIT_TOLERANCE + hitSlop + this._options.lineWidth / 2;
		const entryDist = distancePointToSegment(
			point,
			{ x: g.leftX, y: g.entryY },
			{ x: g.rightX, y: g.entryY }
		);
		const profitBorderDist = distanceToRectBorder(
			point,
			{ x: g.leftX, y: g.entryY },
			{ x: g.rightX, y: g.targetY }
		);
		const lossBorderDist = distanceToRectBorder(
			point,
			{ x: g.leftX, y: g.entryY },
			{ x: g.rightX, y: g.stopY }
		);
		const minEdge = Math.min(entryDist, profitBorderDist, lossBorderDist);
		if (minEdge <= tol) {
			return { distance: minEdge, priority: 1, cursorStyle: 'grab' };
		}

		if (
			pointInRect(point, { x: g.leftX, y: g.entryY }, { x: g.rightX, y: g.targetY }) ||
			pointInRect(point, { x: g.leftX, y: g.entryY }, { x: g.rightX, y: g.stopY })
		) {
			return { distance: minEdge, priority: 0, cursorStyle: 'grab' };
		}
		return null;
	}
}
