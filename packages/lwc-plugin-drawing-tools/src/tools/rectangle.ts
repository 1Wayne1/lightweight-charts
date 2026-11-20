import { CanvasRenderingTarget2D } from 'fancy-canvas';
import {
	DrawingUtils,
	IPrimitivePaneRenderer,
	IPrimitivePaneView,
	PrimitivePaneViewZOrder,
} from 'lightweight-charts';
import { positionsBox } from '@tradingview/lwc-toolkit/dimensions/positions';
import {
	applyCanvasLineStyle,
	BaseDrawing,
	BodyHitResult,
	LINE_HIT_TOLERANCE,
} from '../base-drawing';
import {
	colorWithAlpha,
	distanceToRectBorder,
	pointInRect,
} from '../geometry';
import { AnchorPoint, DrawingStyleOptions, DrawingToolType, ScreenPoint } from '../types';

class AxisHighlightPaneView implements IPrimitivePaneView {
	private readonly _source: RectangleDrawing;
	private readonly _vertical: boolean;
	private readonly _renderer: IPrimitivePaneRenderer;

	public constructor(source: RectangleDrawing, vertical: boolean) {
		this._source = source;
		this._vertical = vertical;
		this._renderer = {
			draw: (target: CanvasRenderingTarget2D) => {
				if (
					!this._source.isRenderVisible() ||
					(!this._source.isSelected() && !this._source.isPreview())
				) {
					return;
				}
				const pts = this._source.screenPoints();
				const p1 = pts[0];
				const p2 = pts[1];
				if (!p1 || !p2) return;

				const opts = this._source.options();
				target.useBitmapCoordinateSpace(scope => {
					const ctx = scope.context;
					ctx.save();
					ctx.fillStyle = colorWithAlpha(opts.fillColor, 0.25);
					if (this._vertical) {
						const box = positionsBox(p1.y, p2.y, scope.verticalPixelRatio);
						ctx.fillRect(0, box.position, scope.bitmapSize.width, box.length);
					} else {
						const box = positionsBox(p1.x, p2.x, scope.horizontalPixelRatio);
						ctx.fillRect(box.position, 0, box.length, scope.bitmapSize.height);
					}
					ctx.restore();
				});
			},
		};
	}

	public zOrder(): PrimitivePaneViewZOrder {
		return 'bottom';
	}

	public renderer(): IPrimitivePaneRenderer | null {
		return this._renderer;
	}
}

export class RectangleDrawing extends BaseDrawing {
	public readonly type: DrawingToolType = 'rectangle';

	public constructor(
		id: string,
		points: AnchorPoint[],
		options: Partial<DrawingStyleOptions> = {}
	) {
		super(id, points, options);
		this._priceAxisPaneViews = [new AxisHighlightPaneView(this, true)];
		this._timeAxisPaneViews = [new AxisHighlightPaneView(this, false)];
	}

	public draw(target: CanvasRenderingTarget2D, utils?: DrawingUtils): void {
		const p1 = this._screenPoints[0];
		const p2 = this._screenPoints[1];
		if (!p1 || !p2) return;

		const opts = this._options;
		target.useMediaCoordinateSpace(scope => {
			const ctx = scope.context;
			const x = Math.min(p1.x, p2.x);
			const y = Math.min(p1.y, p2.y);
			const w = Math.abs(p2.x - p1.x);
			const h = Math.abs(p2.y - p1.y);

			ctx.save();
			ctx.fillStyle = colorWithAlpha(opts.fillColor, opts.fillOpacity);
			ctx.fillRect(x, y, w, h);

			ctx.strokeStyle = opts.color;
			ctx.lineWidth = opts.lineWidth;
			applyCanvasLineStyle(ctx, opts.lineStyle, opts.lineWidth, utils);
			ctx.strokeRect(x, y, w, h);
			ctx.restore();
		});
	}

	protected hitTestBody(point: ScreenPoint): BodyHitResult | null {
		const p1 = this._screenPoints[0];
		const p2 = this._screenPoints[1];
		if (!p1 || !p2) return null;

		const borderDist = distanceToRectBorder(point, p1, p2);
		if (borderDist <= LINE_HIT_TOLERANCE + this._options.lineWidth / 2) {
			return { distance: borderDist, priority: 1, cursorStyle: 'grab' };
		}
		if (pointInRect(point, p1, p2)) {
			return { distance: borderDist, priority: 0, cursorStyle: 'grab' };
		}
		return null;
	}
}
