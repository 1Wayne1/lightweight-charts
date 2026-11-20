import { CanvasRenderingTarget2D } from 'fancy-canvas';
import { DrawingUtils } from 'lightweight-charts';
import {
	applyCanvasLineStyle,
	BaseDrawing,
	BodyHitResult,
	LINE_HIT_TOLERANCE,
} from '../base-drawing';
import {
	clipLineToViewport,
	distancePointToInfiniteLine,
	distancePointToRay,
	distancePointToSegment,
} from '../geometry';
import { DrawingToolType, ScreenPoint } from '../types';

export class TrendLineDrawing extends BaseDrawing {
	public readonly type: DrawingToolType = 'trend-line';

	public draw(target: CanvasRenderingTarget2D, utils?: DrawingUtils): void {
		const p1 = this._screenPoints[0];
		const p2 = this._screenPoints[1];
		if (!p1 || !p2) return;

		const opts = this._options;
		target.useMediaCoordinateSpace(scope => {
			const clipped = clipLineToViewport(
				p1,
				p2,
				scope.mediaSize.width,
				scope.mediaSize.height,
				opts.extendLeft,
				opts.extendRight
			);
			if (!clipped) return;

			const [start, end] = clipped;
			const ctx = scope.context;
			ctx.save();
			ctx.strokeStyle = opts.color;
			ctx.lineWidth = opts.lineWidth;
			ctx.lineCap = 'round';
			applyCanvasLineStyle(ctx, opts.lineStyle, opts.lineWidth, utils);
			ctx.beginPath();
			ctx.moveTo(start.x, start.y);
			ctx.lineTo(end.x, end.y);
			ctx.stroke();
			ctx.restore();
		});
	}

	protected hitTestBody(point: ScreenPoint): BodyHitResult | null {
		const p1 = this._screenPoints[0];
		const p2 = this._screenPoints[1];
		if (!p1 || !p2) return null;

		const { extendLeft, extendRight, lineWidth } = this._options;
		let dist: number;
		if (extendLeft && extendRight) {
			dist = distancePointToInfiniteLine(point, p1, p2);
		} else if (extendRight) {
			dist = distancePointToRay(point, p1, p2);
		} else if (extendLeft) {
			dist = distancePointToRay(point, p2, p1);
		} else {
			dist = distancePointToSegment(point, p1, p2);
		}

		if (dist <= LINE_HIT_TOLERANCE + lineWidth / 2) {
			return { distance: dist, priority: 1, cursorStyle: 'grab' };
		}
		return null;
	}
}
