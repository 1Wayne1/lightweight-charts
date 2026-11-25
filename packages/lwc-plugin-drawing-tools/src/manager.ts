import { cloneReadonly } from '@tradingview/lwc-toolkit/simple-clone';
import { paneContentElement } from '@tradingview/lwc-toolkit/dom/pane-element';
import { CanvasRenderingTarget2D } from 'fancy-canvas';
import {
	CrosshairMode,
	HandleScaleOptions,
	HandleScrollOptions,
	IChartApi,
	IPrimitivePaneRenderer,
	IPrimitivePaneView,
	ISeriesApi,
	ISeriesPrimitive,
	PrimitiveHoveredItem,
	PrimitivePaneViewZOrder,
	SeriesAttachedParameter,
	SeriesType,
	Time,
} from 'lightweight-charts';
import { BaseDrawing } from './base-drawing';
import {
	anchorToScreen,
	screenToAnchorWithSnap,
	shiftAnchor,
} from './coordinates';
import { snapAngle45 } from './geometry';
import { ExtendedDrawing } from './tools/extended-drawing';
import type { DrawingBar } from './tools/extended-geometry';
import { DrawingHistory } from './history';
import {
	createDrawingInstance,
	getToolDefinition,
	getToolStepHint,
} from './tools/index';
import { buildPositionDefaultAnchors, type PositionToolType } from './tools/position';
import {
	AnchorPoint,
	decodeExternalId,
	DrawingSnapshot,
	DrawingStyleOptions,
	DrawingToolType,
	HitPart,
	MagnetMode,
	ScreenPoint,
	SerializedDrawing,
} from './types';

class MagnetIndicatorPrimitive implements ISeriesPrimitive<Time> {
	private _point: ScreenPoint | null = null;
	private _requestUpdate?: () => void;
	private readonly _paneViews: readonly IPrimitivePaneView[];

	public constructor() {
		const self = this;
		const renderer: IPrimitivePaneRenderer = {
			draw: (target: CanvasRenderingTarget2D) => {
				const pt = self._point;
				if (!pt) return;
				target.useMediaCoordinateSpace(({ context: ctx }) => {
					ctx.save();
					ctx.beginPath();
					ctx.arc(pt.x, pt.y, 8, 0, Math.PI * 2);
					ctx.fillStyle = 'rgba(41, 98, 255, 0.28)';
					ctx.fill();
					ctx.beginPath();
					ctx.arc(pt.x, pt.y, 3.8, 0, Math.PI * 2);
					ctx.fillStyle = '#2962FF';
					ctx.fill();
					ctx.lineWidth = 1.5;
					ctx.strokeStyle = '#FFFFFF';
					ctx.stroke();
					ctx.restore();
				});
			},
		};
		this._paneViews = [
			{
				zOrder: (): PrimitivePaneViewZOrder => 'top',
				renderer: () => renderer,
			},
		];
	}

	public attached(param: SeriesAttachedParameter<Time>): void {
		this._requestUpdate = param.requestUpdate;
	}

	public detached(): void {
		this._requestUpdate = undefined;
	}

	public setPoint(point: ScreenPoint | null): void {
		if (this._point?.x === point?.x && this._point?.y === point?.y) return;
		this._point = point ? { ...point } : null;
		this._requestUpdate?.();
	}

	public paneViews(): readonly IPrimitivePaneView[] {
		return this._paneViews;
	}
}

export interface DrawingManagerOptions {
	/** Converts newly edited logical anchors to the host's canonical time coordinates. */
	normalizeAnchor?: (point: AnchorPoint) => AnchorPoint;
	/** Actual OHLCV rows for analytical drawing tools, supplied by the host. */
	dataSource?: () => readonly DrawingBar[];
	/** Supplies remembered per-tool default style options for newly drawn shapes and previews. */
	defaultOptionsForTool?: (type: DrawingToolType) => Partial<DrawingStyleOptions> | undefined;
	magnetMode?: MagnetMode;
	stayInDrawingMode?: boolean;
	keyboardShortcuts?: boolean;
	maxHistory?: number;
	/**
	 * When true (default), switches the chart's crosshair from Lightweight Charts'
	 * built-in `Magnet` default to `Normal` (free cursor tracking) when magnet is off/weak,
	 * and `MagnetOHLC` when strong magnet is enabled. Restored on `destroy()`.
	 */
	syncCrosshairMagnet?: boolean;
}

export interface DrawingManagerState {
	activeTool: DrawingToolType | null;
	selectedId: string | null;
	selectedDrawing: BaseDrawing | null;
	magnetMode: MagnetMode;
	drawingsVisible: boolean;
	stayInDrawingMode: boolean;
	canUndo: boolean;
	canRedo: boolean;
	count: number;
	draftPointCount: number;
	draftStepHint: string;
	canFinishDraft: boolean;
}

type StateChangeListener = (state: DrawingManagerState) => void;
type TextEditListener = (drawing: BaseDrawing, anchorScreen: ScreenPoint | null) => void;

interface DragSession {
	pointerId: number;
	drawing: BaseDrawing;
	mode: 'anchor' | 'body' | 'handle';
	anchorIndex: number;
	handleId: string;
	handleCursor: string;
	startLogical: number;
	startPrice: number;
	startScreen: ScreenPoint;
	origPoints: AnchorPoint[];
	origOptions: DrawingStyleOptions;
	preDragSnapshot: SerializedDrawing[];
	didMove: boolean;
	clonePending: boolean;
	cloneCreated: boolean;
}

interface SavedChartControls {
	handleScroll: HandleScrollOptions | boolean;
	handleScale: HandleScaleOptions | boolean;
	touchAction: string;
}

interface MiddlePanSession {
	pointerId: number;
	startX: number;
	from: number;
	to: number;
	width: number;
}

let idCounter = 1;
function generateDrawingId(): string {
	return `drw_${Date.now().toString(36)}_${idCounter++}`;
}

function isEditableElement(target: EventTarget | null): boolean {
	if (!target || !(target instanceof HTMLElement)) {
		return false;
	}
	const tag = target.tagName;
	return (
		tag === 'INPUT' ||
		tag === 'TEXTAREA' ||
		tag === 'SELECT' ||
		target.isContentEditable
	);
}

export class DrawingManager {
	private readonly _chart: IChartApi;
	private readonly _options: DrawingManagerOptions;
	private readonly _series: ISeriesApi<SeriesType>;
	private readonly _history: DrawingHistory;
	private readonly _keyboardEnabled: boolean;
	private readonly _syncCrosshairMagnet: boolean;
	private readonly _originalCrosshairMode: CrosshairMode;

	private _drawings: BaseDrawing[] = [];
	private _drawingMap: Map<string, BaseDrawing> = new Map();

	private _activeTool: DrawingToolType | null = null;
	private _selectedId: string | null = null;
	private _hoveredId: string | null = null;
	private _hoveredCursor: string = '';
	private _magnetMode: MagnetMode;
	private _drawingsVisible: boolean = true;
	private _stayInDrawingMode: boolean;

