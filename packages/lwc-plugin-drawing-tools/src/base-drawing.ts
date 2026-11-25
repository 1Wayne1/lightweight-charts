import { CanvasRenderingTarget2D } from 'fancy-canvas';
import {
	DrawingUtils,
	IChartApi,
	IPrimitivePaneRenderer,
	IPrimitivePaneView,
	ISeriesApi,
	ISeriesPrimitiveAxisView,
	LineStyle,
	PrimitiveHoveredItem,
	PrimitivePaneViewZOrder,
	SeriesType,
} from 'lightweight-charts';
import { attachedTextPlacements, paintAttachedText, textTargetContains, type AttachedTextTarget } from './attached-text';
import { PluginBase } from '@tradingview/lwc-toolkit/plugin-base';
import {
	anchorToScreen,
	formatPrice,
	formatTime,
} from './coordinates';
import { distancePointToPoint } from './geometry';
import {
	AnchorPoint,
	BASE_DRAWING_OPTIONS,
	DrawingStyleOptions,
	DrawingToolType,
	EditHandle,
	encodeExternalId,
	ScreenPoint,
	SerializedDrawing,
} from './types';

export interface AxisLabelSpec {
	coord: number | null;
	text: string;
	color: string;
	textColor?: string;
	/** Overrides default (selected || preview) visibility while still gated by isRenderVisible() && showLabels. */
	visible?: boolean;
}

export const ANCHOR_HIT_RADIUS = 8;
export const LINE_HIT_TOLERANCE = 6;

export interface BodyHitResult {
	distance: number;
	/** 0 = range/fill, 1 = line/stroke, 2 = point/anchor */
	priority: number;
	cursorStyle?: string;
}

export class DrawingAxisLabelView implements ISeriesPrimitiveAxisView {
	private _coord: number = -10000;
	private _text: string = '';
	private _visible: boolean = false;
	private _backColor: string = '#2962FF';
	private _textColor: string = '#FFFFFF';

	public update(
		coord: number | null,
		text: string,
		visible: boolean,
		backColor: string,
		textColor: string = '#FFFFFF'
	): void {
		this._coord = coord ?? -10000;
		this._text = text;
		this._visible = visible && coord !== null;
		this._backColor = backColor;
		this._textColor = textColor;
	}

	public coordinate(): number {
		return this._coord;
	}

	public text(): string {
		return this._text;
	}

	public textColor(): string {
		return this._textColor;
	}

	public backColor(): string {
		return this._backColor;
	}

	public visible(): boolean {
		return this._visible;
	}

	public tickVisible(): boolean {
		return this._visible;
	}
}

export function applyCanvasLineStyle(
	ctx: CanvasRenderingContext2D,
	lineStyle: LineStyle,
	lineWidth: number,
	utils?: DrawingUtils
): void {
	if (utils) {
		utils.setLineStyle(ctx, lineStyle);
		return;
	}
	const w = Math.max(1, lineWidth);
	switch (lineStyle) {
		case LineStyle.Dotted:
			ctx.setLineDash([w, w * 2]);
			break;
		case LineStyle.Dashed:
			ctx.setLineDash([w * 4, w * 3]);
			break;
		case LineStyle.LargeDashed:
			ctx.setLineDash([w * 7, w * 4]);
			break;
		case LineStyle.SparseDotted:
			ctx.setLineDash([w, w * 4]);
			break;
		default:
			ctx.setLineDash([]);
			break;
	}
}

const HANDLE_ACCENT = '#2962FF';
const HANDLE_LOCKED_ACCENT = '#6C8CE8';

export function drawAnchorHandles(
	target: CanvasRenderingTarget2D,
	points: readonly (ScreenPoint | null)[],
	_color: string,
	hoveredIndex: number | null,
	locked: boolean
): void {
	target.useMediaCoordinateSpace(scope => {
		const ctx = scope.context;
		ctx.save();
		ctx.setLineDash([]);
		for (let i = 0; i < points.length; i++) {
			const pt = points[i];
			if (!pt) continue;
			const isHovered = hoveredIndex === i;
			const size = isHovered ? 12 : 10;
			const half = size / 2;
			const corner = isHovered ? 4 : 3.5;
			const stroke = locked ? HANDLE_LOCKED_ACCENT : HANDLE_ACCENT;

			// Soft TradingView-style blue focus halo for clear hover/selection distinction
			ctx.beginPath();
			if (typeof ctx.roundRect === 'function') {
				ctx.roundRect(pt.x - half - 2.5, pt.y - half - 2.5, size + 5, size + 5, corner + 2);
			} else {
				ctx.arc(pt.x, pt.y, half + 2.5, 0, Math.PI * 2);
			}
			ctx.fillStyle = isHovered ? 'rgba(41, 98, 255, 0.32)' : 'rgba(41, 98, 255, 0.18)';
			ctx.fill();

			ctx.beginPath();
			if (typeof ctx.roundRect === 'function') {
				ctx.roundRect(pt.x - half, pt.y - half, size, size, corner);
			} else {
				ctx.arc(pt.x, pt.y, half, 0, Math.PI * 2);
			}
			ctx.fillStyle = locked ? '#1E222D' : '#0C0D10';
			ctx.fill();
			ctx.lineWidth = isHovered ? 2.6 : 2.2;
			ctx.strokeStyle = stroke;
			ctx.stroke();
		}
		ctx.restore();
	});
}

