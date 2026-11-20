import { cloneReadonly } from '@tradingview/lwc-toolkit/simple-clone';
import { paneContentElement } from '@tradingview/lwc-toolkit/dom/pane-element';
import {
	CrosshairMode,
	IChartApi,
	ISeriesApi,
	PrimitiveHoveredItem,
	SeriesType,
} from 'lightweight-charts';
import { BaseDrawing } from './base-drawing';
import {
	anchorToScreen,
	screenToAnchor,
	shiftAnchor,
} from './coordinates';
import { snapAngle45 } from './geometry';
import { DrawingHistory } from './history';
import {
	createDrawingInstance,
	getToolDefinition,
} from './tools/index';
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

export interface DrawingManagerOptions {
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
}

type StateChangeListener = (state: DrawingManagerState) => void;
type TextEditListener = (drawing: BaseDrawing, anchorScreen: ScreenPoint | null) => void;

interface DragSession {
	pointerId: number;
	drawing: BaseDrawing;
	mode: 'anchor' | 'body';
	anchorIndex: number;
	startLogical: number;
	startPrice: number;
	origPoints: AnchorPoint[];
	preDragSnapshot: SerializedDrawing[];
	didMove: boolean;
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
	private readonly _series: ISeriesApi<SeriesType>;
	private readonly _history: DrawingHistory;
	private readonly _keyboardEnabled: boolean;
	private readonly _syncCrosshairMagnet: boolean;
	private readonly _originalCrosshairMode: CrosshairMode;

	private _drawings: BaseDrawing[] = [];
	private _drawingMap: Map<string, BaseDrawing> = new Map();

	private _activeTool: DrawingToolType | null = null;
	private _selectedId: string | null = null;
	private _magnetMode: MagnetMode;
	private _drawingsVisible: boolean = true;
	private _stayInDrawingMode: boolean;

	private _draftPoints: AnchorPoint[] = [];
	private _previewDrawing: BaseDrawing | null = null;

