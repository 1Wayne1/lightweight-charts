import { CanvasRenderingTarget2D } from 'fancy-canvas';
import { DrawingUtils, LineStyle } from 'lightweight-charts';
import {
	applyCanvasLineStyle,
	BaseDrawing,
	BodyHitResult,
	LINE_HIT_TOLERANCE,
} from '../base-drawing';
import { formatPrice } from '../coordinates';
import {
	colorWithAlpha,
	distancePointToSegment,
	pointInRect,
} from '../geometry';
import { DrawingToolType, ScreenPoint } from '../types';

export class FibRetracementDrawing extends BaseDrawing {
	public readonly type: DrawingToolType = 'fib-retracement';

	public draw(target: CanvasRenderingTarget2D, utils?: DrawingUtils): void {
		const p1 = this._screenPoints[0];
		const p2 = this._screenPoints[1];
		const a1 = this._points[0];
		const a2 = this._points[1];
		const series = this.seriesOrNull();
		if (!p1 || !p2 || !a1 || !a2 || !series) return;

		const opts = this._options;
		const levels = opts.fibLevels
			.filter(l => l.visible)
			.slice()
			.sort((x, y) => x.value - y.value);

		target.useMediaCoordinateSpace(scope => {
			const ctx = scope.context;
			const w = scope.mediaSize.width;
			const leftX = opts.extendLeft ? 0 : Math.min(p1.x, p2.x);
			const rightX = opts.extendRight ? w : Math.max(p1.x, p2.x);
			const spanWidth = Math.max(1, rightX - leftX);

			const computedLevels: Array<{
				value: number;
				color: string;
				price: number;
				y: number;
			}> = [];

			const priceDiff = a1.price - a2.price;
			for (const level of levels) {
				const price = a2.price + priceDiff * level.value;
				const y = series.priceToCoordinate(price);
				if (y !== null) {
					computedLevels.push({
						value: level.value,
						color: level.color,
						price,
						y,
					});
				}
			}

			ctx.save();

			// 1. Translucent zone fills between consecutive levels
			for (let i = 0; i < computedLevels.length - 1; i++) {
				const cur = computedLevels[i];
				const next = computedLevels[i + 1];
				const topY = Math.min(cur.y, next.y);
				const height = Math.abs(next.y - cur.y);
				ctx.fillStyle = colorWithAlpha(next.color, Math.min(0.18, opts.fillOpacity));
				ctx.fillRect(leftX, topY, spanWidth, height);
			}

			// 2. Dashed diagonal trend reference between anchor p1 and p2
			ctx.strokeStyle = colorWithAlpha(opts.color, 0.7);
			ctx.lineWidth = 1;
			applyCanvasLineStyle(ctx, LineStyle.Dashed, 1, utils);
			ctx.beginPath();
			ctx.moveTo(p1.x, p1.y);
			ctx.lineTo(p2.x, p2.y);
			ctx.stroke();

			// 3. Horizontal Fibonacci level lines & labels
			ctx.font = `${opts.fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
			ctx.textBaseline = opts.textPosition === 'bottom' ? 'bottom' : 'top';

			for (const lvl of computedLevels) {
				const y = Math.round(lvl.y) + 0.5;
				ctx.strokeStyle = lvl.color;
				ctx.lineWidth = Math.max(1, opts.lineWidth - 0.5);
				applyCanvasLineStyle(ctx, opts.lineStyle, ctx.lineWidth, utils);
				ctx.beginPath();
				ctx.moveTo(leftX, y);
				ctx.lineTo(rightX, y);
				ctx.stroke();

				if (opts.showLabels) {
					const label = `${lvl.value} (${formatPrice(series, lvl.price)})`;
					ctx.fillStyle = lvl.color;
					const outside = leftX > ctx.measureText(label).width + 12;
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
		const a1 = this._points[0];
		const a2 = this._points[1];
		const series = this.seriesOrNull();
		const chart = this.chartOrNull();
		if (!p1 || !p2 || !a1 || !a2 || !series || !chart) return null;

		const paneW = chart.timeScale().width() || 2000;
		const leftX = this._options.extendLeft ? 0 : Math.min(p1.x, p2.x);
		const rightX = this._options.extendRight ? paneW : Math.max(p1.x, p2.x);
		const tol = LINE_HIT_TOLERANCE + hitSlop + this._options.lineWidth / 2;

		let minLineDist = distancePointToSegment(point, p1, p2);
		const priceDiff = a1.price - a2.price;
		let minY = Infinity;
		let maxY = -Infinity;

		for (const level of this._options.fibLevels) {
			if (!level.visible) continue;
			const price = a2.price + priceDiff * level.value;
			const y = series.priceToCoordinate(price);
			if (y === null) continue;
			minY = Math.min(minY, y);
			maxY = Math.max(maxY, y);
			const d = distancePointToSegment(
				point,
				{ x: leftX, y },
				{ x: rightX, y }
			);
			if (d < minLineDist) {
				minLineDist = d;
			}
		}

		if (minLineDist <= tol) {
			return { distance: minLineDist, priority: 1, cursorStyle: 'grab' };
		}
		if (
			Number.isFinite(minY) &&
			Number.isFinite(maxY) &&
			pointInRect(point, { x: leftX, y: minY }, { x: rightX, y: maxY })
		) {
			return { distance: minLineDist, priority: 0, cursorStyle: 'grab' };
		}
		return null;
	}
}