	private _draftPoints: AnchorPoint[] = [];
	private _draftAddMeta: Array<{ x: number; y: number; ts: number }> = [];
	private _previewDrawing: BaseDrawing | null = null;
	private _lastCursorAnchor: AnchorPoint | null = null;

	private _drag: DragSession | null = null;
	private _savedControls: SavedChartControls | null = null;
	private _spacePressed: boolean = false;
	private _spacePanPointerId: number | null = null;
	private _middlePan: MiddlePanSession | null = null;
	private _creationPointerId: number | null = null;
	private _creationDownScreen: ScreenPoint | null = null;
	private _creationDragged: boolean = false;
	private _creationLastAnchor: AnchorPoint | null = null;
	private readonly _magnetIndicator: MagnetIndicatorPrimitive = new MagnetIndicatorPrimitive();

	private readonly _stateListeners: Set<StateChangeListener> = new Set();
	private readonly _textEditListeners: Set<TextEditListener> = new Set();
	private readonly _unsubscribers: Array<() => void> = [];
	private _destroyed: boolean = false;

	public constructor(
		chart: IChartApi,
		series: ISeriesApi<SeriesType>,
		options: DrawingManagerOptions = {}
	) {
		this._chart = chart;
		this._options = options;
		this._series = series;
		this._magnetMode = options.magnetMode ?? 'off';
		this._stayInDrawingMode = options.stayInDrawingMode ?? false;
		this._keyboardEnabled = options.keyboardShortcuts ?? true;
		this._syncCrosshairMagnet = options.syncCrosshairMagnet ?? true;
		this._originalCrosshairMode = this._chart.options().crosshair.mode;
		this._history = new DrawingHistory(options.maxHistory ?? 100);

		this._series.attachPrimitive(this._magnetIndicator);
		this._applyCrosshairForMagnetMode();
		this._bindEvents();
	}

	public chart(): IChartApi {
		return this._chart;
	}

	public series(): ISeriesApi<SeriesType> {
		return this._series;
	}

	public getState(): DrawingManagerState {
		const def = this._activeTool ? getToolDefinition(this._activeTool) : null;
		const draftPointCount = this._draftPoints.length;
		const draftStepHint = this._activeTool
			? (this._previewDrawing?.previewStepLabel(draftPointCount) ??
				getToolStepHint(this._activeTool, draftPointCount, this._toolDefaultOptions(this._activeTool)))
			: '';
		const canFinishDraft = Boolean(
			def && def.creation === 'path' && draftPointCount >= (def.pointCount || 2)
		);
		return {
			activeTool: this._activeTool,
			selectedId: this._selectedId,
			selectedDrawing: this.selectedDrawing(),
			magnetMode: this._magnetMode,
			drawingsVisible: this._drawingsVisible,
			stayInDrawingMode: this._stayInDrawingMode,
			canUndo: this._history.canUndo(),
			canRedo: this._history.canRedo(),
			count: this._drawings.length,
			draftPointCount,
			draftStepHint,
			canFinishDraft,
		};
	}

	public subscribeStateChange(listener: StateChangeListener): () => void {
		this._stateListeners.add(listener);
		listener(this.getState());
		return () => {
			this._stateListeners.delete(listener);
		};
	}

	public subscribeTextEdit(listener: TextEditListener): () => void {
		this._textEditListeners.add(listener);
		return () => {
			this._textEditListeners.delete(listener);
		};
	}

	public activeTool(): DrawingToolType | null {
		return this._activeTool;
	}

	public setActiveTool(tool: DrawingToolType | null): void {
		if (this._activeTool === tool) return;
		this._cancelDraft();
		this._activeTool = tool;
		if (tool) {
			this._suspendPanForTool();
			this._setSelectedInternal(null);
		} else {
			this._restoreControls();
			this._magnetIndicator.setPoint(null);
		}
		this._updatePaneCursor();
		this._emitState();
	}

	public selectedDrawing(): BaseDrawing | null {
		return this._selectedId ? (this._drawingMap.get(this._selectedId) ?? null) : null;
	}

	public selectDrawing(id: string | null): void {
		if (this._selectedId === id) return;
		this._setSelectedInternal(id);
		this._emitState();
	}

	public drawings(): readonly BaseDrawing[] {
		return this._drawings;
	}

	public getDrawing(id: string): BaseDrawing | null {
		return this._drawingMap.get(id) ?? null;
	}

	/** Resolve an object at viewport coordinates for host settings and context menus. */
	public drawingAt(clientX: number, clientY: number): BaseDrawing | null {
		const point = this._panePoint(clientX, clientY);
		return point ? this._hitTestAll(point.x, point.y)?.drawing ?? null : null;
	}

	/** Convert pane-local note geometry for the host's inline editor. */
	public textTargetAt(clientX: number, clientY: number) {
		const point = this._panePoint(clientX, clientY);
		const drawing = point ? this._hitTestAll(point.x, point.y)?.drawing : null;
		const target = drawing && point ? drawing.textTargetAt(point) : undefined;
		return drawing && target ? { drawing, target } : null;
	}

	public paneToClient(point: ScreenPoint): ScreenPoint {
		const box = paneContentElement(this._series.getPane())?.getBoundingClientRect();
		return { x: point.x + (box?.left ?? 0), y: point.y + (box?.top ?? 0) };
	}

	public magnetMode(): MagnetMode {
		return this._magnetMode;
	}

	public setMagnetMode(mode: MagnetMode): void {
		if (this._magnetMode === mode) return;
		this._magnetMode = mode;
		this._applyCrosshairForMagnetMode();
		this._emitState();
	}

	public cycleMagnetMode(): MagnetMode {
		const next: MagnetMode =
			this._magnetMode === 'off'
				? 'weak'
				: this._magnetMode === 'weak'
					? 'strong'
					: 'off';
		this.setMagnetMode(next);
		return next;
	}

	public drawingsVisible(): boolean {
		return this._drawingsVisible;
	}

	public setDrawingsVisible(visible: boolean): void {
		if (this._drawingsVisible === visible) return;
		this._drawingsVisible = visible;
		for (const drawing of this._drawings) {
			drawing.setGlobalVisible(visible);
		}
		if (!visible) {
			this._setSelectedInternal(null);
			this._hoveredId = null;
			this._updatePaneCursor();
		}
		this._emitState();
	}

	public stayInDrawingMode(): boolean {
		return this._stayInDrawingMode;
	}

	public setStayInDrawingMode(stay: boolean): void {
		if (this._stayInDrawingMode === stay) return;
		this._stayInDrawingMode = stay;
		this._emitState();
	}

