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
import { AnchorPoint, DrawingToolType, EditHandle, ScreenPoint } from '../types';

export class FibRetracementDrawing extends BaseDrawing {
	public readonly type: DrawingToolType = 'fib-retracement';

	public override previewStepLabel(draftCount: number): string {
		if (draftCount === 0) return '斐波那契回撤 (1/2) · 点击放置回撤起点';
		return '斐波那契回撤 (2/2) · 移动至回撤终点点击';
	}

	public override editHandles(): readonly EditHandle[] {
		const p1 = this._screenPoints[0];
		const p2 = this._screenPoints[1];
		if (!p1 || !p2) {
			return super.editHandles(0, 0);
		}
		const sameDir = (p1.x <= p2.x) === (p1.y <= p2.y);
		const primaryCursor = sameDir ? 'nwse-resize' : 'nesw-resize';
		const secondaryCursor = sameDir ? 'nesw-resize' : 'nwse-resize';
		return [
			{ id: '0', point: p1, anchorIndex: 0, cursor: primaryCursor, axisAnchors: [0] },
			{ id: '1', point: p2, anchorIndex: 1, cursor: primaryCursor, axisAnchors: [1] },
			{ id: 'c1', point: { x: p1.x, y: p2.y }, cursor: secondaryCursor, axisAnchors: [0, 1] },
			{ id: 'c2', point: { x: p2.x, y: p1.y }, cursor: secondaryCursor, axisAnchors: [0, 1] },
		];
	}

	public override applyHandleDrag(
		handleId: string,
		targetAnchor: AnchorPoint,
		origPoints: readonly AnchorPoint[]
	): AnchorPoint[] | null {
		if (origPoints.length < 2) return null;
		const a0 = origPoints[0];
		const a1 = origPoints[1];
		if (handleId === 'c1') {
			return [
				{
					logical: targetAnchor.logical,
					price: a0.price,
					...(targetAnchor.time !== undefined ? { time: targetAnchor.time } : {}),
				},
				{ ...a1, price: targetAnchor.price },
			];
		}
		if (handleId === 'c2') {
			return [
				{ ...a0, price: targetAnchor.price },
				{
					logical: targetAnchor.logical,
					price: a1.price,
					...(targetAnchor.time !== undefined ? { time: targetAnchor.time } : {}),
				},
			];
		}
		return super.applyHandleDrag(handleId, targetAnchor, origPoints, false);
	}

	public draw(target: CanvasRenderingTarget2D, utils?: DrawingUtils): void {
		const p1 = this._screenPoints[0];
		const p2 = this._screenPoints[1];
		const a1 = this._points[0];
		const a2 = this._points[1];
		const series = this.seriesOrNull();
		if (!p1 || !p2 || !a1 || !a2 || !series) return;

		const opts = this._options;
		const active = this.isHovered() || this.isSelected() || this.isPreview();
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
			ctx.strokeStyle = colorWithAlpha(opts.color, active ? 0.8 : 0.38);
			ctx.lineWidth = 1;
			applyCanvasLineStyle(ctx, LineStyle.Dashed, 1, utils);
			ctx.beginPath();
			ctx.moveTo(p1.x, p1.y);
			ctx.lineTo(p2.x, p2.y);
			ctx.stroke();

			// 3. Horizontal Fibonacci level lines & labels
			for (const lvl of computedLevels) {
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
				const sortedByY = computedLevels.slice().sort((a, b) => a.y - b.y);
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