class DrawingPaneView implements IPrimitivePaneView {
	private readonly _source: BaseDrawing;
	private readonly _renderer: IPrimitivePaneRenderer;

	public constructor(source: BaseDrawing) {
		this._source = source;
		this._renderer = {
			draw: (target: CanvasRenderingTarget2D, utils?: DrawingUtils) => {
				if (!this._source.isRenderVisible()) {
					return;
				}
				this._source.draw(target, utils);
				this._source.drawAttachedText(target);
				if (this._source.shouldDrawAnchors()) {
					let handlePoints: readonly (ScreenPoint | null)[] = [];
					let activeIndex: number | null = this._source.hoveredAnchorIndex();
					target.useMediaCoordinateSpace(({ mediaSize }) => {
						const handles = this._source.editHandles(mediaSize.width, mediaSize.height);
						if (handles.length > 0) {
							handlePoints = handles.map(h => h.point);
							const activeId = this._source.activeHandleId() ?? this._source.hoveredHandleId();
							if (activeId !== null) {
								const idx = handles.findIndex(h => h.id === activeId);
								activeIndex = idx >= 0 ? idx : null;
							}
						} else {
							handlePoints = this._source.anchorHandlePoints(mediaSize.width, mediaSize.height);
						}
					});
					drawAnchorHandles(
						target,
						handlePoints,
						this._source.options().color,
						activeIndex,
						this._source.options().locked
					);
				}
			},
		};
	}

	public zOrder(): PrimitivePaneViewZOrder {
		return this._source.options().zOrder;
	}

	public renderer(): IPrimitivePaneRenderer | null {
		return this._renderer;
	}
}

export abstract class BaseDrawing extends PluginBase {
	public readonly id: string;
	public abstract readonly type: DrawingToolType;

	protected _points: AnchorPoint[];
	protected _screenPoints: (ScreenPoint | null)[] = [];
	protected _options: DrawingStyleOptions;

	private _textTargets: AttachedTextTarget[] = [];
	private readonly _paneViews: DrawingPaneView[];
	protected _priceAxisViews: DrawingAxisLabelView[] = [];
	protected _timeAxisViews: DrawingAxisLabelView[] = [];
	protected _priceAxisPaneViews: IPrimitivePaneView[] = [];
	protected _timeAxisPaneViews: IPrimitivePaneView[] = [];

	private _selected: boolean = false;
	private _hovered: boolean = false;
	private _hoveredAnchorIndex: number | null = null;
	private _hoveredHandleId: string | null = null;
	private _activeHandleId: string | null = null;
	private _isPreview: boolean = false;
	private _globalVisible: boolean = true;

	public constructor(
		id: string,
		points: AnchorPoint[],
		options: Partial<DrawingStyleOptions> = {}
	) {
		super();
		this.id = id;
		this._points = points.map(p => ({ ...p }));
		this._options = {
			...BASE_DRAWING_OPTIONS,
			...options,
			fibLevels: options.fibLevels
				? options.fibLevels.map(l => ({ ...l }))
				: BASE_DRAWING_OPTIONS.fibLevels.map(l => ({ ...l })),
		};
		this._paneViews = [new DrawingPaneView(this)];
	}

	public options(): Readonly<DrawingStyleOptions> {
		return this._options;
	}

	public applyOptions(partial: Partial<DrawingStyleOptions>): void {
		this._options = {
			...this._options,
			...partial,
			...(partial.fibLevels
				? { fibLevels: partial.fibLevels.map(l => ({ ...l })) }
				: {}),
		};
		this.updateAllViews();
		this.requestUpdate();
	}

	public points(): readonly AnchorPoint[] {
		return this._points;
	}

