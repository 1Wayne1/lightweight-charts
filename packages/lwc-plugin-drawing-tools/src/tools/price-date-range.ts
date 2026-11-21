import { CanvasRenderingTarget2D } from 'fancy-canvas';
import { DrawingUtils } from 'lightweight-charts';
import {
	BaseDrawing,
	BodyHitResult,
	LINE_HIT_TOLERANCE,
} from '../base-drawing';
import {
	formatDuration,
	formatPrice,
	timeToEpochSeconds,
} from '../coordinates';
import {
	colorWithAlpha,
	distanceToRectBorder,
	pointInRect,
} from '../geometry';
import { DrawingToolType, ScreenPoint } from '../types';

function drawArrowHead(
	ctx: CanvasRenderingContext2D,
	tipX: number,
	tipY: number,
	angle: number,
	size: number
): void {
	ctx.beginPath();
	ctx.moveTo(tipX, tipY);
	ctx.lineTo(
		tipX - size * Math.cos(angle - Math.PI / 6),
		tipY - size * Math.sin(angle - Math.PI / 6)
	);
	ctx.moveTo(tipX, tipY);
	ctx.lineTo(
		tipX - size * Math.cos(angle + Math.PI / 6),
		tipY - size * Math.sin(angle + Math.PI / 6)
	);
	ctx.stroke();
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

export class PriceDateRangeDrawing extends BaseDrawing {
	public readonly type: DrawingToolType = 'price-date-range';

	public draw(target: CanvasRenderingTarget2D, _utils?: DrawingUtils): void {
		const p1 = this._screenPoints[0];
		const p2 = this._screenPoints[1];
		const a1 = this._points[0];
		const a2 = this._points[1];
		const series = this.seriesOrNull();
		if (!p1 || !p2 || !a1 || !a2 || !series) return;

		const opts = this._options;
		const priceDelta = a2.price - a1.price;
		const pctDelta = a1.price !== 0 ? (priceDelta / Math.abs(a1.price)) * 100 : 0;
		const barCount = Math.round(a2.logical - a1.logical);
		const t1 = timeToEpochSeconds(a1.time);
		const t2 = timeToEpochSeconds(a2.time);
		const durationText =
			t1 !== null && t2 !== null ? `, ${formatDuration(t2 - t1)}` : '';

		const sign = priceDelta >= 0 ? '+' : '';
		const line1 = `${sign}${formatPrice(series, priceDelta)} (${sign}${pctDelta.toFixed(2)}%)`;
		const line2 = `${Math.abs(barCount)} bars${durationText}`;

		target.useMediaCoordinateSpace(scope => {
			const ctx = scope.context;
			const minX = Math.min(p1.x, p2.x);
			const minY = Math.min(p1.y, p2.y);
			const width = Math.abs(p2.x - p1.x);
			const height = Math.abs(p2.y - p1.y);
			const midX = (p1.x + p2.x) / 2;
			const midY = (p1.y + p2.y) / 2;

			ctx.save();

			// Shaded range area
			ctx.fillStyle = colorWithAlpha(opts.fillColor, opts.fillOpacity);
			ctx.fillRect(minX, minY, width, height);

			// Border
			ctx.strokeStyle = colorWithAlpha(opts.color, 0.85);
			ctx.lineWidth = Math.max(1, opts.lineWidth - 0.5);
			ctx.strokeRect(minX, minY, width, height);

			// Center horizontal & vertical measurement arrows
			ctx.strokeStyle = opts.color;
			ctx.lineWidth = Math.max(1.25, opts.lineWidth - 0.25);

			if (width > 12) {
				ctx.beginPath();
				ctx.moveTo(p1.x, midY);
				ctx.lineTo(p2.x, midY);
				ctx.stroke();
				drawArrowHead(ctx, p2.x, midY, p2.x >= p1.x ? 0 : Math.PI, 6);
			}
			if (height > 12) {
				ctx.beginPath();
				ctx.moveTo(midX, p1.y);
				ctx.lineTo(midX, p2.y);
				ctx.stroke();
				drawArrowHead(
					ctx,
					midX,
					p2.y,
					p2.y >= p1.y ? Math.PI / 2 : -Math.PI / 2,
					6
				);
			}

			// Info callout badge
			if (opts.showLabels) {
				ctx.font = '600 11.5px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, sans-serif';
				const textW = Math.max(
					ctx.measureText(line1).width,
					ctx.measureText(line2).width
				);
				const padX = 10;
				const padY = 6;
				const boxW = textW + padX * 2;
				const boxH = 34 + padY;

				const placeBelow = p2.y >= p1.y;
				let boxX = midX - boxW / 2;
				let boxY = placeBelow ? Math.max(p1.y, p2.y) + 8 : Math.min(p1.y, p2.y) - boxH - 8;

				// Clamp inside viewport
				boxX = Math.max(6, Math.min(scope.mediaSize.width - boxW - 6, boxX));
				boxY = Math.max(6, Math.min(scope.mediaSize.height - boxH - 6, boxY));

				drawRoundedRect(ctx, boxX, boxY, boxW, boxH, 5);
				ctx.fillStyle = opts.color;
				ctx.fill();

				ctx.fillStyle = '#FFFFFF';
				ctx.textAlign = 'center';
				ctx.textBaseline = 'top';
				ctx.fillText(line1, boxX + boxW / 2, boxY + 6);
				ctx.font = '400 11px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, sans-serif';
				ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
				ctx.fillText(line2, boxX + boxW / 2, boxY + 21);
			}

			ctx.restore();
		});
	}

	protected hitTestBody(point: ScreenPoint, hitSlop: number = 0): BodyHitResult | null {
		const p1 = this._screenPoints[0];
		const p2 = this._screenPoints[1];
		if (!p1 || !p2) return null;

		const borderDist = distanceToRectBorder(point, p1, p2);
		if (borderDist <= LINE_HIT_TOLERANCE + hitSlop + this._options.lineWidth / 2) {
			return { distance: borderDist, priority: 1, cursorStyle: 'grab' };
		}
		if (pointInRect(point, p1, p2)) {
			return { distance: borderDist, priority: 0, cursorStyle: 'grab' };
		}
		return null;
	}
}