	public addDrawing(
		type: DrawingToolType,
		points: AnchorPoint[],
		options: Partial<DrawingStyleOptions> = {},
		recordHistory: boolean = true
	): BaseDrawing {
		if (recordHistory) {
			this._history.push(this._serializeList());
		}
		const mergedOptions: Partial<DrawingStyleOptions> = {
			...this._toolDefaultOptions(type),
			...options,
		};
		const data: SerializedDrawing = {
			id: generateDrawingId(),
			type,
			points: points.map(p => this._normalize(p)),
			options: mergedOptions,
		};
		if (type === 'anchored-text') {
			const point = anchorToScreen(this._chart, this._series, data.points[0]);
			if (point) Object.assign(data.options, { anchorX: point.x / this._chart.timeScale().width(), anchorY: point.y / this._series.getPane().getHeight() });
		}
		const drawing = this._createInstance(data);
		drawing.setGlobalVisible(this._drawingsVisible);
		this._drawings.push(drawing);
		this._drawingMap.set(drawing.id, drawing);
		this._series.attachPrimitive(drawing);
		drawing.updateAllViews();
		this._emitState();
		return drawing;
	}

	public updateDrawingOptions(
		id: string,
		options: Partial<DrawingStyleOptions>,
		recordHistory: boolean = true
	): void {
		this.updateDrawing(id, { options }, recordHistory);
	}

	/** Commit a settings form, including anchors, as a single undoable edit. */
	public updateDrawing(
		id: string,
		patch: { options?: Partial<DrawingStyleOptions>; points?: readonly AnchorPoint[] },
		recordHistory: boolean = true
	): void {
		const drawing = this._drawingMap.get(id);
		if (!drawing) return;
		if (recordHistory) {
			this._history.push(this._serializeList());
		}
		if (patch.points) drawing.setPoints(patch.points.map(point => this._normalize(point)));
		if (patch.options) drawing.applyOptions(patch.options);
		this._emitState();
	}

	/** Clone an existing drawing with an optional logical/price offset as one undoable edit. */
	public cloneDrawing(
		id: string,
		deltaLogical: number = 2,
		deltaPrice: number = 0
	): BaseDrawing | null {
		const source = this._drawingMap.get(id);
		if (!source) return null;
		const serialized = source.serialize();
		const shifted = serialized.points.map(pt =>
			shiftAnchor(this._chart, pt, deltaLogical, deltaPrice)
		);
		const cloned = this.addDrawing(
			serialized.type,
			shifted,
			{ ...serialized.options, locked: false, visible: true },
			true
		);
		this._setSelectedInternal(cloned.id);
		this._emitState();
		return cloned;
	}

	/** Atomically replace a drawing's tool type and anchors while preserving ID and recording one undo step. */
	public replaceDrawing(
		id: string,
		nextType: DrawingToolType,
		nextPoints: readonly AnchorPoint[],
		nextOptions: Partial<DrawingStyleOptions> = {},
		recordHistory: boolean = true
	): BaseDrawing | null {
		const index = this._drawings.findIndex(d => d.id === id);
		if (index < 0) return null;
		const existing = this._drawings[index];
		if (recordHistory) {
			this._history.push(this._serializeList());
		}
		const prevSerialized = existing.serialize();
		const mergedOptions: Partial<DrawingStyleOptions> = {
			...prevSerialized.options,
			...nextOptions,
		};
		const replacement = this._createInstance({
			id,
			type: nextType,
			points: nextPoints.map(p => this._normalize(p)),
			options: mergedOptions,
		});
		replacement.setGlobalVisible(this._drawingsVisible);
		this._series.detachPrimitive(existing);
		this._drawings[index] = replacement;
		this._drawingMap.set(id, replacement);
		this._series.attachPrimitive(replacement);
		if (this._selectedId === id) {
			replacement.setSelected(true);
		}
		replacement.updateAllViews();
		this._emitState();
		return replacement;
	}

	/** Step backward by one draft point during multi-point or path creation. */
	public undoDraftPoint(): boolean {
		if (!this._activeTool || this._draftPoints.length === 0) return false;
		if (this._draftPoints.length === 1) {
			this._cancelDraft();
			this._emitState();
			return true;
		}
		this._draftPoints.pop();
		this._draftAddMeta.pop();
		const cursor = this._lastCursorAnchor ?? this._draftPoints[this._draftPoints.length - 1];
		this._updateDraftPreview(cursor);
		this._emitState();
		return true;
	}

	public removeDrawing(id: string, recordHistory: boolean = true): boolean {
		const drawing = this._drawingMap.get(id);
		if (!drawing) return false;
		if (recordHistory) {
			this._history.push(this._serializeList());
		}
		this._series.detachPrimitive(drawing);
		this._drawingMap.delete(id);
		this._drawings = this._drawings.filter(d => d.id !== id);
		if (this._selectedId === id) {
			this._selectedId = null;
		}
		if (this._hoveredId === id) {
			this._hoveredId = null;
			this._updatePaneCursor();
		}
		this._emitState();
		return true;
	}

	public clearAll(recordHistory: boolean = true): void {
		if (this._drawings.length === 0) return;
		if (recordHistory) {
			this._history.push(this._serializeList());
		}
		this._cancelDraft();
		this._detachAllInternal();
		this._selectedId = null;
		this._hoveredId = null;
		this._updatePaneCursor();
		this._emitState();
	}

	public canUndo(): boolean {
		return this._history.canUndo();
	}

	public canRedo(): boolean {
		return this._history.canRedo();
	}

	public undo(): boolean {
		const prev = this._history.undo(this._serializeList());
		if (!prev) return false;
		this._cancelDraft();
		this._restoreList(prev);
		this._emitState();
		return true;
	}

	public redo(): boolean {
		const next = this._history.redo(this._serializeList());
		if (!next) return false;
		this._cancelDraft();
		this._restoreList(next);
		this._emitState();
		return true;
	}

	public exportState(): DrawingSnapshot {
		return {
			version: 1,
			drawings: this._serializeList(),
		};
	}

	public importState(
		input: DrawingSnapshot | readonly SerializedDrawing[],
		recordHistory: boolean = true
	): void {
		const list = Array.isArray(input) ? input : (input as DrawingSnapshot).drawings;
		if (!Array.isArray(list)) {
			throw new Error('Invalid drawing snapshot format.');
		}
		if (recordHistory) {
			this._history.push(this._serializeList());
		}
		this._cancelDraft();
		this._restoreList(list);
		this._emitState();
	}

	public requestTextEdit(id: string): void {
		const drawing = this._drawingMap.get(id);
		if (!drawing || !getToolDefinition(drawing.type).capabilities.hasText) return;
		const pt = drawing.points()[0];
		const sp = pt ? anchorToScreen(this._chart, this._series, pt) : null;
		for (const listener of this._textEditListeners) {
			listener(drawing, sp);
		}
	}

	public destroy(): void {
		if (this._destroyed) return;
		this._destroyed = true;
		this._endDrag(false);
		this._cancelDraft();
		this._restoreControls();
		this._series.detachPrimitive(this._magnetIndicator);
		if (this._syncCrosshairMagnet) {
			this._chart.applyOptions({
				crosshair: { mode: this._originalCrosshairMode },
			});
		}
		this._detachAllInternal();
		for (const unsub of this._unsubscribers) {
			unsub();
		}
		this._unsubscribers.length = 0;
		this._stateListeners.clear();
		this._textEditListeners.clear();
	}

