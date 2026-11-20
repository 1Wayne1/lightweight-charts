import { LineStyle } from 'lightweight-charts';
import { BaseDrawing } from '../base-drawing';
import { DrawingManager, DrawingManagerState } from '../manager';
import { getToolDefinition } from '../tools/index';
import { DrawingTheme, ScreenPoint } from '../types';
import { UI_ICONS } from './icons';
import { injectDrawingToolsStyles } from './styles';

const PRESET_COLORS = [
	'#2962FF', '#089981', '#F23645', '#FF9800', '#9C27B0', '#00BCD4',
	'#4CAF50', '#E91E63', '#FFEB3B', '#787B86', '#D1D4DC', '#1E222D',
];

const LINE_WIDTHS = [1, 2, 3, 4];

const LINE_STYLES: ReadonlyArray<{ value: LineStyle; label: string; dash: string }> = [
	{ value: LineStyle.Solid, label: '实线', dash: 'solid' },
	{ value: LineStyle.Dashed, label: '虚线', dash: 'dashed' },
	{ value: LineStyle.Dotted, label: '点线', dash: 'dotted' },
];

export interface FloatingPropertiesBarOptions {
	theme?: DrawingTheme;
}

export class FloatingPropertiesBar {
	private readonly _manager: DrawingManager;
	private readonly _container: HTMLElement;
	private readonly _root: HTMLDivElement;
	private readonly _content: HTMLDivElement;
	private _activePopover: HTMLDivElement | null = null;
	private _textEditorEl: HTMLDivElement | null = null;
	private _currentDrawing: BaseDrawing | null = null;
	private _theme: DrawingTheme;

	private _customPos: { left: number; top: number } | null = null;
	private _draggingBar: {
		pointerId: number;
		startX: number;
		startY: number;
		origLeft: number;
		origTop: number;
	} | null = null;

	private readonly _unsubscribers: Array<() => void> = [];

	public constructor(
		manager: DrawingManager,
		container: HTMLElement,
		options: FloatingPropertiesBarOptions = {}
	) {
		injectDrawingToolsStyles();
		this._manager = manager;
		this._container = container;
		this._theme = options.theme ?? 'dark';

		if (getComputedStyle(container).position === 'static') {
			container.style.position = 'relative';
		}

		this._root = document.createElement('div');
		this._root.className = `lwc-dt-propbar lwc-dt-theme-${this._theme}`;

		const grip = document.createElement('div');
		grip.className = 'lwc-dt-grip';
		grip.title = '拖动属性条';
		grip.innerHTML = UI_ICONS.grip;
		grip.addEventListener('pointerdown', this._onGripPointerDown);
		this._root.appendChild(grip);

		this._content = document.createElement('div');
		this._content.style.display = 'inline-flex';
		this._content.style.alignItems = 'center';
		this._content.style.gap = '4px';
		this._root.appendChild(this._content);

		this._container.appendChild(this._root);

		this._unsubscribers.push(
			this._manager.subscribeStateChange(state => this._syncState(state)),
			this._manager.subscribeTextEdit((drawing, sp) =>
				this.openTextEditor(drawing, sp)
			)
		);

		const onDocPointerDown = (ev: PointerEvent) => {
			if (
				this._activePopover &&
				!this._root.contains(ev.target as Node)
			) {
				this._closePopover();
			}
		};
		const onWinMove = (ev: PointerEvent) => this._onGripPointerMove(ev);
		const onWinUp = (ev: PointerEvent) => this._onGripPointerUp(ev);

		window.addEventListener('pointerdown', onDocPointerDown);
		window.addEventListener('pointermove', onWinMove);
		window.addEventListener('pointerup', onWinUp);
		this._unsubscribers.push(() => {
			window.removeEventListener('pointerdown', onDocPointerDown);
			window.removeEventListener('pointermove', onWinMove);
			window.removeEventListener('pointerup', onWinUp);
		});
	}

	public element(): HTMLDivElement {
		return this._root;
	}

