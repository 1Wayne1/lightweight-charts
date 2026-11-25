import { CanvasRenderingTarget2D } from 'fancy-canvas';
import { DrawingUtils, LineStyle, Logical } from 'lightweight-charts';
import {
	applyCanvasLineStyle,
	BaseDrawing,
	BodyHitResult,
	LINE_HIT_TOLERANCE,
} from '../base-drawing';
import { formatPrice } from '../coordinates';
import {
	clipLineToViewport,
	colorWithAlpha,
	distancePointToInfiniteLine,
	distancePointToRay,
	distancePointToSegment,
	pointInPolygon,
	pointInRect,
} from '../geometry';
import { AnchorPoint, DrawingStyleOptions, DrawingToolType, ScreenPoint } from '../types';

function drawRoundedPill(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	text: string,
	bg: string,
	textColor: string,
	fontSize: number
): void {
	ctx.save();
	ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	const w = ctx.measureText(text).width + 10;
	const h = fontSize + 6;
	const rx = x - w / 2;
	const ry = y - h / 2;
	const r = 4;
	ctx.beginPath();
	ctx.moveTo(rx + r, ry);
	ctx.lineTo(rx + w - r, ry);
	ctx.quadraticCurveTo(rx + w, ry, rx + w, ry + r);
	ctx.lineTo(rx + w, ry + h - r);
	ctx.quadraticCurveTo(rx + w, ry + h, rx + w - r, ry + h);
	ctx.lineTo(rx + r, ry + h);
	ctx.quadraticCurveTo(rx, ry + h, rx, ry + h - r);
	ctx.lineTo(rx, ry + r);
	ctx.quadraticCurveTo(rx, ry, rx + r, ry);
	ctx.closePath();
	ctx.fillStyle = bg;
	ctx.fill();
	ctx.fillStyle = textColor;
	ctx.fillText(text, x, y + 0.5);
	ctx.restore();
}

export class FibExtensionDrawing extends BaseDrawing {
	public readonly type: DrawingToolType = 'fib-extension';

	public override previewStepLabel(draftCount: number): string {
		if (draftCount === 0) return '趋势斐波那契扩展 (1/3) · 点击放置趋势起点 A';
		if (draftCount === 1) return '趋势斐波那契扩展 (2/3) · 点击放置趋势终点 B';
		return '趋势斐波那契扩展 (3/3) · 点击放置回撤起点 C';
	}

