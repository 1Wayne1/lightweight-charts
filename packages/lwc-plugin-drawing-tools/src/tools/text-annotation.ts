import { CanvasRenderingTarget2D } from 'fancy-canvas';
import { DrawingUtils } from 'lightweight-charts';
import { BaseDrawing, BodyHitResult } from '../base-drawing';
import { colorWithAlpha } from '../geometry';
import { AnchorPoint, DrawingStyleOptions, DrawingToolType, ScreenPoint } from '../types';

interface TextBoxBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

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

export class TextAnnotationDrawing extends BaseDrawing {
	public readonly type: DrawingToolType = 'text';
	private _cachedBounds: TextBoxBounds | null = null;

	public constructor(
		id: string,
		points: AnchorPoint[],
		options: Partial<DrawingStyleOptions> = {}
	) {
		super(id, points, {
			color: '#2962FF',
			backgroundColor: '#1E222D',
			fillColor: '#1E222D',
			fillOpacity: 0.88,
			textColor: '#D1D4DC',
			fontSize: 13,
			text: 'Text Note',
			...options,
		});
	}

	public draw(target: CanvasRenderingTarget2D, _utils?: DrawingUtils): void {
		const anchor = this._screenPoints[0];
		if (!anchor) {
			this._cachedBounds = null;
			return;
		}

		const opts = this._options;
		const lines = (opts.text || 'Text').split('\n');
		const fontSize = Math.max(10, Math.min(36, opts.fontSize));
		const lineHeight = Math.round(fontSize * 1.38);
		const padX = 10;
		const padY = 6;

		target.useMediaCoordinateSpace(scope => {
			const ctx = scope.context;
			ctx.save();
			ctx.font = `500 ${fontSize}px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, sans-serif`;

			let maxW = 36;
			for (const line of lines) {
				maxW = Math.max(maxW, ctx.measureText(line).width);
			}

			const width = maxW + padX * 2;
			const height = lines.length * lineHeight + padY * 2;
			const x = anchor.x;
			const y = anchor.y - height / 2;
			this._cachedBounds = { x, y, width, height };

			drawRoundedRect(ctx, x, y, width, height, 6);
			ctx.fillStyle = colorWithAlpha(opts.fillColor, opts.fillOpacity);
			ctx.fill();

			ctx.strokeStyle = this.isSelected() || this.isHovered()
				? opts.color
				: colorWithAlpha(opts.color, 0.75);
			ctx.lineWidth = this.isSelected() ? 1.75 : 1;
			ctx.stroke();

			ctx.fillStyle = opts.textColor;
			ctx.textAlign = 'left';
			ctx.textBaseline = 'top';
			for (let i = 0; i < lines.length; i++) {
				ctx.fillText(lines[i], x + padX, y + padY + i * lineHeight + 1);
			}

			ctx.restore();
		});
	}

	protected hitTestBody(point: ScreenPoint): BodyHitResult | null {
		const box = this._cachedBounds;
		if (!box) return null;
		if (
			point.x >= box.x - 2 &&
			point.x <= box.x + box.width + 2 &&
			point.y >= box.y - 2 &&
			point.y <= box.y + box.height + 2
		) {
			const cx = box.x + box.width / 2;
			const cy = box.y + box.height / 2;
			return {
				distance: Math.hypot(point.x - cx, point.y - cy) * 0.05,
				priority: 1,
				cursorStyle: 'grab',
			};
		}
		return null;
	}
}
