import { DrawingManager, DrawingManagerState } from '../manager';
import { TOOL_DEFINITIONS } from '../tools/index';
import { DrawingTheme, DrawingToolType } from '../types';
import { TOOL_ICONS, UI_ICONS } from './icons';
import { injectDrawingToolsStyles } from './styles';

export interface DrawingToolbarOptions {
	theme?: DrawingTheme;
	showSerializationButtons?: boolean;
	onExportJson?: (json: string) => void;
}

export class DrawingToolbar {
	private readonly _manager: DrawingManager;
	private readonly _root: HTMLDivElement;
	private readonly _toolButtons: Map<DrawingToolType, HTMLButtonElement> = new Map();
	private readonly _cursorBtn: HTMLButtonElement;
	private readonly _magnetBtn: HTMLButtonElement;
	private readonly _magnetBadge: HTMLSpanElement;
	private readonly _stayBtn: HTMLButtonElement;
	private readonly _visibilityBtn: HTMLButtonElement;
	private readonly _undoBtn: HTMLButtonElement;
	private readonly _redoBtn: HTMLButtonElement;
	private readonly _clearBtn: HTMLButtonElement;
	private readonly _unsubscribe: () => void;

	public constructor(
		manager: DrawingManager,
		container: HTMLElement,
		options: DrawingToolbarOptions = {}
	) {
		injectDrawingToolsStyles();
		this._manager = manager;

		this._root = document.createElement('div');
		this._root.className = `lwc-dt-toolbar lwc-dt-theme-${options.theme ?? 'dark'}`;

		// Cursor button
		this._cursorBtn = this._createButton(
			UI_ICONS.cursor,
			'光标 / 选择 (Esc)',
			() => this._manager.setActiveTool(null)
		);
		this._root.appendChild(this._cursorBtn);
		this._root.appendChild(this._createSep());

		// 9 Core Drawing Tools
		for (const def of TOOL_DEFINITIONS) {
			const btn = this._createButton(
				TOOL_ICONS[def.type],
				`${def.shortLabel} (${def.label})`,
				() => {
					const next = this._manager.activeTool() === def.type ? null : def.type;
					this._manager.setActiveTool(next);
				}
			);
			this._toolButtons.set(def.type, btn);
			this._root.appendChild(btn);
		}

		this._root.appendChild(this._createSep());

		// Magnet Mode
		this._magnetBtn = this._createButton(
			UI_ICONS.magnet,
			'OHLC 磁吸模式 (关 / 弱 / 强)',
			() => this._manager.cycleMagnetMode()
		);
		this._magnetBadge = document.createElement('span');
		this._magnetBadge.className = 'lwc-dt-btn-badge';
		this._magnetBadge.style.display = 'none';
		this._magnetBtn.appendChild(this._magnetBadge);
		this._root.appendChild(this._magnetBtn);

		// Stay in drawing mode
		this._stayBtn = this._createButton(
			UI_ICONS.stayDrawing,
			'保持连续绘图模式',
			() => this._manager.setStayInDrawingMode(!this._manager.stayInDrawingMode())
		);
		this._root.appendChild(this._stayBtn);

		// Visibility toggle
		this._visibilityBtn = this._createButton(
			UI_ICONS.eyeOpen,
			'隐藏 / 显示所有绘图',
			() => this._manager.setDrawingsVisible(!this._manager.drawingsVisible())
		);
		this._root.appendChild(this._visibilityBtn);

		this._root.appendChild(this._createSep());

		// Undo / Redo
		this._undoBtn = this._createButton(
			UI_ICONS.undo,
			'撤销 (Cmd/Ctrl+Z)',
			() => this._manager.undo()
		);
		this._redoBtn = this._createButton(
			UI_ICONS.redo,
			'重做 (Cmd/Ctrl+Shift+Z)',
			() => this._manager.redo()
		);
		this._root.appendChild(this._undoBtn);
		this._root.appendChild(this._redoBtn);

		// Optional Export / Import JSON
		if (options.showSerializationButtons ?? true) {
			this._root.appendChild(this._createSep());

			const exportBtn = this._createButton(
				UI_ICONS.exportJson,
				'导出绘图 JSON',
				() => {
					const json = JSON.stringify(this._manager.exportState(), null, 2);
					if (options.onExportJson) {
						options.onExportJson(json);
					} else {
						this._downloadJson(json);
					}
				}
			);
			const importBtn = this._createButton(
				UI_ICONS.importJson,
				'导入绘图 JSON',
				() => this._triggerImportJson()
			);
			this._root.appendChild(exportBtn);
			this._root.appendChild(importBtn);
		}

		this._root.appendChild(this._createSep());

		// Clear All
		this._clearBtn = this._createButton(
			UI_ICONS.trash,
			'清空所有绘图',
			() => this._manager.clearAll()
		);
		this._clearBtn.classList.add('is-danger');
		this._root.appendChild(this._clearBtn);

		container.appendChild(this._root);
		this._unsubscribe = this._manager.subscribeStateChange(state =>
			this._syncState(state)
		);
	}

