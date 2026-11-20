import { CanvasRenderingTarget2D } from 'fancy-canvas';
import { DrawingUtils, LineStyle } from 'lightweight-charts';
import {
	applyCanvasLineStyle,
	BaseDrawing,
	BodyHitResult,
	LINE_HIT_TOLERANCE,
} from '../base-drawing';
import {
	clipLineToViewport,
	colorWithAlpha,
	computeParallelChannel,
	distancePointToInfiniteLine,
	distancePointToRay,
	distancePointToSegment,
	pointInPolygon,
} from '../geometry';
import { DrawingToolType, ScreenPoint } from '../types';

export class ParallelChannelDrawing extends BaseDrawing {
	public readonly type: DrawingToolType = 'parallel-channel';

	public draw(target: CanvasRenderingTarget2D, utils?: DrawingUtils): void {
		const p1 = this._screenPoints[0];
		const p2 = this._screenPoints[1];
		if (!p1 || !p2) return;

		const p3 = this._screenPoints[2] ?? null;
		const opts = this._options;

		target.useMediaCoordinateSpace(scope => {
			const ctx = scope.context;
			const w = scope.mediaSize.width;
			const h = scope.mediaSize.height;

			ctx.save();
			ctx.strokeStyle = opts.color;
			ctx.lineWidth = opts.lineWidth;
			ctx.lineCap = 'round';

			// During creation before the 3rd point is placed, preview just the baseline
			if (!p3) {
				const baseClip = clipLineToViewport(
					p1,
					p2,
					w,
					h,
					opts.extendLeft,
					opts.extendRight
				);
				if (baseClip) {
					applyCanvasLineStyle(ctx, opts.lineStyle, opts.lineWidth, utils);
					ctx.beginPath();
					ctx.moveTo(baseClip[0].x, baseClip[0].y);
					ctx.lineTo(baseClip[1].x, baseClip[1].y);
					ctx.stroke();
				}
				ctx.restore();
				return;
			}

			const geom = computeParallelChannel(p1, p2, p3);
			const baseClip = clipLineToViewport(
				geom.baseStart,
				geom.baseEnd,
				w,
				h,
				opts.extendLeft,
				opts.extendRight
			);
			const parClip = clipLineToViewport(
				geom.parallelStart,
				geom.parallelEnd,
				w,
				h,
				opts.extendLeft,
				opts.extendRight
			);

			// Fill polygon between the two channel edges
			if (baseClip && parClip) {
				ctx.fillStyle = colorWithAlpha(opts.fillColor, opts.fillOpacity);
				ctx.beginPath();
				ctx.moveTo(baseClip[0].x, baseClip[0].y);
				ctx.lineTo(baseClip[1].x, baseClip[1].y);
				ctx.lineTo(parClip[1].x, parClip[1].y);
				ctx.lineTo(parClip[0].x, parClip[0].y);
				ctx.closePath();
				ctx.fill();
			}

			// Draw upper & lower rails
			applyCanvasLineStyle(ctx, opts.lineStyle, opts.lineWidth, utils);
			if (baseClip) {
				ctx.beginPath();
				ctx.moveTo(baseClip[0].x, baseClip[0].y);
				ctx.lineTo(baseClip[1].x, baseClip[1].y);
				ctx.stroke();
			}
			if (parClip) {
				ctx.beginPath();
				ctx.moveTo(parClip[0].x, parClip[0].y);
				ctx.lineTo(parClip[1].x, parClip[1].y);
				ctx.stroke();
			}

			// Draw dashed midline
			if (opts.showMidline) {
				const midClip = clipLineToViewport(
					geom.midStart,
					geom.midEnd,
					w,
					h,
					opts.extendLeft,
					opts.extendRight
				);
				if (midClip) {
					ctx.lineWidth = Math.max(1, opts.lineWidth - 0.5);
					applyCanvasLineStyle(ctx, LineStyle.Dashed, ctx.lineWidth, utils);
					ctx.beginPath();
					ctx.moveTo(midClip[0].x, midClip[0].y);
					ctx.lineTo(midClip[1].x, midClip[1].y);
					ctx.stroke();
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

	protected hitTestBody(point: ScreenPoint): BodyHitResult | null {
		const p1 = this._screenPoints[0];
		const p2 = this._screenPoints[1];
		const p3 = this._screenPoints[2];
		if (!p1 || !p2) return null;

		const tol = LINE_HIT_TOLERANCE + this._options.lineWidth / 2;
		if (!p3) {
			const d = this._lineDist(point, p1, p2);
			return d <= tol ? { distance: d, priority: 1, cursorStyle: 'grab' } : null;
		}

		const geom = computeParallelChannel(p1, p2, p3);
		const dBase = this._lineDist(point, geom.baseStart, geom.baseEnd);
		const dPar = this._lineDist(point, geom.parallelStart, geom.parallelEnd);
		const dMid = this._options.showMidline
			? this._lineDist(point, geom.midStart, geom.midEnd)
			: Infinity;
		const minEdge = Math.min(dBase, dPar, dMid);

		if (minEdge <= tol) {
			return { distance: minEdge, priority: 1, cursorStyle: 'grab' };
		}

		const poly = [
			geom.baseStart,
			geom.baseEnd,
			geom.parallelEnd,
			geom.parallelStart,
		];
		if (pointInPolygon(point, poly)) {
			return { distance: minEdge, priority: 0, cursorStyle: 'grab' };
		}
		return null;
	}
}