	public setTheme(theme: DrawingTheme): void {
		this._theme = theme;
		this._root.classList.toggle('lwc-dt-theme-dark', theme === 'dark');
		this._root.classList.toggle('lwc-dt-theme-light', theme === 'light');
		if (this._textEditorEl) {
			this._textEditorEl.classList.toggle('lwc-dt-theme-dark', theme === 'dark');
			this._textEditorEl.classList.toggle('lwc-dt-theme-light', theme === 'light');
		}
	}

	public openTextEditor(drawing: BaseDrawing, anchorScreen: ScreenPoint | null): void {
		this._closeTextEditor();
		if (drawing.type !== 'text') return;

		const editor = document.createElement('div');
		editor.className = `lwc-dt-text-editor lwc-dt-theme-${this._theme}`;

		const left = anchorScreen
			? Math.max(12, Math.min(this._container.clientWidth - 250, anchorScreen.x + 12))
			: Math.max(12, this._container.clientWidth / 2 - 110);
		const top = anchorScreen
			? Math.max(56, Math.min(this._container.clientHeight - 130, anchorScreen.y - 20))
			: 68;
		editor.style.left = `${left}px`;
		editor.style.top = `${top}px`;

		const textarea = document.createElement('textarea');
		textarea.value = drawing.options().text;
		textarea.placeholder = '输入标注文本...';
		editor.appendChild(textarea);

		const actions = document.createElement('div');
		actions.className = 'lwc-dt-text-editor-actions';

		const cancelBtn = document.createElement('button');
		cancelBtn.type = 'button';
		cancelBtn.className = 'lwc-dt-action-btn';
		cancelBtn.textContent = '取消';
		cancelBtn.addEventListener('click', () => this._closeTextEditor());

		const saveBtn = document.createElement('button');
		saveBtn.type = 'button';
		saveBtn.className = 'lwc-dt-action-btn is-primary';
		saveBtn.textContent = '确定';
		const commit = () => {
			const nextText = textarea.value.trim() || 'Note';
			this._manager.updateDrawingOptions(drawing.id, { text: nextText }, true);
			this._closeTextEditor();
		};
		saveBtn.addEventListener('click', commit);

		textarea.addEventListener('keydown', ev => {
			if (ev.key === 'Escape') {
				ev.preventDefault();
				this._closeTextEditor();
			} else if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') {
				ev.preventDefault();
				commit();
			}
		});

		actions.appendChild(cancelBtn);
		actions.appendChild(saveBtn);
		editor.appendChild(actions);