	private _normalize(point: AnchorPoint): AnchorPoint { return this._options.normalizeAnchor?.(point) ?? { ...point }; }

	private _toolDefaultOptions(type: DrawingToolType): Partial<DrawingStyleOptions> {
		const inherited = this._options.defaultOptionsForTool?.(type);
		if (!inherited) return {};
		return {
			...inherited,
			...(inherited.fibLevels ? { fibLevels: inherited.fibLevels.map(level => ({ ...level })) } : {}),
		};
	}

	private _createInstance(data: SerializedDrawing): BaseDrawing {
		const drawing = createDrawingInstance(data);
		if (drawing instanceof ExtendedDrawing && this._options.dataSource) drawing.setDataSource(this._options.dataSource);
		return drawing;
	}

	/** Finish path/freehand creation. Paths can also be completed with Enter or a double click. */
	public finishDrawing(): void {
		if (!this._activeTool) return;
		const definition = getToolDefinition(this._activeTool);
		if (this._draftPoints.length < (definition.pointCount || 2)) return;
		const type = this._activeTool;
		const points =
			definition.creation === 'instant-box'
				? [...this._draftPoints]
				: this._draftPoints.filter((point, i, list) => i === 0 || point.logical !== list[i - 1].logical || point.price !== list[i - 1].price);
		if (points.length < (definition.pointCount || 2)) return;
		this._cancelDraft();
		const created = this.addDrawing(type, points);
		this._setSelectedInternal(created.id);
		if (!this._stayInDrawingMode) {
			this._activeTool = null;
			this._restoreControls();
		} else {
			this._suspendPanForTool();
		}
		this._updatePaneCursor();
		this._emitState();
		if (definition.capabilities.hasText) this.requestTextEdit(created.id);
	}

	/** Finish edits against the old time scale before the host replaces its market data. */
	public prepareDataChange(): void { this._endDrag(true); this._cancelDraft(); }

	/** Reproject current drawings AND history after a history prepend. No persistence change. */
	public reprojectAnchors(map: (point: AnchorPoint) => AnchorPoint): void {
		for (const drawing of this._drawings) drawing.setPoints(drawing.points().map(map));
		this._history.mapPoints(map);
	}

	public refreshData(): void {
		for (const drawing of this._drawings) drawing.setPoints([...drawing.points()]);
	}

	private _serializeList(): SerializedDrawing[] {
		return this._drawings.map(d => d.serialize());
	}

	private _detachAllInternal(): void {
		for (const drawing of this._drawings) {
			this._series.detachPrimitive(drawing);
		}
		this._drawings = [];
		this._drawingMap.clear();
	}

	private _restoreList(list: readonly SerializedDrawing[]): void {
		const prevSelected = this._selectedId;
		this._detachAllInternal();
		for (const item of list) {
			const drawing = this._createInstance(item);
			drawing.setGlobalVisible(this._drawingsVisible);
			this._drawings.push(drawing);
			this._drawingMap.set(drawing.id, drawing);
			this._series.attachPrimitive(drawing);
			drawing.updateAllViews();
		}
		this._setSelectedInternal(
			prevSelected && this._drawingMap.has(prevSelected) ? prevSelected : null
		);
	}

	private _setSelectedInternal(id: string | null): void {
		if (this._selectedId !== null) {
			this._drawingMap.get(this._selectedId)?.setSelected(false);
		}
		this._selectedId = id;
		if (id !== null) {
			this._drawingMap.get(id)?.setSelected(true);
		}
	}

	private _emitState(): void {
		const state = this.getState();
		for (const listener of this._stateListeners) {
			listener(state);
		}
	}