	public setPoints(points: AnchorPoint[]): void {
		this._points = points.map(p => ({ ...p }));
		this.updateAllViews();
		this.requestUpdate();
	}

	public setPoint(index: number, point: AnchorPoint): void {
		if (index < 0) return;
		this._points[index] = { ...point };
		this.updateAllViews();
		this.requestUpdate();
	}

	public screenPoints(): readonly (ScreenPoint | null)[] {
		return this._screenPoints;
	}

	public isSelected(): boolean {
		return this._selected;
	}

	public setSelected(selected: boolean): void {
		if (this._selected === selected) return;
		this._selected = selected;
		this.updateAxisViews();
		this.requestUpdate();
	}

	public isHovered(): boolean {
		return this._hovered;
	}

	public hoveredAnchorIndex(): number | null {
		return this._hoveredAnchorIndex;
	}

	public hoveredHandleId(): string | null {
		return this._hoveredHandleId;
	}

	public activeHandleId(): string | null {
		return this._activeHandleId;
	}

	public setActiveHandle(handleId: string | null): void {
		if (this._activeHandleId === handleId) return;
		this._activeHandleId = handleId;
		if (this._selected || this._isPreview) {
			this.updateAxisViews();
		}
		this.requestUpdate();
	}

	public setHoverState(
		hovered: boolean,
		anchorIndex: number | null = null,
		handleId: string | null = null
	): void {
		const nextHandleId = hovered
			? (handleId ?? (anchorIndex !== null ? String(anchorIndex) : null))
			: null;
		if (
			this._hovered === hovered &&
			this._hoveredAnchorIndex === anchorIndex &&
			this._hoveredHandleId === nextHandleId
		) {
			return;
		}
		this._hovered = hovered;
		this._hoveredAnchorIndex = anchorIndex;
		this._hoveredHandleId = nextHandleId;
		this.updateAxisViews();
		this.requestUpdate();
	}

	public isPreview(): boolean {
		return this._isPreview;
	}

	public setPreview(preview: boolean): void {
		this._isPreview = preview;
		this.updateAxisViews();
		this.requestUpdate();
	}

	public setGlobalVisible(visible: boolean): void {
		if (this._globalVisible === visible) return;
		this._globalVisible = visible;
		this.updateAxisViews();
		this.requestUpdate();
	}

	public isRenderVisible(): boolean {
		return this._globalVisible && this._options.visible;
	}

	public shouldDrawAnchors(): boolean {
		return this._selected || this._hovered || this._isPreview;
	}

	/** Screen coordinates where hover/selection anchor handles should be rendered. */
	public anchorHandlePoints(_width: number, _height: number): readonly (ScreenPoint | null)[] {
		return this._screenPoints;
	}

	/** Semantic edit handles (corners, edge midpoints, constrained anchors). */
	public editHandles(width: number, height: number): readonly EditHandle[] {
		const pts = this.anchorHandlePoints(width, height);
		if (pts.length !== this._screenPoints.length) {
			return [];
		}
		const handles: EditHandle[] = [];
		for (let i = 0; i < pts.length; i++) {
			const point = pts[i];
			if (!point) continue;
			handles.push({
				id: String(i),
				point,
				anchorIndex: i,
				cursor: 'pointer',
				axisAnchors: [i],
			});
		}
		return handles;
	}

	/** Maps a semantic handle drag into updated canonical anchors. */
	public applyHandleDrag(
		handleId: string,
		targetAnchor: AnchorPoint,
		origPoints: readonly AnchorPoint[],
		_shiftKey: boolean
	): AnchorPoint[] | null {
		const idx = Number(handleId);
		if (!Number.isInteger(idx) || idx < 0 || idx >= origPoints.length) {
			return null;
		}
		const next = origPoints.map(p => ({ ...p }));
		next[idx] = { ...targetAnchor };
		return next;
	}

	/** Optional live step prompt shown in the HUD while creating a multi-step drawing. */
	public previewStepLabel(_draftCount: number): string | null {
		return null;
	}

	/** Optional custom axis labels (e.g., color-coded Target/Entry/Stop tags). */
	public customAxisLabels(
		_chart: IChartApi,
		_series: ISeriesApi<SeriesType>
	): { price: AxisLabelSpec[]; time: AxisLabelSpec[] } | null {
		return null;
	}

	public serialize(): SerializedDrawing {
		return {
			id: this.id,
			type: this.type,
			points: this._points.map(p => ({ ...p })),
			options: {
				...this._options,
				fibLevels: this._options.fibLevels.map(l => ({ ...l })),
			},
		};
	}