	private _drag: DragSession | null = null;
	private _restoreChartControls: (() => void) | null = null;
	private _creationPointerId: number | null = null;

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
		this._series = series;
		this._magnetMode = options.magnetMode ?? 'off';
		this._stayInDrawingMode = options.stayInDrawingMode ?? false;
		this._keyboardEnabled = options.keyboardShortcuts ?? true;
		this._syncCrosshairMagnet = options.syncCrosshairMagnet ?? true;
		this._originalCrosshairMode = this._chart.options().crosshair.mode;
		this._history = new DrawingHistory(options.maxHistory ?? 100);

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
		if (tool !== null) {
			this._setSelectedInternal(null);
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
		const data: SerializedDrawing = {
			id: generateDrawingId(),
			type,
			points: points.map(p => ({ ...p })),
			options,
		};
		const drawing = createDrawingInstance(data);
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
		const drawing = this._drawingMap.get(id);
		if (!drawing) return;
		if (recordHistory) {
			this._history.push(this._serializeList());
		}
		drawing.applyOptions(options);
		this._emitState();
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
		if (!drawing || drawing.type !== 'text') return;
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
			const drawing = createDrawingInstance(item);
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

		const onMove = (ev: PointerEvent) => this._onPointerMove(ev);
		const onUp = (ev: PointerEvent) => this._onPointerUp(ev);
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onUp);
		this._unsubscribers.push(() => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onUp);
		});

		if (this._keyboardEnabled) {
			const onKeyDown = (ev: KeyboardEvent) => this._onKeyDown(ev);
			window.addEventListener('keydown', onKeyDown);
			this._unsubscribers.push(() => window.removeEventListener('keydown', onKeyDown));
		}
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

	private _suspendControls(): void {
		if (this._restoreChartControls !== null) return;
		const { handleScroll: scroll, handleScale: scale } = this._chart.options();
		const savedScroll = typeof scroll === 'boolean' ? scroll : cloneReadonly(scroll);
		const savedScale = typeof scale === 'boolean' ? scale : cloneReadonly(scale);
		this._chart.applyOptions({ handleScroll: false, handleScale: false });
		this._restoreChartControls = () => {
			this._chart.applyOptions({
				handleScroll: savedScroll,
				handleScale: savedScale,
			});
		};
	}

	private _restoreControls(): void {
		if (this._restoreChartControls !== null) {
			const restore = this._restoreChartControls;
			this._restoreChartControls = null;
			restore();
		}
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
		paneEl.style.cursor = this._activeTool !== null ? 'crosshair' : '';
	}

	private _hitTestAll(
		x: number,
		y: number
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
			const item = drawing.hitTest(x, y);
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
		if (!event.isPrimary || event.button !== 0) return;
		const pt = this._panePoint(event.clientX, event.clientY);
		if (!pt) return;

		// Mode 1: Active creation tool
		if (this._activeTool !== null) {
			const def = getToolDefinition(this._activeTool);
			const originAnchor =
				this._draftPoints.length > 0 && def.pointCount >= 2
					? this._draftPoints[this._draftPoints.length - 1]
					: null;
			const snappedPt = this._resolveScreenWithShift(pt, event.shiftKey, originAnchor);
			const anchor = screenToAnchor(
				this._chart,
				this._series,
				snappedPt.x,
				snappedPt.y,
				this._magnetMode
			);
			if (!anchor) return;

			this._creationPointerId = event.pointerId;
			this._suspendControls();

			this._draftPoints.push(anchor);
			if (this._draftPoints.length >= def.pointCount) {
				const toolType = this._activeTool;
				const finalPoints = this._draftPoints.slice(0, def.pointCount);
				this._cancelDraft();

				const created = this.addDrawing(toolType, finalPoints, {}, true);
				this._setSelectedInternal(created.id);

				if (!this._stayInDrawingMode) {
					this._activeTool = null;
					this._updatePaneCursor();
				}
				this._emitState();

				if (toolType === 'text') {
					this.requestTextEdit(created.id);
				}
			} else {
				this._updateDraftPreview(anchor);
			}
			return;
		}

		// Mode 2: Cursor selection & drag
		const best = this._hitTestAll(pt.x, pt.y);
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

		this._suspendControls();
		this._drag = {
			pointerId: event.pointerId,
			drawing,
			mode: hit.part,
			anchorIndex: hit.anchorIndex ?? 0,
			startLogical,
			startPrice,
			origPoints: drawing.points().map(p => ({ ...p })),
			preDragSnapshot: this._serializeList(),
			didMove: false,
		};
	};

	private _onPointerMove(event: PointerEvent): void {
		// 1. Active drag gesture
		if (this._drag && event.pointerId === this._drag.pointerId) {
			const pt = this._panePointUnclamped(event.clientX, event.clientY);
			if (!pt) return;

			const { drawing, mode, anchorIndex, startLogical, startPrice, origPoints } =
				this._drag;

			if (mode === 'anchor') {
				const refIdx = anchorIndex === 0 ? 1 : anchorIndex - 1;
				const originAnchor =
					origPoints.length >= 2 && refIdx < origPoints.length
						? drawing.points()[refIdx]
						: null;
				const snappedPt = this._resolveScreenWithShift(
					pt,
					event.shiftKey,
					originAnchor
				);
				const nextAnchor = screenToAnchor(
					this._chart,
					this._series,
					snappedPt.x,
					snappedPt.y,
					this._magnetMode
				);
				if (nextAnchor) {
					drawing.setPoint(anchorIndex, nextAnchor);
					this._drag.didMove = true;
				}
			} else {
				const curLogical = this._chart.timeScale().coordinateToLogical(pt.x);
				const curPrice = this._series.coordinateToPrice(pt.y);
				if (curLogical !== null && curPrice !== null) {
					const deltaLogical = curLogical - startLogical;
					const deltaPrice = curPrice - startPrice;
					if (Math.abs(deltaLogical) > 1e-6 || Math.abs(deltaPrice) > 1e-9) {
						const shifted = origPoints.map(orig =>
							shiftAnchor(this._chart, orig, deltaLogical, deltaPrice)
						);
						drawing.setPoints(shifted);
						this._drag.didMove = true;
					}
				}
			}
			return;
		}

		// 2. Live creation preview
		if (this._activeTool !== null && this._draftPoints.length > 0) {
			const pt = this._panePoint(event.clientX, event.clientY);
			if (!pt) return;
			const originAnchor = this._draftPoints[this._draftPoints.length - 1];
			const snappedPt = this._resolveScreenWithShift(pt, event.shiftKey, originAnchor);
			const anchor = screenToAnchor(
				this._chart,
				this._series,
				snappedPt.x,
				snappedPt.y,
				this._magnetMode
			);
			if (anchor) {
				this._updateDraftPreview(anchor);
			}
			return;
		}

		// 3. Hover feedback when in Cursor mode
		if (this._activeTool === null && this._drawings.length > 0) {
			const pt = this._panePoint(event.clientX, event.clientY);
			const best = pt ? this._hitTestAll(pt.x, pt.y) : null;
			for (const drawing of this._drawings) {
				if (best && best.drawing === drawing) {
					drawing.setHoverState(
						true,
						best.hit.part === 'anchor' ? (best.hit.anchorIndex ?? null) : null
					);
				} else {
					drawing.setHoverState(false, null);
				}
			}
		}
	}

	private _onPointerUp(event: PointerEvent): void {
		if (this._creationPointerId !== null && event.pointerId === this._creationPointerId) {
			this._creationPointerId = null;
			this._restoreControls();
		}
		if (this._drag && event.pointerId === this._drag.pointerId) {
			this._endDrag(true);
		}
	}

	private _endDrag(commit: boolean): void {
		if (!this._drag) return;
		const session = this._drag;
		this._drag = null;
		this._restoreControls();

		if (commit && session.didMove) {
			this._history.push(session.preDragSnapshot);
			this._emitState();
		}
	}

	private _onDoubleClick = (event: MouseEvent): void => {
		if (this._activeTool !== null) return;
		const pt = this._panePoint(event.clientX, event.clientY);
		if (!pt) return;
		const best = this._hitTestAll(pt.x, pt.y);
		if (best && best.drawing.type === 'text' && !best.drawing.options().locked) {
			this.requestTextEdit(best.drawing.id);
		}
	};

	private _onKeyDown(event: KeyboardEvent): void {
		if (isEditableElement(event.target)) return;

		if (event.key === 'Escape') {
			if (this._draftPoints.length > 0) {
				this._cancelDraft();
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

		const mod = event.metaKey || event.ctrlKey;
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
		const previewPoints = [...this._draftPoints, cursorAnchor];
		if (!this._previewDrawing) {
			this._previewDrawing = createDrawingInstance({
				id: '__preview__',
				type: this._activeTool,
				points: previewPoints,
				options: {},
			});
			this._previewDrawing.setPreview(true);
			this._series.attachPrimitive(this._previewDrawing);
		} else {
			this._previewDrawing.setPoints(previewPoints);
		}
		this._previewDrawing.updateAllViews();
	}

	private _cancelDraft(): void {
		this._draftPoints = [];
		if (this._previewDrawing) {
			this._series.detachPrimitive(this._previewDrawing);
			this._previewDrawing = null;
		}
	}
}