	private _bindEvents(): void {
		const chartEl = this._chart.chartElement();
		const addEl = <K extends keyof HTMLElementEventMap>(
			el: HTMLElement,
			type: K,
			handler: (ev: HTMLElementEventMap[K]) => void,
			capture: boolean = false
		): void => {
			el.addEventListener(type, handler, capture);
			this._unsubscribers.push(() => el.removeEventListener(type, handler, capture));
		};

		// Capture pointerdown on chart element so we can suspend chart pan cleanly before chart handles it
		addEl(chartEl, 'pointerdown', this._onPointerDown, true);
		addEl(chartEl, 'dblclick', this._onDoubleClick, false);
		addEl(chartEl, 'contextmenu', this._onContextMenu, true);
		const onPointerLeave = () => {
			this._magnetIndicator.setPoint(null);
			if (this._drag || this._creationPointerId !== null) return;
			for (const d of this._drawings) {
				d.setHoverState(false, null, null);
			}
			if (this._hoveredId !== null || this._hoveredCursor !== '') {
				this._hoveredId = null;
				this._hoveredCursor = '';
				this._updatePaneCursor();
			}
		};
		addEl(chartEl, 'pointerleave', onPointerLeave, false);
		const onMouseDown = (ev: MouseEvent) => {
			if (this._activeTool !== null && ev.button === 1) ev.preventDefault();
		};
		addEl(chartEl, 'mousedown', onMouseDown, true);

		// On iOS Safari, changing touch-action inside pointerdown does not take effect for the in-flight gesture.
		// Prevent default single-finger touchmove only while actively dragging a drawing or aiming a creation anchor.
		const onTouchMove = (ev: TouchEvent) => {
			if ((this._drag !== null || this._creationPointerId !== null) && ev.touches.length === 1 && ev.cancelable) {
				ev.preventDefault();
			}
		};
		chartEl.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
		this._unsubscribers.push(() => chartEl.removeEventListener('touchmove', onTouchMove, { capture: true }));

		const onMove = (ev: PointerEvent) => this._onPointerMove(ev);
		const onUp = (ev: PointerEvent) => this._onPointerUp(ev);
		const onBlur = () => {
			if (this._spacePressed) {
				this._spacePressed = false;
				this._updatePaneCursor();
			}
			this._magnetIndicator.setPoint(null);
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onUp);
		window.addEventListener('blur', onBlur);
		this._unsubscribers.push(() => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onUp);
			window.removeEventListener('blur', onBlur);
		});

		if (this._keyboardEnabled) {
			const onKeyDown = (ev: KeyboardEvent) => this._onKeyDown(ev);
			const onKeyUp = (ev: KeyboardEvent) => this._onKeyUp(ev);
			window.addEventListener('keydown', onKeyDown);
			window.addEventListener('keyup', onKeyUp);
			this._unsubscribers.push(() => {
				window.removeEventListener('keydown', onKeyDown);
				window.removeEventListener('keyup', onKeyUp);
			});
		}
	}

	private _capturePointer(pointerId: number): void {
		try {
			this._chart.chartElement().setPointerCapture?.(pointerId);
		} catch {
			// Safari may reject pointer capture on synthetic or ended touch pointers.
		}
	}

	private _releasePointer(pointerId: number): void {
		try {
			const element = this._chart.chartElement();
			if (element.hasPointerCapture?.(pointerId)) {
				element.releasePointerCapture(pointerId);
			}
		} catch {
			// Ignore if capture was already released.
		}
	}

	private _panePointClamped(clientX: number, clientY: number): ScreenPoint | null {
		const paneEl = paneContentElement(this._series.getPane());
		if (!paneEl) return null;
		const box = paneEl.getBoundingClientRect();
		if (box.width <= 0 || box.height <= 0) return null;
		return {
			x: Math.max(0, Math.min(box.width, clientX - box.left)),
			y: Math.max(0, Math.min(box.height, clientY - box.top)),
		};
	}

	private _panePoint(clientX: number, clientY: number): ScreenPoint | null {
		const paneEl = paneContentElement(this._series.getPane());
		if (!paneEl) return null;
		const box = paneEl.getBoundingClientRect();
		const x = clientX - box.left;
		const y = clientY - box.top;
		if (x < 0 || x > box.width || y < 0 || y > box.height) {
			return null;
		}
		return { x, y };
	}

	private _panePointUnclamped(clientX: number, clientY: number): ScreenPoint | null {
		const paneEl = paneContentElement(this._series.getPane());
		if (!paneEl) return null;
		const box = paneEl.getBoundingClientRect();
		return {
			x: clientX - box.left,
			y: clientY - box.top,
		};
	}

	private _captureSavedControls(): SavedChartControls {
		if (this._savedControls !== null) {
			return this._savedControls;
		}
		const { handleScroll: scroll, handleScale: scale } = this._chart.options();
		const pane = paneContentElement(this._series.getPane());
		this._savedControls = {
			handleScroll: typeof scroll === 'boolean' ? scroll : cloneReadonly(scroll),
			handleScale: typeof scale === 'boolean' ? scale : cloneReadonly(scale),
			touchAction: pane?.style.touchAction ?? '',
		};
		return this._savedControls;
	}

	private _suspendPanForTool(): void {
		const saved = this._captureSavedControls();
		const pane = paneContentElement(this._series.getPane());
		if (pane) pane.style.touchAction = 'none';
		const toolScroll: HandleScrollOptions | boolean =
			saved.handleScroll === false
				? false
				: saved.handleScroll === true
					? {
						mouseWheel: true,
						pressedMouseMove: false,
						horzTouchDrag: false,
						vertTouchDrag: false,
					}
					: {
						...saved.handleScroll,
						mouseWheel: saved.handleScroll.mouseWheel ?? true,
						pressedMouseMove: false,
						horzTouchDrag: false,
						vertTouchDrag: false,
					};
		this._chart.applyOptions({
			handleScroll: toolScroll,
			handleScale: saved.handleScale,
		});
	}

	private _suspendAllControls(): void {
		this._captureSavedControls();
		const pane = paneContentElement(this._series.getPane());
		if (pane) pane.style.touchAction = 'none';
		this._chart.applyOptions({ handleScroll: false, handleScale: false });
	}

	private _restoreControls(): void {
		if (this._savedControls === null) return;
		const saved = this._savedControls;
		this._savedControls = null;
		const pane = paneContentElement(this._series.getPane());
		if (pane) pane.style.touchAction = saved.touchAction;
		this._chart.applyOptions({
			handleScroll: saved.handleScroll,
			handleScale: saved.handleScale,
		});
	}

	private _effectiveMagnet(modifierHeld: boolean): MagnetMode {
		return this._magnetMode === 'off' && modifierHeld ? 'weak' : this._magnetMode;
	}

	private _applyCrosshairForMagnetMode(): void {
		if (!this._syncCrosshairMagnet) return;
		if (this._originalCrosshairMode === CrosshairMode.Hidden) return;
		const nextMode =
			this._magnetMode === 'strong'
				? CrosshairMode.MagnetOHLC
				: CrosshairMode.Normal;
		this._chart.applyOptions({
			crosshair: { mode: nextMode },
		});
	}

	private _updatePaneCursor(): void {
		const paneEl = paneContentElement(this._series.getPane());
		if (!paneEl) return;
		if (this._spacePanPointerId !== null || this._middlePan !== null) {
			paneEl.style.cursor = 'grabbing';
		} else if (this._activeTool !== null && this._spacePressed) {
			paneEl.style.cursor = 'grab';
		} else if (this._activeTool !== null) {
			paneEl.style.cursor = 'crosshair';
		} else if (this._drag !== null && this._drag.didMove) {
			paneEl.style.cursor = this._drag.mode === 'handle' || this._drag.mode === 'anchor'
				? (this._drag.handleCursor || 'pointer')
				: 'grabbing';
		} else if (this._hoveredId !== null) {
			paneEl.style.cursor = this._hoveredCursor || 'pointer';
		} else {
			paneEl.style.cursor = '';
		}
	}

	private _hitTestAll(
		x: number,
		y: number,
		hitSlop: number = 0
	): { drawing: BaseDrawing; hit: HitPart; item: PrimitiveHoveredItem } | null {
		if (!this._drawingsVisible) return null;

		let winner: {
			drawing: BaseDrawing;
			hit: HitPart;
			item: PrimitiveHoveredItem;
			priority: number;
			distance: number;
		} | null = null;

		// Iterate from top-most (most recently created) to bottom
		for (let i = this._drawings.length - 1; i >= 0; i--) {
			const drawing = this._drawings[i];
			const item = drawing.hitTest(x, y, hitSlop);
			if (!item) continue;
			const hit = decodeExternalId(item.externalId);
			if (!hit) continue;

			const priority = item.hitTestPriority ?? 0;
			const distance = item.distance ?? 0;
			if (
				!winner ||
				priority > winner.priority ||
				(priority === winner.priority && distance < winner.distance)
			) {
				winner = { drawing, hit, item, priority, distance };
			}
		}

		return winner
			? { drawing: winner.drawing, hit: winner.hit, item: winner.item }
			: null;
	}

	private _resolveScreenWithShift(
		rawPoint: ScreenPoint,
		shiftKey: boolean,
		originAnchor: AnchorPoint | null
	): ScreenPoint {
		if (!shiftKey || !originAnchor) {
			return rawPoint;
		}
		const originScreen = anchorToScreen(this._chart, this._series, originAnchor);
		if (!originScreen) {
			return rawPoint;
		}
		return snapAngle45(originScreen, rawPoint);
	}

	private _onPointerDown = (event: PointerEvent): void => {
		if (!event.isPrimary) {
			// A second finger arrived (e.g., pinch-zoom): abort any unmoved drag or in-flight creation stroke.
			if (this._drag && !this._drag.didMove) {
				this._releasePointer(this._drag.pointerId);
				this._endDrag(false);
			}
			if (this._creationPointerId !== null) {
				this._releasePointer(this._creationPointerId);
				this._cancelDraft();
				this._emitState();
			}
			return;
		}
		if (this._activeTool !== null && event.button === 1) {
			const timeScale = this._chart.timeScale();
			const range = typeof timeScale.getVisibleLogicalRange === 'function' ? timeScale.getVisibleLogicalRange() : null;
			if (range && range.to > range.from) {
				event.preventDefault();
				this._middlePan = {
					pointerId: event.pointerId,
					startX: event.clientX,
					from: range.from,
					to: range.to,
					width: Math.max(1, timeScale.width()),
				};
				this._capturePointer(event.pointerId);
				this._updatePaneCursor();
			}
			return;
		}
		if (event.button !== 0) return;
		if (this._activeTool !== null && this._spacePressed) {
			this._spacePanPointerId = event.pointerId;
			this._restoreControls();
			this._updatePaneCursor();
			return;
		}
		const pt = this._panePoint(event.clientX, event.clientY);
		if (!pt) return;

		// Mode 1: Active creation tool
		if (this._activeTool !== null) {
			const def = getToolDefinition(this._activeTool);
			const originAnchor =
				this._draftPoints.length > 0 && def.pointCount >= 2
					? this._draftPoints[this._draftPoints.length - 1]
					: null;
			let snappedPt = this._resolveScreenWithShift(pt, event.shiftKey, originAnchor);
			if (this._activeTool === 'gann-square-fixed' && originAnchor) {
				const origin = anchorToScreen(this._chart, this._series, originAnchor);
				if (origin) { const size = Math.max(Math.abs(pt.x - origin.x), Math.abs(pt.y - origin.y)); snappedPt = { x: origin.x + Math.sign(pt.x - origin.x) * size, y: origin.y + Math.sign(pt.y - origin.y) * size }; }
			}
			const effMagnet = this._effectiveMagnet(event.ctrlKey || event.metaKey);
			const snapRes = screenToAnchorWithSnap(
				this._chart,
				this._series,
				snappedPt.x,
				snappedPt.y,
				effMagnet
			);
			if (!snapRes) return;
			this._magnetIndicator.setPoint(snapRes.snapped ? (snapRes.snapScreen ?? null) : null);

			if (this._draftPoints.length >= 2000) return;
			const normalized = this._normalize(snapRes.anchor);
			this._lastCursorAnchor = normalized;
			this._creationPointerId = event.pointerId;
			this._creationDownScreen = pt;
			this._creationDragged = false;
			this._creationLastAnchor = normalized;
			this._capturePointer(event.pointerId);
			this._suspendAllControls();

			if (def.creation === 'instant-box') {
				this._draftPoints = buildPositionDefaultAnchors(
					this._activeTool as PositionToolType,
					normalized,
					this._chart,
					this._series,
					p => this._normalize(p)
				);
				this._draftAddMeta = [];
				this._updateDraftPreview(normalized);
				this._emitState();
				return;
			}

			this._draftPoints.push(normalized);
			this._draftAddMeta.push({ x: pt.x, y: pt.y, ts: Date.now() });
			this._updateDraftPreview(normalized);
			this._emitState();
			return;
		}

		// Mode 2: Cursor selection & drag
		const hitSlop = event.pointerType === 'touch' ? 14 : 0;
		const best = this._hitTestAll(pt.x, pt.y, hitSlop);
		if (!best) {
			if (this._selectedId !== null) {
				this.selectDrawing(null);
			}
			return;
		}

		const { drawing, hit } = best;
		this._setSelectedInternal(drawing.id);
		this._emitState();

		if (drawing.options().locked) {
			return;
		}

		const startLogical = this._chart.timeScale().coordinateToLogical(pt.x);
		const startPrice = this._series.coordinateToPrice(pt.y);
		if (startLogical === null || startPrice === null) {
			return;
		}

		const handleId = hit.handleId ?? (hit.anchorIndex !== undefined ? String(hit.anchorIndex) : '');
		if (hit.part === 'anchor' || hit.part === 'handle') {
			drawing.setActiveHandle(handleId);
		}
		this._suspendAllControls();
		this._capturePointer(event.pointerId);
		this._drag = {
			pointerId: event.pointerId,
			drawing,
			mode: hit.part,
			anchorIndex: hit.anchorIndex ?? 0,
			handleId,
			handleCursor: best.item.cursorStyle ?? 'pointer',
			startLogical,
			startPrice,
			startScreen: pt,
			origOptions: { ...drawing.options() },
			origPoints: drawing.points().map(p => ({ ...p })),
			preDragSnapshot: this._serializeList(),
			didMove: false,
			clonePending: hit.part === 'body' && (event.ctrlKey || event.metaKey),
			cloneCreated: false,
		};
	};

	private _onPointerMove(event: PointerEvent): void {
		if (this._middlePan && event.pointerId === this._middlePan.pointerId) {
			const dx = event.clientX - this._middlePan.startX;
			const shift = (-dx / this._middlePan.width) * (this._middlePan.to - this._middlePan.from);
			this._chart.timeScale().setVisibleLogicalRange({
				from: this._middlePan.from + shift,
				to: this._middlePan.to + shift,
			});
			return;
		}

		if (this._spacePanPointerId !== null && event.pointerId === this._spacePanPointerId) {
			return;
		}

		// 1. Active drag gesture
		if (this._drag && event.pointerId === this._drag.pointerId) {
			const pt = this._panePointUnclamped(event.clientX, event.clientY);
			if (!pt) return;

			const { drawing, mode, anchorIndex, handleId, startLogical, startPrice, origPoints, origOptions } =
				this._drag;

			if (mode === 'anchor' || mode === 'handle') {
				const refIdx = anchorIndex === 0 ? 1 : anchorIndex - 1;
				const originAnchor =
					mode === 'anchor' && origPoints.length >= 2 && refIdx < origPoints.length
						? drawing.points()[refIdx]
						: null;
				const snappedPt = this._resolveScreenWithShift(
					pt,
					event.shiftKey,
					originAnchor
				);
				const effMagnet = this._effectiveMagnet(event.ctrlKey || event.metaKey);
				const snapRes = screenToAnchorWithSnap(
					this._chart,
					this._series,
					snappedPt.x,
					snappedPt.y,
					effMagnet
				);
				this._magnetIndicator.setPoint(snapRes?.snapped ? (snapRes.snapScreen ?? null) : null);
				if (snapRes) {
					const normalized = this._normalize(snapRes.anchor);
					const updated = drawing.applyHandleDrag(handleId, normalized, origPoints, event.shiftKey);
					if (updated) {
						drawing.setPoints(updated.map(p => this._normalize(p)));
					} else if (mode === 'anchor') {
						drawing.setPoint(anchorIndex, normalized);
					}
					if (!this._drag.didMove) {
						this._drag.didMove = true;
						this._updatePaneCursor();
					}
				}
			} else {
				this._magnetIndicator.setPoint(null);
				if (this._drag.clonePending) {
					if (Math.hypot(pt.x - this._drag.startScreen.x, pt.y - this._drag.startScreen.y) < 3) {
						return;
					}
					this._drag.clonePending = false;
					const cloned = this.addDrawing(
						drawing.type,
						origPoints,
						{ ...origOptions, locked: false, visible: true },
						false
					);
					this._setSelectedInternal(cloned.id);
					this._drag.drawing = cloned;
					this._drag.cloneCreated = true;
					this._emitState();
				}
				const targetDrawing = this._drag.drawing;
				const curLogical = this._chart.timeScale().coordinateToLogical(pt.x);
				const curPrice = this._series.coordinateToPrice(pt.y);
				if (curLogical !== null && curPrice !== null) {
					const deltaLogical = curLogical - startLogical;
					const deltaPrice = curPrice - startPrice;
					if (Math.abs(deltaLogical) > 1e-6 || Math.abs(deltaPrice) > 1e-9) {
						const shifted = origPoints.map(orig =>
							shiftAnchor(this._chart, orig, deltaLogical, deltaPrice)
						);
						targetDrawing.setPoints(shifted.map(point => this._normalize(point)));
						if (targetDrawing.type === 'anchored-text') {
							const point = anchorToScreen(this._chart, this._series, targetDrawing.points()[0]);
							if (point) targetDrawing.applyOptions({ anchorX: point.x / this._chart.timeScale().width(), anchorY: point.y / this._series.getPane().getHeight() });
						}
						if (!this._drag.didMove) {
							this._drag.didMove = true;
							this._updatePaneCursor();
						}
					}
				}
			}
			return;
		}

		// 2. Live creation preview
		if (this._activeTool !== null && this._draftPoints.length > 0) {
			const isActiveStroke = this._creationPointerId !== null && event.pointerId === this._creationPointerId;
			const pt = isActiveStroke
				? this._panePointClamped(event.clientX, event.clientY)
				: this._panePoint(event.clientX, event.clientY);
			if (!pt) return;
			const definition = getToolDefinition(this._activeTool);
			const originAnchor =
				isActiveStroke && definition.pointCount > 0 && this._draftPoints.length >= definition.pointCount
					? (this._draftPoints.length >= 2 ? this._draftPoints[this._draftPoints.length - 2] : null)
					: this._draftPoints[this._draftPoints.length - 1];
			const snappedPt = this._resolveScreenWithShift(pt, event.shiftKey, originAnchor);
			const effMagnet = this._effectiveMagnet(event.ctrlKey || event.metaKey);
			const snapRes = screenToAnchorWithSnap(
				this._chart,
				this._series,
				snappedPt.x,
				snappedPt.y,
				effMagnet
			);
			this._magnetIndicator.setPoint(snapRes?.snapped ? (snapRes.snapScreen ?? null) : null);
			if (snapRes) {
				const normalized = this._normalize(snapRes.anchor);
				this._lastCursorAnchor = normalized;
				if (definition.creation === 'instant-box' && isActiveStroke && this._draftPoints.length >= 3) {
					const deltaLogical = normalized.logical - this._draftPoints[0].logical;
					const deltaPrice = normalized.price - this._draftPoints[0].price;
					if (Math.abs(deltaLogical) > 1e-6 || Math.abs(deltaPrice) > 1e-9) {
						this._draftPoints = this._draftPoints.map(p =>
							this._normalize(shiftAnchor(this._chart, p, deltaLogical, deltaPrice))
						);
					}
				} else if (definition.creation === 'freehand') {
					if (!isActiveStroke || this._draftPoints.length >= 2000) return;
					const last = anchorToScreen(this._chart, this._series, this._draftPoints[this._draftPoints.length - 1]);
					if (last && Math.hypot(pt.x - last.x, pt.y - last.y) < 3) return;
					this._draftPoints.push(normalized);
				} else if (isActiveStroke && definition.pointCount > 0 && this._draftPoints.length >= definition.pointCount) {
					// Allow press-and-slide aiming of the final anchor (e.g., horizontal line price or trend line end).
					this._draftPoints[this._draftPoints.length - 1] = normalized;
				} else if (isActiveStroke && definition.pointCount === 2 && this._draftPoints.length === 1) {
					if (this._creationDownScreen && Math.hypot(pt.x - this._creationDownScreen.x, pt.y - this._creationDownScreen.y) >= 16) {
						this._creationDragged = true;
					}
					this._creationLastAnchor = normalized;
				}
				this._updateDraftPreview(normalized);
			}
			return;
		}

		// 2b. Pre-click magnet snap preview when a tool is armed
		if (this._activeTool !== null) {
			const pt = this._panePoint(event.clientX, event.clientY);
			const effMagnet = this._effectiveMagnet(event.ctrlKey || event.metaKey);
			if (pt && effMagnet !== 'off') {
				const snapRes = screenToAnchorWithSnap(this._chart, this._series, pt.x, pt.y, effMagnet);
				this._magnetIndicator.setPoint(snapRes?.snapped ? (snapRes.snapScreen ?? null) : null);
			} else {
				this._magnetIndicator.setPoint(null);
			}
			return;
		}

		this._magnetIndicator.setPoint(null);

		// 3. Hover feedback when in Cursor mode
		if (this._activeTool === null && this._drawings.length > 0) {
			const pt = this._panePoint(event.clientX, event.clientY);
			const best = pt ? this._hitTestAll(pt.x, pt.y) : null;
			const nextHoveredId = best ? best.drawing.id : null;
			const nextCursor = best?.item.cursorStyle ?? (best ? 'pointer' : '');
			for (const drawing of this._drawings) {
				if (best && best.drawing === drawing) {
					const handleId =
						best.hit.part === 'handle'
							? (best.hit.handleId ?? null)
							: best.hit.part === 'anchor'
								? String(best.hit.anchorIndex ?? 0)
								: null;
					drawing.setHoverState(
						true,
						best.hit.part === 'anchor' ? (best.hit.anchorIndex ?? null) : null,
						handleId
					);
				} else {
					drawing.setHoverState(false, null, null);
				}
			}
			if (this._hoveredId !== nextHoveredId || this._hoveredCursor !== nextCursor) {
				this._hoveredId = nextHoveredId;
				this._hoveredCursor = nextCursor;
				this._updatePaneCursor();
			}
		} else if (this._hoveredId !== null || this._hoveredCursor !== '') {
			this._hoveredId = null;
			this._hoveredCursor = '';
			this._updatePaneCursor();
		}
	}

	private _onPointerUp(event: PointerEvent): void {
		this._releasePointer(event.pointerId);
		if (this._middlePan && event.pointerId === this._middlePan.pointerId) {
			this._middlePan = null;
			this._updatePaneCursor();
			return;
		}
		if (this._spacePanPointerId !== null && event.pointerId === this._spacePanPointerId) {
			this._spacePanPointerId = null;
			if (this._activeTool !== null) {
				this._suspendPanForTool();
			}
			this._updatePaneCursor();
			return;
		}
		if (this._creationPointerId !== null && event.pointerId === this._creationPointerId) {
			const draggedTwoPoint = this._creationDragged;
			const lastAnchor = this._creationLastAnchor;
			this._creationPointerId = null;
			this._creationDownScreen = null;
			this._creationDragged = false;
			this._creationLastAnchor = null;
			if (event.type === 'pointercancel') {
				this._cancelDraft();
				this._emitState();
			} else if (this._activeTool) {
				const def = getToolDefinition(this._activeTool);
				if (def.pointCount === 2 && this._draftPoints.length === 1 && draggedTwoPoint && lastAnchor) {
					this._draftPoints.push(lastAnchor);
				}
				if (def.creation !== 'path') this.finishDrawing();
			}
			if (this._activeTool !== null) {
				this._suspendPanForTool();
			} else {
				this._restoreControls();
				this._magnetIndicator.setPoint(null);
			}
		}
		if (this._drag && event.pointerId === this._drag.pointerId) {
			this._endDrag(event.type !== 'pointercancel');
		}
	}

	private _endDrag(commit: boolean): void {
		if (!this._drag) return;
		const session = this._drag;
		this._drag = null;
		session.drawing.setActiveHandle(null);
		this._magnetIndicator.setPoint(null);
		if (this._activeTool !== null) {
			this._suspendPanForTool();
		} else {
			this._restoreControls();
		}
		this._updatePaneCursor();

		if (!commit) {
			if (session.cloneCreated) {
				this.removeDrawing(session.drawing.id, false);
			} else {
				session.drawing.setPoints(session.origPoints);
				session.drawing.applyOptions(session.origOptions);
			}
		}
		if (commit && session.didMove) {
			this._history.push(session.preDragSnapshot);
			this._emitState();
		}
	}

	private _onDoubleClick = (event: MouseEvent): void => {
		if (this._activeTool !== null) {
			if (getToolDefinition(this._activeTool).creation === 'path') {
				if (this._draftPoints.length > 2 && this._draftAddMeta.length >= 2) {
					const last = this._draftAddMeta[this._draftAddMeta.length - 1];
					const prev = this._draftAddMeta[this._draftAddMeta.length - 2];
					if (Math.hypot(last.x - prev.x, last.y - prev.y) <= 4 && last.ts - prev.ts <= 500) {
						this._draftPoints.pop();
						this._draftAddMeta.pop();
					}
				}
				this.finishDrawing();
			}
			return;
		}
		const pt = this._panePoint(event.clientX, event.clientY);
		if (!pt) return;
		const best = this._hitTestAll(pt.x, pt.y);
		if (best && getToolDefinition(best.drawing.type).capabilities.hasText && !best.drawing.options().locked) {
			this.requestTextEdit(best.drawing.id);
		}
	};

	private _onContextMenu = (event: MouseEvent): void => {
		if (this._activeTool === null) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		if (this._draftPoints.length > 0) {
			const def = getToolDefinition(this._activeTool);
			if (def.creation === 'path' && this._draftPoints.length >= (def.pointCount || 2)) {
				this.finishDrawing();
			} else {
				this.undoDraftPoint();
			}
			return;
		}
		this.setActiveTool(null);
	};

	private _onKeyUp(event: KeyboardEvent): void {
		if (event.key === ' ' && this._spacePressed) {
			this._spacePressed = false;
			if (this._spacePanPointerId === null) {
				this._updatePaneCursor();
			}
		}
	}

	private _onKeyDown(event: KeyboardEvent): void {
		if (isEditableElement(event.target) || (event.target instanceof HTMLElement && event.target.closest('dialog[open]'))) return;

		if (event.key === ' ' && this._activeTool !== null && this._drag === null && this._creationPointerId === null) {
			event.preventDefault();
			if (!this._spacePressed) {
				this._spacePressed = true;
				this._updatePaneCursor();
			}
			return;
		}

		if (event.key === 'Enter' && this._activeTool && getToolDefinition(this._activeTool).creation === 'path') { event.preventDefault(); this.finishDrawing(); return; }

		if (event.key === 'Escape') {
			if (this._draftPoints.length > 0) {
				this._cancelDraft();
				this._emitState();
				return;
			}
			if (this._activeTool !== null) {
				this.setActiveTool(null);
				return;
			}
			if (this._selectedId !== null) {
				this.selectDrawing(null);
			}
			return;
		}

		const mod = event.metaKey || event.ctrlKey;
		if (
			this._activeTool !== null &&
			this._draftPoints.length > 0 &&
			(event.key === 'Backspace' || (mod && !event.shiftKey && event.key.toLowerCase() === 'z'))
		) {
			event.preventDefault();
			this.undoDraftPoint();
			return;
		}

		if (
			(event.key === 'Delete' || event.key === 'Backspace') &&
			this._selectedId !== null
		) {
			const selected = this.selectedDrawing();
			if (selected && !selected.options().locked) {
				event.preventDefault();
				this.removeDrawing(selected.id);
			}
			return;
		}

		if (event.altKey && !mod && !event.shiftKey && this._drag === null && this._creationPointerId === null) {
			const shortcuts: Record<string, DrawingToolType> = {
				KeyT: 'trend-line',
				KeyH: 'horizontal-line',
				KeyJ: 'horizontal-ray',
				KeyV: 'vertical-line',
				KeyF: 'fib-retracement',
			};
			const byKey: Record<string, DrawingToolType> = {
				t: 'trend-line',
				h: 'horizontal-line',
				j: 'horizontal-ray',
				v: 'vertical-line',
				f: 'fib-retracement',
			};
			const mapped = shortcuts[event.code] ?? byKey[event.key.toLowerCase()];
			if (mapped) {
				event.preventDefault();
				this.setActiveTool(mapped);
				return;
			}
		}

		if (mod && !event.altKey && (event.code === 'KeyD' || event.key.toLowerCase() === 'd') && this._selectedId !== null) {
			event.preventDefault();
			this.cloneDrawing(this._selectedId);
			return;
		}

		if (mod && event.key.toLowerCase() === 'z') {
			event.preventDefault();
			if (event.shiftKey) {
				this.redo();
			} else {
				this.undo();
			}
			return;
		}

		if (mod && event.key.toLowerCase() === 'y') {
			event.preventDefault();
			this.redo();
		}
	}

	private _updateDraftPreview(cursorAnchor: AnchorPoint): void {
		if (!this._activeTool) return;
		const definition = getToolDefinition(this._activeTool);
		const previewPoints = definition.creation === 'freehand' || (definition.pointCount > 0 && this._draftPoints.length >= definition.pointCount) ? [...this._draftPoints] : [...this._draftPoints, this._normalize(cursorAnchor)];
		if (!this._previewDrawing) {
			this._previewDrawing = this._createInstance({
				id: '__preview__',
				type: this._activeTool,
				points: previewPoints,
				options: this._toolDefaultOptions(this._activeTool),
			});
			this._previewDrawing.setPreview(true);
			this._series.attachPrimitive(this._previewDrawing);
		} else {
			this._previewDrawing.setPoints(previewPoints);
		}
		this._previewDrawing.updateAllViews();
	}

	private _cancelDraft(): void {
		this._creationPointerId = null;
		this._creationDownScreen = null;
		this._creationDragged = false;
		this._creationLastAnchor = null;
		this._lastCursorAnchor = null;
		this._draftPoints = [];
		this._draftAddMeta = [];
		this._magnetIndicator.setPoint(null);
		if (this._previewDrawing) {
			this._series.detachPrimitive(this._previewDrawing);
			this._previewDrawing = null;
		}
	}
}