	public chartOrNull(): IChartApi | null {
		try {
			return this.chart;
		} catch {
			return null;
		}
	}

	public seriesOrNull(): ISeriesApi<SeriesType> | null {
		try {
			return this.series;
		} catch {
			return null;
		}
	}

	public updateAllViews(): void {
		const chart = this.chartOrNull();
		const series = this.seriesOrNull();
		if (!chart || !series) {
			this._screenPoints = this._points.map(() => null);
			return;
		}
		this._screenPoints = this._points.map(pt => anchorToScreen(chart, series, pt));
		this.onViewsUpdated(chart, series);
		this.updateAxisViews();
	}

	/** Subclasses can override to update extra cached geometry or axis pane views. */
	protected onViewsUpdated(_chart: IChartApi, _series: ISeriesApi<SeriesType>): void {
		// Default no-op
	}

	/**
	 * Replaces `_priceAxisViews` / `_timeAxisViews` with a fresh array instance when growing so
	 * Lightweight Charts' `SeriesPrimitiveWrapper` reference-equality cache refreshes its axis wrappers.
	 */
	protected _ensureAxisViewCapacity(priceCount: number, timeCount: number): void {
		if (this._priceAxisViews.length < priceCount) {
			const grown = [...this._priceAxisViews];
			while (grown.length < priceCount) {
				grown.push(new DrawingAxisLabelView());
			}
			this._priceAxisViews = grown;
		}
		if (this._timeAxisViews.length < timeCount) {
			const grown = [...this._timeAxisViews];
			while (grown.length < timeCount) {
				grown.push(new DrawingAxisLabelView());
			}
			this._timeAxisViews = grown;
		}
	}

	/** Default axis views show anchor prices & times when selected or previewing, de-cluttered for multi-point tools. */
	protected updateAxisViews(): void {
		const chart = this.chartOrNull();
		const series = this.seriesOrNull();
		const canShow = this.isRenderVisible() && this._options.showLabels;
		const defaultShow = canShow && (this._selected || this._isPreview);

		const custom = chart && series ? this.customAxisLabels(chart, series) : null;
		if (custom) {
			this._ensureAxisViewCapacity(custom.price.length, custom.time.length);
			for (let i = 0; i < custom.price.length; i++) {
				const spec = custom.price[i];
				const specShow = spec.visible !== undefined ? (canShow && spec.visible) : defaultShow;
				this._priceAxisViews[i].update(spec.coord, spec.text, specShow, spec.color, spec.textColor);
			}
			for (let i = custom.price.length; i < this._priceAxisViews.length; i++) {
				this._priceAxisViews[i].update(null, '', false, this._options.color);
			}
			for (let i = 0; i < custom.time.length; i++) {
				const spec = custom.time[i];
				const specShow = spec.visible !== undefined ? (canShow && spec.visible) : defaultShow;
				this._timeAxisViews[i].update(spec.coord, spec.text, specShow, spec.color, spec.textColor);
			}
			for (let i = custom.time.length; i < this._timeAxisViews.length; i++) {
				this._timeAxisViews[i].update(null, '', false, this._options.color);
			}
			return;
		}

		let indices: number[] = [];
		if (this._isPreview) {
			if (this._points.length > 0) indices = [this._points.length - 1];
		} else if (this._points.length >= 3) {
			const activeId = this._activeHandleId ?? this._hoveredHandleId;
			if (activeId !== null && chart && series) {
				const handles = this.editHandles(chart.timeScale().width(), series.getPane().getHeight());
				const matched = handles.find(h => h.id === activeId);
				if (matched?.axisAnchors?.length) {
					indices = matched.axisAnchors.filter(idx => idx >= 0 && idx < this._points.length);
				} else if (matched?.anchorIndex !== undefined && matched.anchorIndex < this._points.length) {
					indices = [matched.anchorIndex];
				}
			}
			if (indices.length === 0 && this._hoveredAnchorIndex !== null && this._hoveredAnchorIndex < this._points.length) {
				indices = [this._hoveredAnchorIndex];
			}
			if (indices.length === 0) {
				indices = [0, this._points.length - 1];
			}
		} else {
			indices = this._points.map((_, i) => i);
		}

		this._ensureAxisViewCapacity(indices.length, indices.length);

		for (let viewIdx = 0; viewIdx < indices.length; viewIdx++) {
			const i = indices[viewIdx];
			const sp = this._screenPoints[i] ?? null;
			const pt = this._points[i];
			const priceText = series ? formatPrice(series, pt.price) : pt.price.toFixed(2);
			const timeText = chart ? formatTime(chart, pt) : '';
			this._priceAxisViews[viewIdx].update(
				sp ? sp.y : null,
				priceText,
				defaultShow,
				this._options.color
			);
			this._timeAxisViews[viewIdx].update(
				sp ? sp.x : null,
				timeText,
				defaultShow,
				this._options.color
			);
		}
		for (let i = indices.length; i < this._priceAxisViews.length; i++) {
			this._priceAxisViews[i].update(null, '', false, this._options.color);
		}
		for (let i = indices.length; i < this._timeAxisViews.length; i++) {
			this._timeAxisViews[i].update(null, '', false, this._options.color);
		}
	}

