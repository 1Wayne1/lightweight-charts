import type { SerializedDrawing } from './types';

function cloneDrawings(drawings: readonly SerializedDrawing[]): SerializedDrawing[] {
	return drawings.map(d => ({
		id: d.id,
		type: d.type,
		points: d.points.map(p => ({ ...p })),
		options: {
			...d.options,
			...(d.options.fibLevels
				? { fibLevels: d.options.fibLevels.map(l => ({ ...l })) }
				: {}),
		},
	}));
}

export class DrawingHistory {
	private _undoStack: SerializedDrawing[][] = [];
	private _redoStack: SerializedDrawing[][] = [];
	private readonly _maxEntries: number;

	public constructor(maxEntries: number = 100) {
		this._maxEntries = maxEntries;
	}

	public push(state: readonly SerializedDrawing[]): void {
		this._undoStack.push(cloneDrawings(state));
		if (this._undoStack.length > this._maxEntries) {
			this._undoStack.shift();
		}
		this._redoStack = [];
	}

	public canUndo(): boolean {
		return this._undoStack.length > 0;
	}

	public canRedo(): boolean {
		return this._redoStack.length > 0;
	}

	public undo(currentState: readonly SerializedDrawing[]): SerializedDrawing[] | null {
		const previous = this._undoStack.pop();
		if (!previous) {
			return null;
		}
		this._redoStack.push(cloneDrawings(currentState));
		return cloneDrawings(previous);
	}

	public redo(currentState: readonly SerializedDrawing[]): SerializedDrawing[] | null {
		const next = this._redoStack.pop();
		if (!next) {
			return null;
		}
		this._undoStack.push(cloneDrawings(currentState));
		return cloneDrawings(next);
	}

	public clear(): void {
		this._undoStack = [];
		this._redoStack = [];
	}
}
