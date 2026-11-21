import { CanvasRenderingTarget2D } from 'fancy-canvas';
import { DrawingUtils } from 'lightweight-charts';
import {
	applyCanvasLineStyle,
	BaseDrawing,
	BodyHitResult,
	DrawingAxisLabelView,
	LINE_HIT_TOLERANCE,
} from '../base-drawing';
import { formatTime } from '../coordinates';
import { DrawingToolType, ScreenPoint } from '../types';

export class VerticalLineDrawing extends BaseDrawing {
	public readonly type: DrawingToolType = 'vertical-line';

	public draw(target: CanvasRenderingTarget2D, utils?: DrawingUtils): void {
		const p1 = this._screenPoints[0];
		if (!p1) return;

		const opts = this._options;
		target.useMediaCoordinateSpace(scope => {
			const ctx = scope.context;
			const x = Math.round(p1.x) + (opts.lineWidth % 2 === 1 ? 0.5 : 0);
			ctx.save();
			ctx.strokeStyle = opts.color;
			ctx.lineWidth = opts.lineWidth;
			applyCanvasLineStyle(ctx, opts.lineStyle, opts.lineWidth, utils);
			ctx.beginPath();
			ctx.moveTo(x, 0);
			ctx.lineTo(x, scope.mediaSize.height);
			ctx.stroke();
			ctx.restore();
		});
	}

	protected override updateAxisViews(): void {
		const chart = this.chartOrNull();
		const sp = this._screenPoints[0] ?? null;
		const pt = this._points[0];

		if (this._timeAxisViews.length === 0) {
			this._timeAxisViews.push(new DrawingAxisLabelView());
		}
		if (pt && sp) {
			const timeText = chart ? formatTime(chart, pt) : '';
			this._timeAxisViews[0].update(
				sp.x,
				timeText,
				this.isRenderVisible() && this._options.showLabels,
				this._options.color
			);
		} else {
			this._timeAxisViews[0].update(null, '', false, this._options.color);
		}
		this._priceAxisViews.forEach(v => v.update(null, '', false, this._options.color));
	}

	protected hitTestBody(point: ScreenPoint, hitSlop: number = 0): BodyHitResult | null {
		const p1 = this._screenPoints[0];
		if (!p1) return null;
		const dist = Math.abs(point.x - p1.x);
		if (dist <= LINE_HIT_TOLERANCE + hitSlop + this._options.lineWidth / 2) {
			return { distance: dist, priority: 1, cursorStyle: 'ew-resize' };
		}
		return null;
	}
}
