import { CanvasRenderingTarget2D } from 'fancy-canvas';
import { DrawingUtils } from 'lightweight-charts';
import {
	applyCanvasLineStyle,
	BaseDrawing,
	BodyHitResult,
	DrawingAxisLabelView,
	LINE_HIT_TOLERANCE,
} from '../base-drawing';
import { formatPrice } from '../coordinates';
import { DrawingToolType, ScreenPoint } from '../types';

export class HorizontalLineDrawing extends BaseDrawing {
	public readonly type: DrawingToolType = 'horizontal-line';

	public draw(target: CanvasRenderingTarget2D, utils?: DrawingUtils): void {
		const p1 = this._screenPoints[0];
		if (!p1) return;

		const opts = this._options;
		target.useMediaCoordinateSpace(scope => {
			const ctx = scope.context;
			const y = Math.round(p1.y) + (opts.lineWidth % 2 === 1 ? 0.5 : 0);
			ctx.save();
			ctx.strokeStyle = opts.color;
			ctx.lineWidth = opts.lineWidth;
			applyCanvasLineStyle(ctx, opts.lineStyle, opts.lineWidth, utils);
			ctx.beginPath();
			ctx.moveTo(0, y);
			ctx.lineTo(scope.mediaSize.width, y);
			ctx.stroke();
			ctx.restore();
		});
	}

	protected override updateAxisViews(): void {
		const series = this.seriesOrNull();
		const sp = this._screenPoints[0] ?? null;
		const pt = this._points[0];

		if (this._priceAxisViews.length === 0) {
			this._priceAxisViews.push(new DrawingAxisLabelView());
		}
		if (pt && sp) {
			const priceText = series ? formatPrice(series, pt.price) : pt.price.toFixed(2);
			// Horizontal lines keep their price axis badge visible whenever showLabels is on
			this._priceAxisViews[0].update(
				sp.y,
				priceText,
				this.isRenderVisible() && this._options.showLabels,
				this._options.color
			);
		} else {
			this._priceAxisViews[0].update(null, '', false, this._options.color);
		}
		this._timeAxisViews.forEach(v => v.update(null, '', false, this._options.color));
	}

	protected hitTestBody(point: ScreenPoint, hitSlop: number = 0): BodyHitResult | null {
		const p1 = this._screenPoints[0];
		if (!p1) return null;
		const dist = Math.abs(point.y - p1.y);
		if (dist <= LINE_HIT_TOLERANCE + hitSlop + this._options.lineWidth / 2) {
			return { distance: dist, priority: 1, cursorStyle: 'ns-resize' };
		}
		return null;
	}
}