	public paneViews(): readonly IPrimitivePaneView[] {
		return this._paneViews;
	}

	public priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
		return this._priceAxisViews;
	}

	public timeAxisViews(): readonly ISeriesPrimitiveAxisView[] {
		return this._timeAxisViews;
	}

	public priceAxisPaneViews(): readonly IPrimitivePaneView[] {
		return this._priceAxisPaneViews;
	}

	public timeAxisPaneViews(): readonly IPrimitivePaneView[] {
		return this._timeAxisPaneViews;
	}

	public hitTest(x: number, y: number, hitSlop: number = 0): PrimitiveHoveredItem | null {
		if (!this.isRenderVisible() || this._isPreview) {
			return null;
		}
		const point: ScreenPoint = { x, y };

		// 1. Anchors & semantic handles take highest priority when drawing is selected or hovered
		if (this._selected || this._hovered) {
			const chart = this.chartOrNull();
			const series = this.seriesOrNull();
			const handles = chart && series
				? this.editHandles(chart.timeScale().width(), series.getPane().getHeight())
				: [];
			let bestHandle: EditHandle | null = null;
			let bestHandleDist = Infinity;
			for (const handle of handles) {
				const dist = distancePointToPoint(point, handle.point);
				if (dist <= ANCHOR_HIT_RADIUS + hitSlop && dist < bestHandleDist) {
					bestHandleDist = dist;
					bestHandle = handle;
				}
			}
			if (bestHandle) {
				const isDirectAnchor =
					bestHandle.anchorIndex !== undefined &&
					bestHandle.id === String(bestHandle.anchorIndex);
				return {
					externalId: encodeExternalId(
						isDirectAnchor
							? {
								drawingId: this.id,
								part: 'anchor',
								anchorIndex: bestHandle.anchorIndex,
							}
							: {
								drawingId: this.id,
								part: 'handle',
								handleId: bestHandle.id,
							}
					),
					zOrder: this._options.zOrder,
					distance: bestHandleDist,
					hitTestPriority: 2,
					cursorStyle: bestHandle.cursor ?? 'pointer',
				};
			}
		}

		// 2. Body hit test delegated to concrete tool
		const bodyHit = this.textTargetAt(point) ? { distance: 0, priority: 1, cursorStyle: 'pointer' } : this.hitTestBody(point, hitSlop);
		if (!bodyHit) {
			return null;
		}
		return {
			externalId: encodeExternalId({
				drawingId: this.id,
				part: 'body',
			}),
			zOrder: this._options.zOrder,
			distance: bodyHit.distance,
			hitTestPriority: bodyHit.priority,
			cursorStyle: 'pointer',
		};
	}

	public attachedTextTargets(): readonly AttachedTextTarget[] { return this._textTargets; }

	public textTargetAt(point: ScreenPoint): AttachedTextTarget | undefined {
		if (!this.isRenderVisible() || !this._options.showText || this._isPreview) return undefined;
		return this._textTargets.find(target => (!target.placeholder || this._selected) && textTargetContains(target, point));
	}

	public drawAttachedText(target: CanvasRenderingTarget2D): void {
		this._textTargets = [];
		target.useMediaCoordinateSpace(({ context, mediaSize }) => {
			const placements = attachedTextPlacements(this.type, { points: this._screenPoints, anchors: this._points, options: this._options, ...mediaSize, selected: this._selected && !this._isPreview, priceToY: price => this.seriesOrNull()?.priceToCoordinate(price) ?? null });
			this._textTargets = paintAttachedText(context, placements, this._options, mediaSize.width, mediaSize.height);
		});
	}

	public abstract draw(target: CanvasRenderingTarget2D, utils?: DrawingUtils): void;
	protected abstract hitTestBody(point: ScreenPoint, hitSlop?: number): BodyHitResult | null;
}