		this._container.appendChild(editor);
		this._textEditorEl = editor;
		textarea.focus();
		textarea.select();
	}

	public destroy(): void {
		this._closePopover();
		this._closeTextEditor();
		for (const unsub of this._unsubscribers) {
			unsub();
		}
		this._unsubscribers.length = 0;
		this._root.remove();
	}

	private _closePopover(): void {
		if (this._activePopover) {
			this._activePopover.remove();
			this._activePopover = null;
		}
	}

	private _closeTextEditor(): void {
		if (this._textEditorEl) {
			this._textEditorEl.remove();
			this._textEditorEl = null;
		}
	}

	private _syncState(state: DrawingManagerState): void {
		this._currentDrawing = state.selectedDrawing;
		if (!this._currentDrawing) {
			this._root.classList.remove('is-visible');
			this._closePopover();
			return;
		}
		this._root.classList.add('is-visible');
		this._renderControls(this._currentDrawing);
	}

	private _renderControls(drawing: BaseDrawing): void {
		this._closePopover();
		this._content.innerHTML = '';

		const def = getToolDefinition(drawing.type);
		const caps = def.capabilities;
		const opts = drawing.options();

		// 1. Stroke color
		if (caps.hasStroke) {
			const btn = this._createPropBtn('边框 / 线条颜色', () => {
				this._openColorPopover(btn, opts.color, null, (color) => {
					this._manager.updateDrawingOptions(drawing.id, { color }, true);
				});
			});
			const swatch = document.createElement('span');
			swatch.className = 'lwc-dt-swatch';
			swatch.style.backgroundColor = opts.color;
			btn.appendChild(swatch);
			this._content.appendChild(btn);
		}

		// 2. Fill color & opacity
		if (caps.hasFill) {
			const btn = this._createPropBtn('填充颜色与透明度', () => {
				this._openColorPopover(
					btn,
					opts.fillColor,
					opts.fillOpacity,
					(fillColor, fillOpacity) => {
						this._manager.updateDrawingOptions(
							drawing.id,
							{
								fillColor,
								...(fillOpacity !== undefined ? { fillOpacity } : {}),
							},
							true
						);
					}
				);
			});
			const swatch = document.createElement('span');
			swatch.className = 'lwc-dt-swatch';
			swatch.style.backgroundColor = opts.fillColor;
			swatch.style.opacity = String(Math.max(0.25, opts.fillOpacity));
			btn.appendChild(swatch);
			this._content.appendChild(btn);
		}

		// 3. Line width
		if (caps.hasLineWidth) {
			const btn = this._createPropBtn('线宽', () => {
				this._openLineWidthPopover(btn, opts.lineWidth, width => {
					this._manager.updateDrawingOptions(drawing.id, { lineWidth: width }, true);
				});
			});
			btn.textContent = `${opts.lineWidth}px`;
			this._content.appendChild(btn);
		}

		// 4. Line style
		if (caps.hasLineStyle) {
			const currentStyle =
				LINE_STYLES.find(s => s.value === opts.lineStyle) ?? LINE_STYLES[0];
			const btn = this._createPropBtn('线型', () => {
				this._openLineStylePopover(btn, opts.lineStyle, lineStyle => {
					this._manager.updateDrawingOptions(drawing.id, { lineStyle }, true);
				});
			});
			const preview = document.createElement('span');
			preview.style.width = '18px';
			preview.style.borderTop = `2px ${currentStyle.dash} currentColor`;
			btn.appendChild(preview);
			this._content.appendChild(btn);
		}

		// 5. Extend left / right
		if (caps.hasExtend) {
			this._content.appendChild(this._createSep());
			const extLeftBtn = this._createPropBtn('向左延伸', () => {
				this._manager.updateDrawingOptions(
					drawing.id,
					{ extendLeft: !opts.extendLeft },
					true
				);
			});
			extLeftBtn.innerHTML = UI_ICONS.extendLeft;
			extLeftBtn.classList.toggle('is-active', opts.extendLeft);
			this._content.appendChild(extLeftBtn);

			const extRightBtn = this._createPropBtn('向右延伸', () => {
				this._manager.updateDrawingOptions(
					drawing.id,
					{ extendRight: !opts.extendRight },
					true
				);
			});
			extRightBtn.innerHTML = UI_ICONS.extendRight;
			extRightBtn.classList.toggle('is-active', opts.extendRight);
			this._content.appendChild(extRightBtn);
		}

		// 6. Midline toggle (Parallel Channel)
		if (caps.hasMidline) {
			const midBtn = this._createPropBtn('显示/隐藏中线', () => {
				this._manager.updateDrawingOptions(
					drawing.id,
					{ showMidline: !opts.showMidline },
					true
				);
			});
			midBtn.innerHTML = UI_ICONS.midline;
			midBtn.classList.toggle('is-active', opts.showMidline);
			this._content.appendChild(midBtn);
		}

		// 7. Text editing & font size
		if (caps.hasText) {
			this._content.appendChild(this._createSep());
			const editBtn = this._createPropBtn('编辑文本', () => {
				this._manager.requestTextEdit(drawing.id);
			});
			editBtn.innerHTML = `${UI_ICONS.editText}<span>编辑</span>`;
			this._content.appendChild(editBtn);

			const textColorBtn = this._createPropBtn('文字颜色', () => {
				this._openColorPopover(textColorBtn, opts.textColor, null, textColor => {
					this._manager.updateDrawingOptions(drawing.id, { textColor }, true);
				});
			});
			textColorBtn.innerHTML = `<span style="font-weight:700;color:${opts.textColor}">A</span>`;
			this._content.appendChild(textColorBtn);
		}

		// 8. Lock & Delete
		this._content.appendChild(this._createSep());

		const lockBtn = this._createPropBtn(opts.locked ? '解锁绘图' : '锁定绘图', () => {
			this._manager.updateDrawingOptions(
				drawing.id,
				{ locked: !opts.locked },
				true
			);
		});
		lockBtn.innerHTML = opts.locked ? UI_ICONS.lock : UI_ICONS.unlock;
		lockBtn.classList.toggle('is-active', opts.locked);
		this._content.appendChild(lockBtn);

		const deleteBtn = this._createPropBtn('删除绘图 (Delete)', () => {
			if (!opts.locked) {
				this._manager.removeDrawing(drawing.id, true);
			}
		});
		deleteBtn.innerHTML = UI_ICONS.trash;
		deleteBtn.classList.add('is-danger');
		if (opts.locked) {
			deleteBtn.style.opacity = '0.35';
			deleteBtn.style.cursor = 'not-allowed';
		}
		this._content.appendChild(deleteBtn);
	}

	private _createPropBtn(title: string, onClick: () => void): HTMLButtonElement {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'lwc-dt-prop-btn';
		btn.title = title;
		btn.addEventListener('click', ev => {
			ev.stopPropagation();
			onClick();
		});
		return btn;
	}

	private _createSep(): HTMLDivElement {
		const sep = document.createElement('div');
		sep.className = 'lwc-dt-prop-sep';
		return sep;
	}

	private _openColorPopover(
		anchorBtn: HTMLElement,
		currentColor: string,
		currentOpacity: number | null,
		onSelect: (color: string, opacity?: number) => void
	): void {
		const wasSame = this._activePopover?.dataset.owner === anchorBtn.title;
		this._closePopover();
		if (wasSame) return;

		const pop = document.createElement('div');
		pop.className = 'lwc-dt-popover';
		pop.dataset.owner = anchorBtn.title;
		pop.addEventListener('pointerdown', ev => ev.stopPropagation());

		const palette = document.createElement('div');
		palette.className = 'lwc-dt-palette';
		for (const hex of PRESET_COLORS) {
			const dot = document.createElement('button');
			dot.type = 'button';
			dot.className = 'lwc-dt-palette-dot';
			dot.style.backgroundColor = hex;
			if (hex.toLowerCase() === currentColor.toLowerCase()) {
				dot.classList.add('is-selected');
			}
			dot.addEventListener('click', () => {
				onSelect(hex, currentOpacity ?? undefined);
				this._closePopover();
			});
			palette.appendChild(dot);
		}
		pop.appendChild(palette);

		const customRow = document.createElement('div');
		customRow.className = 'lwc-dt-popover-row';
		const customLabel = document.createElement('span');
		customLabel.textContent = '自定义颜色';
		const colorInput = document.createElement('input');
		colorInput.type = 'color';
		colorInput.value = /^#[0-9a-f]{6}$/i.test(currentColor) ? currentColor : '#2962ff';
		colorInput.addEventListener('change', () => {
			onSelect(colorInput.value, currentOpacity ?? undefined);
		});
		customRow.appendChild(customLabel);
		customRow.appendChild(colorInput);
		pop.appendChild(customRow);

		if (currentOpacity !== null) {
			const opacityRow = document.createElement('div');
			opacityRow.className = 'lwc-dt-popover-row';
			const opLabel = document.createElement('span');
			opLabel.textContent = `透明 ${Math.round(currentOpacity * 100)}%`;
			const slider = document.createElement('input');
			slider.type = 'range';
			slider.min = '0';
			slider.max = '100';
			slider.value = String(Math.round(currentOpacity * 100));
			slider.addEventListener('input', () => {
				const nextOp = Number(slider.value) / 100;
				opLabel.textContent = `透明 ${slider.value}%`;
				if (this._currentDrawing) {
					this._manager.updateDrawingOptions(
						this._currentDrawing.id,
						{ fillOpacity: nextOp },
						false
					);
				}
			});
			slider.addEventListener('change', () => {
				onSelect(currentColor, Number(slider.value) / 100);
			});
			opacityRow.appendChild(opLabel);
			opacityRow.appendChild(slider);
			pop.appendChild(opacityRow);
		}

		anchorBtn.appendChild(pop);
		this._activePopover = pop;
	}

	private _openLineWidthPopover(
		anchorBtn: HTMLElement,
		currentWidth: number,
		onSelect: (width: number) => void
	): void {
		const wasSame = this._activePopover?.dataset.owner === 'line-width';
		this._closePopover();
		if (wasSame) return;

		const pop = document.createElement('div');
		pop.className = 'lwc-dt-popover';
		pop.style.minWidth = '112px';
		pop.dataset.owner = 'line-width';
		pop.addEventListener('pointerdown', ev => ev.stopPropagation());

		const menu = document.createElement('div');
		menu.className = 'lwc-dt-menu';
		for (const w of LINE_WIDTHS) {
			const item = document.createElement('button');
			item.type = 'button';
			item.className = 'lwc-dt-menu-item';
			if (Math.round(currentWidth) === w) {
				item.classList.add('is-selected');
			}
			item.innerHTML = `<span style="display:inline-block;width:44px;border-top:${w}px solid currentColor"></span><span>${w}px</span>`;
			item.addEventListener('click', () => {
				onSelect(w);
				this._closePopover();
			});
			menu.appendChild(item);
		}
		pop.appendChild(menu);
		anchorBtn.appendChild(pop);
		this._activePopover = pop;
	}

	private _openLineStylePopover(
		anchorBtn: HTMLElement,
		currentStyle: LineStyle,
		onSelect: (style: LineStyle) => void
	): void {
		const wasSame = this._activePopover?.dataset.owner === 'line-style';
		this._closePopover();
		if (wasSame) return;

		const pop = document.createElement('div');
		pop.className = 'lwc-dt-popover';
		pop.style.minWidth = '120px';
		pop.dataset.owner = 'line-style';
		pop.addEventListener('pointerdown', ev => ev.stopPropagation());

		const menu = document.createElement('div');
		menu.className = 'lwc-dt-menu';
		for (const styleItem of LINE_STYLES) {
			const item = document.createElement('button');
			item.type = 'button';
			item.className = 'lwc-dt-menu-item';
			if (currentStyle === styleItem.value) {
				item.classList.add('is-selected');
			}
			item.innerHTML = `<span style="display:inline-block;width:40px;border-top:2px ${styleItem.dash} currentColor"></span><span>${styleItem.label}</span>`;
			item.addEventListener('click', () => {
				onSelect(styleItem.value);
				this._closePopover();
			});
			menu.appendChild(item);
		}
		pop.appendChild(menu);
		anchorBtn.appendChild(pop);
		this._activePopover = pop;
	}

	private _onGripPointerDown = (ev: PointerEvent): void => {
		if (!ev.isPrimary || ev.button !== 0) return;
		ev.preventDefault();
		ev.stopPropagation();

		const containerRect = this._container.getBoundingClientRect();
		const barRect = this._root.getBoundingClientRect();
		const origLeft = this._customPos
			? this._customPos.left
			: barRect.left - containerRect.left;
		const origTop = this._customPos
			? this._customPos.top
			: barRect.top - containerRect.top;

		this._root.style.transform = 'none';
		this._root.style.left = `${origLeft}px`;
		this._root.style.top = `${origTop}px`;
		this._customPos = { left: origLeft, top: origTop };

		this._draggingBar = {
			pointerId: ev.pointerId,
			startX: ev.clientX,
			startY: ev.clientY,
			origLeft,
			origTop,
		};
	};

	private _onGripPointerMove(ev: PointerEvent): void {
		if (!this._draggingBar || ev.pointerId !== this._draggingBar.pointerId) return;
		const dx = ev.clientX - this._draggingBar.startX;
		const dy = ev.clientY - this._draggingBar.startY;
		const maxLeft = Math.max(8, this._container.clientWidth - this._root.offsetWidth - 8);
		const maxTop = Math.max(8, this._container.clientHeight - this._root.offsetHeight - 8);
		const left = Math.max(8, Math.min(maxLeft, this._draggingBar.origLeft + dx));
		const top = Math.max(8, Math.min(maxTop, this._draggingBar.origTop + dy));
		this._customPos = { left, top };
		this._root.style.left = `${left}px`;
		this._root.style.top = `${top}px`;
	}

	private _onGripPointerUp(ev: PointerEvent): void {
		if (this._draggingBar && ev.pointerId === this._draggingBar.pointerId) {
			this._draggingBar = null;
		}
	}
}