	public draw(target: CanvasRenderingTarget2D, utils?: DrawingUtils): void {
		const p1 = this._screenPoints[0];
		const p2 = this._screenPoints[1];
		const a1 = this._points[0];
		const a2 = this._points[1];
		const series = this.seriesOrNull();
		if (!p1 || !p2 || !a1 || !a2 || !series) return;

		const p3 = this._screenPoints[2] ?? null;
		const a3 = this._points[2] ?? null;
		const opts = this._options;
		const active = this.isHovered() || this.isSelected() || this.isPreview();

		target.useMediaCoordinateSpace(scope => {
			const ctx = scope.context;
			const w = scope.mediaSize.width;
			ctx.save();
			ctx.beginPath();
			ctx.rect(0, 0, w, scope.mediaSize.height);
			ctx.clip();

			// Dashed reference connector A -> B (-> C)
			ctx.strokeStyle = colorWithAlpha(opts.color, active ? 0.82 : 0.38);
			ctx.lineWidth = 1.25;
			applyCanvasLineStyle(ctx, LineStyle.Dashed, 1, utils);
			ctx.beginPath();
			ctx.moveTo(p1.x, p1.y);
			ctx.lineTo(p2.x, p2.y);
			if (p3) ctx.lineTo(p3.x, p3.y);
			ctx.stroke();

			if (!p3 || !a3) {
				if (opts.showLabels) {
					const diff = a2.price - a1.price;
					const pct = a1.price ? (diff / Math.abs(a1.price)) * 100 : 0;
					const sign = diff >= 0 ? '+' : '';
					drawRoundedPill(
						ctx,
						(p1.x + p2.x) / 2,
						(p1.y + p2.y) / 2 - 14,
						`${sign}${formatPrice(series, diff)} (${sign}${pct.toFixed(2)}%)`,
						'rgba(30, 34, 45, 0.9)',
						'#E0E3EB',
						Math.max(10, opts.fontSize - 1)
					);
				}
				ctx.restore();
				return;
			}

			const levels = opts.fibLevels
				.filter(l => l.visible)
				.slice()
				.sort((x, y) => x.value - y.value);

			const leftX = opts.extendLeft ? 0 : Math.min(p1.x, p3.x);
			const rightX = opts.extendRight ? w : Math.max(p2.x, p3.x) + 80;
			const spanWidth = Math.max(1, rightX - leftX);
			const priceDiff = a2.price - a1.price;

			const computed: Array<{ value: number; color: string; price: number; y: number }> = [];
			for (const level of levels) {
				const price = a3.price + priceDiff * level.value;
				const y = series.priceToCoordinate(price);
				if (y !== null) {
					computed.push({ value: level.value, color: level.color, price, y });
				}
			}

			// 1. Translucent zone fills between consecutive visible levels
			for (let i = 0; i < computed.length - 1; i++) {
				const cur = computed[i];
				const next = computed[i + 1];
				const topY = Math.min(cur.y, next.y);
				const height = Math.abs(next.y - cur.y);
				ctx.fillStyle = colorWithAlpha(next.color, Math.min(0.18, opts.fillOpacity));
				ctx.fillRect(leftX, topY, spanWidth, height);
			}

			// 2. Horizontal extension level lines & labels
			for (const lvl of computed) {
				const y = Math.round(lvl.y) + 0.5;
				ctx.strokeStyle = lvl.color;
				ctx.lineWidth = Math.max(1, opts.lineWidth - 0.5);
				applyCanvasLineStyle(ctx, opts.lineStyle, ctx.lineWidth, utils);
				ctx.beginPath();
				ctx.moveTo(leftX, y);
				ctx.lineTo(rightX, y);
				ctx.stroke();
			}

			if (opts.showLabels) {
				ctx.font = `${opts.fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
				ctx.textBaseline = opts.textPosition === 'bottom' ? 'bottom' : 'top';
				const minLabelGap = active ? opts.fontSize + 1 : opts.fontSize + 3;
				let lastLabelY = -Infinity;
				const sortedByY = computed.slice().sort((a, b) => a.y - b.y);
				for (const lvl of sortedByY) {
					if (lvl.y - lastLabelY < minLabelGap) continue;
					lastLabelY = lvl.y;
					const y = Math.round(lvl.y) + 0.5;
					const fullLabel = `${lvl.value} (${formatPrice(series, lvl.price)})`;
					const outside = leftX > ctx.measureText(fullLabel).width + 12;
					const label = outside || active ? fullLabel : String(lvl.value);
					ctx.fillStyle = lvl.color;
					ctx.textAlign = outside ? 'right' : 'left';
					ctx.fillText(label, outside ? leftX - 6 : leftX + 6, y + (opts.textPosition === 'bottom' ? -3 : 3));
				}
			}

			ctx.restore();
		});
	}

	protected hitTestBody(point: ScreenPoint, hitSlop: number = 0): BodyHitResult | null {
		const p1 = this._screenPoints[0];
		const p2 = this._screenPoints[1];
		const p3 = this._screenPoints[2];
		const a1 = this._points[0];
		const a2 = this._points[1];
		const a3 = this._points[2];
		const series = this.seriesOrNull();
		const chart = this.chartOrNull();
		if (!p1 || !p2 || !a1 || !a2 || !series || !chart) return null;

		const tol = LINE_HIT_TOLERANCE + hitSlop + this._options.lineWidth / 2;
		let minDist = distancePointToSegment(point, p1, p2);
		if (!p3 || !a3) {
			return minDist <= tol ? { distance: minDist, priority: 1, cursorStyle: 'grab' } : null;
		}
		minDist = Math.min(minDist, distancePointToSegment(point, p2, p3));

		const paneW = chart.timeScale().width() || 2000;
		const leftX = this._options.extendLeft ? 0 : Math.min(p1.x, p3.x);
		const rightX = this._options.extendRight ? paneW : Math.max(p2.x, p3.x) + 80;
		const priceDiff = a2.price - a1.price;
		let minY = Infinity;
		let maxY = -Infinity;

		for (const level of this._options.fibLevels) {
			if (!level.visible) continue;
			const price = a3.price + priceDiff * level.value;
			const y = series.priceToCoordinate(price);
			if (y === null) continue;
			minY = Math.min(minY, y);
			maxY = Math.max(maxY, y);
			minDist = Math.min(minDist, distancePointToSegment(point, { x: leftX, y }, { x: rightX, y }));
		}

		if (minDist <= tol) {
			return { distance: minDist, priority: 1, cursorStyle: 'grab' };
		}
		if (Number.isFinite(minY) && Number.isFinite(maxY) && pointInRect(point, { x: leftX, y: minY }, { x: rightX, y: maxY })) {
			return { distance: minDist, priority: 0, cursorStyle: 'grab' };
		}
		return null;
	}
}

export class FibChannelDrawing extends BaseDrawing {
	public readonly type: DrawingToolType = 'fib-channel';

	public constructor(
		id: string,
		points: AnchorPoint[],
		options: Partial<DrawingStyleOptions> = {}
	) {
		super(id, points, options);
	}

	public override previewStepLabel(draftCount: number): string {
		if (draftCount === 0) return '斐波那契通道 (1/3) · 点击放置基线起点';
		if (draftCount === 1) return '斐波那契通道 (2/3) · 点击放置基线终点';
		return '斐波那契通道 (3/3) · 移动并点击确定通道宽度';
	}

	public draw(target: CanvasRenderingTarget2D, utils?: DrawingUtils): void {
		const p1 = this._screenPoints[0];
		const p2 = this._screenPoints[1];
		if (!p1 || !p2) return;
		const p3 = this._screenPoints[2] ?? null;
		const opts = this._options;
		const active = this.isHovered() || this.isSelected() || this.isPreview();

		target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
			const w = mediaSize.width;
			const h = mediaSize.height;
			ctx.save();
			ctx.beginPath();
			ctx.rect(0, 0, w, h);
			ctx.clip();

			if (!p3) {
				const base = clipLineToViewport(p1, p2, w, h, opts.extendLeft, opts.extendRight);
				if (base) {
					ctx.strokeStyle = opts.color;
					ctx.lineWidth = opts.lineWidth;
					applyCanvasLineStyle(ctx, opts.lineStyle, opts.lineWidth, utils);
					ctx.beginPath();
					ctx.moveTo(base[0].x, base[0].y);
					ctx.lineTo(base[1].x, base[1].y);
					ctx.stroke();
				}
				ctx.restore();
				return;
			}

			const dx = p2.x - p1.x;
			const dy = p2.y - p1.y;
			const baseAtC = Math.abs(dx) > 1e-6 ? p1.y + (dy * (p3.x - p1.x)) / dx : p1.y;
			const deltaY = p3.y - baseAtC;

			if (active) {
				ctx.strokeStyle = colorWithAlpha(opts.color, 0.55);
				ctx.lineWidth = 1;
				applyCanvasLineStyle(ctx, LineStyle.Dashed, 1, utils);
				ctx.beginPath();
				ctx.moveTo(p3.x, baseAtC);
				ctx.lineTo(p3.x, p3.y);
				ctx.stroke();
			}

			const levels = opts.fibLevels
				.filter(l => l.visible)
				.slice()
				.sort((x, y) => x.value - y.value);

			const lines: Array<{ value: number; color: string; seg: [ScreenPoint, ScreenPoint] }> = [];
			for (const level of levels) {
				const offset = deltaY * level.value;
				const start = { x: p1.x, y: p1.y + offset };
				const end = { x: p2.x, y: p2.y + offset };
				const seg = clipLineToViewport(start, end, w, h, opts.extendLeft, opts.extendRight);
				if (seg) lines.push({ value: level.value, color: level.color, seg });
			}

			for (let i = 0; i < lines.length - 1; i++) {
				const a = lines[i].seg;
				const b = lines[i + 1].seg;
				ctx.fillStyle = colorWithAlpha(lines[i + 1].color, Math.min(0.16, opts.fillOpacity));
				ctx.beginPath();
				ctx.moveTo(a[0].x, a[0].y);
				ctx.lineTo(a[1].x, a[1].y);
				ctx.lineTo(b[1].x, b[1].y);
				ctx.lineTo(b[0].x, b[0].y);
				ctx.closePath();
				ctx.fill();
			}

			for (const line of lines) {
				ctx.strokeStyle = line.color;
				ctx.lineWidth = Math.max(1, opts.lineWidth - 0.5);
				applyCanvasLineStyle(ctx, opts.lineStyle, ctx.lineWidth, utils);
				ctx.beginPath();
				ctx.moveTo(line.seg[0].x, line.seg[0].y);
				ctx.lineTo(line.seg[1].x, line.seg[1].y);
				ctx.stroke();
			}

			if (opts.showLabels) {
				const fontSize = Math.max(10, opts.fontSize - 1);
				ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
				ctx.textBaseline = 'middle';
				ctx.textAlign = 'left';
				ctx.setLineDash([]);
				const labeled = lines
					.map(line => {
						const endPt = line.seg[1].x >= line.seg[0].x ? line.seg[1] : line.seg[0];
						return {
							value: line.value,
							color: line.color,
							lx: Math.min(w - 36, Math.max(6, endPt.x + 6)),
							ly: Math.max(10, Math.min(h - 10, endPt.y)),
						};
					})
					.sort((a, b) => a.ly - b.ly);
				let lastLabelY = -Infinity;
				for (const item of labeled) {
					if (item.ly - lastLabelY < fontSize + 2) continue;
					lastLabelY = item.ly;
					ctx.strokeStyle = 'rgba(14, 17, 23, 0.9)';
					ctx.lineWidth = 3;
					ctx.strokeText(String(item.value), item.lx, item.ly);
					ctx.fillStyle = item.color;
					ctx.fillText(String(item.value), item.lx, item.ly);
				}
			}

			ctx.restore();
		});
	}

	private _lineDist(p: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
		const { extendLeft, extendRight } = this._options;
		if (extendLeft && extendRight) return distancePointToInfiniteLine(p, a, b);
		if (extendRight) return distancePointToRay(p, a, b);
		if (extendLeft) return distancePointToRay(p, b, a);
		return distancePointToSegment(p, a, b);
	}

	protected hitTestBody(point: ScreenPoint, hitSlop: number = 0): BodyHitResult | null {
		const p1 = this._screenPoints[0];
		const p2 = this._screenPoints[1];
		const p3 = this._screenPoints[2];
		if (!p1 || !p2) return null;

		const tol = LINE_HIT_TOLERANCE + hitSlop + this._options.lineWidth / 2;
		if (!p3) {
			const d = this._lineDist(point, p1, p2);
			return d <= tol ? { distance: d, priority: 1, cursorStyle: 'grab' } : null;
		}

		const dx = p2.x - p1.x;
		const dy = p2.y - p1.y;
		const baseAtC = Math.abs(dx) > 1e-6 ? p1.y + (dy * (p3.x - p1.x)) / dx : p1.y;
		const deltaY = p3.y - baseAtC;

		let minDist = Infinity;
		let minOffset = Infinity;
		let maxOffset = -Infinity;
		for (const level of this._options.fibLevels) {
			if (!level.visible) continue;
			const offset = deltaY * level.value;
			minOffset = Math.min(minOffset, offset);
			maxOffset = Math.max(maxOffset, offset);
			minDist = Math.min(
				minDist,
				this._lineDist(point, { x: p1.x, y: p1.y + offset }, { x: p2.x, y: p2.y + offset })
			);
		}
		if (minDist <= tol) {
			return { distance: minDist, priority: 1, cursorStyle: 'grab' };
		}
		if (Number.isFinite(minOffset) && Number.isFinite(maxOffset)) {
			const poly: ScreenPoint[] = [
				{ x: p1.x, y: p1.y + minOffset },
				{ x: p2.x, y: p2.y + minOffset },
				{ x: p2.x, y: p2.y + maxOffset },
				{ x: p1.x, y: p1.y + maxOffset },
			];
			if (pointInPolygon(point, poly)) {
				return { distance: minDist, priority: 0, cursorStyle: 'grab' };
			}
		}
		return null;
	}
}

export class TrendFibTimeDrawing extends BaseDrawing {
	public readonly type: DrawingToolType = 'trend-fib-time';

	public override previewStepLabel(draftCount: number): string {
		if (draftCount === 0) return '趋势斐波那契时间 (1/3) · 点击放置基准起点 A';
		if (draftCount === 1) return '趋势斐波那契时间 (2/3) · 点击放置基准终点 B';
		return '趋势斐波那契时间 (3/3) · 点击放置投射起点 C';
	}

	private _lineXs(): Array<{ x: number; value: number; color: string }> {
		const chart = this.chartOrNull();
		const p1 = this._screenPoints[0];
		const p2 = this._screenPoints[1];
		const p3 = this._screenPoints[2];
		const a1 = this._points[0];
		const a2 = this._points[1];
		const a3 = this._points[2];
		if (!chart || !p1 || !p2 || !p3 || !a1 || !a2 || !a3) return [];
		const deltaLogical = a2.logical - a1.logical;
		const timeScale = chart.timeScale();
		const res: Array<{ x: number; value: number; color: string }> = [];
		for (const level of this._options.fibLevels) {
			if (!level.visible) continue;
			const projected = timeScale.logicalToCoordinate((a3.logical + deltaLogical * level.value) as Logical);
			const x = projected ?? (p3.x + (p2.x - p1.x) * level.value);
			if (Number.isFinite(x)) {
				res.push({ x, value: level.value, color: level.color });
			}
		}
		return res.sort((l, r) => l.x - r.x);
	}

	public draw(target: CanvasRenderingTarget2D, utils?: DrawingUtils): void {
		const p1 = this._screenPoints[0];
		const p2 = this._screenPoints[1];
		if (!p1 || !p2) return;
		const p3 = this._screenPoints[2] ?? null;
		const opts = this._options;
		const active = this.isHovered() || this.isSelected() || this.isPreview();

		target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
			const w = mediaSize.width;
			const h = mediaSize.height;
			ctx.save();
			ctx.beginPath();
			ctx.rect(0, 0, w, h);
			ctx.clip();

			// Dashed reference connector A -> B (-> C)
			ctx.strokeStyle = colorWithAlpha(opts.color, active ? 0.8 : 0.35);
			ctx.lineWidth = 1.25;
			applyCanvasLineStyle(ctx, LineStyle.Dashed, 1, utils);
			ctx.beginPath();
			ctx.moveTo(p1.x, p1.y);
			ctx.lineTo(p2.x, p2.y);
			if (p3) ctx.lineTo(p3.x, p3.y);
			ctx.stroke();

			const lines = this._lineXs();
			for (let i = 0; i < lines.length - 1; i++) {
				const cur = lines[i];
				const next = lines[i + 1];
				if (i % 2 === 0) {
					ctx.fillStyle = colorWithAlpha(next.color, Math.min(active ? 0.1 : 0.06, opts.fillOpacity * (active ? 0.65 : 0.45)));
					ctx.fillRect(cur.x, 0, next.x - cur.x, h);
				}
			}

			const labelY = Math.max(16, h - 14);
			let lastLabelX = -Infinity;
			for (const line of lines) {
				const x = Math.round(line.x) + 0.5;
				if (x < -10 || x > w + 10) continue;
				ctx.strokeStyle = line.color;
				ctx.lineWidth = Math.max(1, opts.lineWidth - 0.5);
				applyCanvasLineStyle(ctx, opts.lineStyle, ctx.lineWidth, utils);
				ctx.beginPath();
				ctx.moveTo(x, 0);
				ctx.lineTo(x, h);
				ctx.stroke();

				if (opts.showLabels && line.x - lastLabelX >= 28) {
					lastLabelX = line.x;
					const clampedX = Math.max(20, Math.min(w - 20, line.x));
					const text = String(line.value);
					if (active) {
						drawRoundedPill(
							ctx,
							clampedX,
							labelY,
							text,
							colorWithAlpha(line.color, 0.9),
							'#FFFFFF',
							Math.max(10, opts.fontSize - 2)
						);
					} else {
						ctx.save();
						ctx.font = `600 ${Math.max(10, opts.fontSize - 2)}px -apple-system, BlinkMacSystemFont, sans-serif`;
						ctx.textAlign = 'center';
						ctx.textBaseline = 'middle';
						ctx.setLineDash([]);
						ctx.strokeStyle = 'rgba(14, 17, 23, 0.88)';
						ctx.lineWidth = 3;
						ctx.strokeText(text, clampedX, labelY);
						ctx.fillStyle = line.color;
						ctx.fillText(text, clampedX, labelY);
						ctx.restore();
					}
				}
			}

			ctx.restore();
		});
	}

	protected hitTestBody(point: ScreenPoint, hitSlop: number = 0): BodyHitResult | null {
		const p1 = this._screenPoints[0];
		const p2 = this._screenPoints[1];
		const p3 = this._screenPoints[2];
		const chart = this.chartOrNull();
		const series = this.seriesOrNull();
		if (!p1 || !p2 || !chart || !series) return null;

		const tol = LINE_HIT_TOLERANCE + hitSlop + this._options.lineWidth / 2;
		let minDist = distancePointToSegment(point, p1, p2);
		if (p3) {
			minDist = Math.min(minDist, distancePointToSegment(point, p2, p3));
		}
		const h = series.getPane()?.getHeight?.() ?? 600;
		for (const line of this._lineXs()) {
			minDist = Math.min(minDist, distancePointToSegment(point, { x: line.x, y: 0 }, { x: line.x, y: h }));
		}
		return minDist <= tol ? { distance: minDist, priority: 1, cursorStyle: 'grab' } : null;
	}
}