	public element(): HTMLDivElement {
		return this._root;
	}

	public setTheme(theme: DrawingTheme): void {
		this._root.classList.toggle('lwc-dt-theme-dark', theme === 'dark');
		this._root.classList.toggle('lwc-dt-theme-light', theme === 'light');
	}

	public destroy(): void {
		this._unsubscribe();
		this._root.remove();
	}

	private _createButton(
		iconHtml: string,
		title: string,
		onClick: () => void
	): HTMLButtonElement {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'lwc-dt-btn';
		btn.title = title;
		btn.innerHTML = iconHtml;
		btn.addEventListener('click', onClick);
		return btn;
	}

	private _createSep(): HTMLDivElement {
		const sep = document.createElement('div');
		sep.className = 'lwc-dt-toolbar-sep';
		return sep;
	}

	private _syncState(state: DrawingManagerState): void {
		this._cursorBtn.classList.toggle('is-active', state.activeTool === null);
		for (const [type, btn] of this._toolButtons) {
			btn.classList.toggle('is-active', state.activeTool === type);
		}

		this._magnetBtn.classList.toggle('is-active', state.magnetMode !== 'off');
		if (state.magnetMode === 'off') {
			this._magnetBadge.style.display = 'none';
			this._magnetBtn.title = 'OHLC 磁吸模式：关';
		} else if (state.magnetMode === 'weak') {
			this._magnetBadge.style.display = 'block';
			this._magnetBadge.textContent = 'W';
			this._magnetBtn.title = 'OHLC 磁吸模式：弱磁吸';
		} else {
			this._magnetBadge.style.display = 'block';
			this._magnetBadge.textContent = 'S';
			this._magnetBtn.title = 'OHLC 磁吸模式：强磁吸';
		}

		this._stayBtn.classList.toggle('is-active', state.stayInDrawingMode);
		this._visibilityBtn.classList.toggle('is-active', !state.drawingsVisible);
		this._visibilityBtn.innerHTML = state.drawingsVisible
			? UI_ICONS.eyeOpen
			: UI_ICONS.eyeClosed;

		this._undoBtn.disabled = !state.canUndo;
		this._redoBtn.disabled = !state.canRedo;
		this._clearBtn.disabled = state.count === 0;
	}

	private _downloadJson(json: string): void {
		const blob = new Blob([json], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'chart-drawings.json';
		a.click();
		URL.revokeObjectURL(url);
	}

	private _triggerImportJson(): void {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.json,application/json';
		input.addEventListener('change', () => {
			const file = input.files?.[0];
			if (!file) return;
			const reader = new FileReader();
			reader.onload = () => {
				try {
					const parsed = JSON.parse(String(reader.result));
					this._manager.importState(parsed, true);
				} catch (err) {
					console.error('Failed to import drawings JSON:', err);
				}
			};
			reader.readAsText(file);
		});
		input.click();
	}
}
