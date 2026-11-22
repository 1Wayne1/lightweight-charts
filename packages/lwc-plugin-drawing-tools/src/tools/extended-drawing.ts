import { drawingTextFont } from '../attached-text';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import { BaseDrawing, applyCanvasLineStyle, type BodyHitResult, LINE_HIT_TOLERANCE } from '../base-drawing';
import { distancePointToSegment, pointInPolygon, colorWithAlpha } from '../geometry';
import type { Logical } from 'lightweight-charts';
import type { AnchorPoint, DrawingStyleOptions, ScreenPoint } from '../types';
import type { ExtendedToolType } from './catalog';
import { buildExtendedScene, type DrawingBar, type DrawingScene } from './extended-geometry';

/** A series primitive whose rendering and hit testing use the same generated geometry. */
export class ExtendedDrawing extends BaseDrawing {
	public readonly type: ExtendedToolType;
	private _scene: DrawingScene = { paths: [], labels: [] };
	private _labelBounds: { x: number; y: number; width: number; height: number }[] = [];
	private _bars: () => readonly DrawingBar[] = () => [];
	public constructor(type: ExtendedToolType, id: string, points: AnchorPoint[], options: Partial<DrawingStyleOptions>) {
		super(id, points, options); this.type = type;
	}
	public setDataSource(source: () => readonly DrawingBar[]): void { this._bars = source; }
	public override anchorHandlePoints(_width: number, _height: number): readonly (ScreenPoint | null)[] {
		if (this.type === 'brush' || this.type === 'highlighter') {
			const first = this._screenPoints[0] ?? null;
			const last = this._screenPoints.length > 1 ? (this._screenPoints[this._screenPoints.length - 1] ?? null) : null;
			return last ? [first, last] : (first ? [first] : []);
		}
		return this._screenPoints;
	}
	public draw(target: CanvasRenderingTarget2D): void {
		const series = this.seriesOrNull(); const chart = this.chartOrNull();
		if (!series || !chart || this._screenPoints.some(p => p === null)) return;
		target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
			this._scene = buildExtendedScene(this.type, {
				width: mediaSize.width, height: mediaSize.height, anchors: this._points,
				points: this._screenPoints as ScreenPoint[], options: this._options, bars: this._bars(),
				project: (logical, price) => { const x = chart.timeScale().logicalToCoordinate(logical as Logical); const y = series.priceToCoordinate(price); return x === null || y === null ? null : { x, y }; },
			});
			ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
			ctx.beginPath(); ctx.rect(0, 0, mediaSize.width, mediaSize.height); ctx.clip();
			for (const path of this._scene.paths) {
				if (!path.points.length) continue;
				ctx.beginPath(); ctx.moveTo(path.points[0].x, path.points[0].y);
				for (const point of path.points.slice(1)) ctx.lineTo(point.x, point.y);
				if (path.closed) ctx.closePath();
				ctx.globalAlpha = path.opacity ?? 1;
				if (path.fill) { ctx.fillStyle = colorWithAlpha(path.fill, this._options.fillOpacity); ctx.fill(); }
				ctx.strokeStyle = path.color ?? this._options.color;
				ctx.lineWidth = path.width ?? this._options.lineWidth;
				applyCanvasLineStyle(ctx, this._options.lineStyle, ctx.lineWidth); ctx.stroke();
			}
			ctx.globalAlpha = 1; ctx.setLineDash([]);
			ctx.font = drawingTextFont(this._options);
			ctx.textBaseline = 'top'; this._labelBounds = [];
			for (const label of this._scene.labels) {
				const lines = label.text.split('\n'); const font = label.fontSize ?? this._options.fontSize;
				ctx.font = drawingTextFont(label.fontSize ? { ...this._options, fontSize: font, textBold: false, textItalic: false } : this._options);
				ctx.globalAlpha = 1;
				const width = Math.max(...lines.map(line => ctx.measureText(line).width)) + 12;
				const height = lines.length * (font + 4) + 8;
				const x = label.point.x + 4; const y = label.point.y - height / 2;
				this._labelBounds.push({ x, y, width, height });
				if (label.background) { ctx.fillStyle = colorWithAlpha(this._options.backgroundColor, 0.88); ctx.fillRect(x, y, width, height); }
				ctx.globalAlpha = label.fontSize ? 1 : this._options.textOpacity;
				ctx.fillStyle = label.color ?? this._options.textColor;
				lines.forEach((line, i) => ctx.fillText(line, x + 6, y + 4 + i * (font + 4)));
			}
			ctx.restore();
		});
	}
	protected hitTestBody(point: ScreenPoint, hitSlop: number = 0): BodyHitResult | null {
		if (this._labelBounds.some(b => point.x >= b.x - hitSlop && point.x <= b.x + b.width + hitSlop && point.y >= b.y - hitSlop && point.y <= b.y + b.height + hitSlop)) return { distance: 0, priority: 1 };
		let closest = Infinity; let filled = false;
		for (const path of this._scene.paths) {
			for (let i = 1; i < path.points.length; i++) closest = Math.min(closest, distancePointToSegment(point, path.points[i - 1], path.points[i]));
			if (path.closed && path.points.length > 2) {
				closest = Math.min(closest, distancePointToSegment(point, path.points[0], path.points[path.points.length - 1]));
				filled ||= Boolean(path.fill) && pointInPolygon(point, path.points);
			}
		}
		if (closest <= LINE_HIT_TOLERANCE + hitSlop + this._options.lineWidth / 2) return { distance: closest, priority: 1 };
		return filled ? { distance: 0, priority: 0 } : null;
	}
}
