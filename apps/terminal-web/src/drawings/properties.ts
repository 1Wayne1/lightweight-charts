import { flipPosition, getToolDefinition, type DrawingManagerState, type DrawingStyleOptions, type WaveDegree } from '@tradingview/lwc-plugin-drawing-tools';
import { element, icon, iconButton, type IconName } from '../ui';
import { drawingIcon, toolIcon } from './icons';
import { toolLabel } from './catalog';
import { createAttachedTextEditor } from './text-editor';
import { propertyProfile } from './property-profile';
import { parseDrawingStyle } from './storage';
import { renderTradingViewColorPicker } from './color-picker';
import type { DrawingSession } from './session';
import './properties.css';

const STYLES = ['实线', '点线', '虚线', '长虚线', '稀疏点线'];
const DASHES = ['solid', 'dotted', 'dashed', 'dashed', 'dotted'];
const WAVE_DEGREES: ReadonlyArray<{ value: WaveDegree; short: string; label: string }> = [
	{ value: 'primary', short: '①', label: '主要 ①②③' },
	{ value: 'intermediate', short: '(1)', label: '中级 (1)(2)(3)' },
	{ value: 'minor', short: '1', label: '次级 1 2 3' },
	{ value: 'minute', short: '[i]', label: '微级 [i][ii][iii]' },
	{ value: 'minuette', short: '(i)', label: '细微 (i)(ii)(iii)' },
	{ value: 'subminuette', short: 'i', label: '极微 i ii iii' },
];
const button = (label: string, action: () => void, className = 'drawing-button') => {
	const node = element('button', className, label); node.type = 'button'; node.onclick = action; return node;
};
const lineSample = (width: number, style = 0) => {
	const sample = element('span', 'drawing-line-sample'); sample.style.borderTopWidth = `${width}px`; sample.style.borderTopStyle = DASHES[style]; return sample;
};

export function createDrawingProperties(app: HTMLElement, overlay: HTMLElement, getSession: () => DrawingSession | undefined, openObjects: () => void) {
	let state: DrawingManagerState | undefined;
	let signature = '';
	let popup: HTMLDivElement | undefined;
	let popupTrigger: HTMLElement | undefined;
	let liveColorEdit: { drawingId: string; key: 'color' | 'fillColor' | 'textColor' | 'backgroundColor'; underline: HTMLElement; recorded: boolean } | undefined;
	let applyingLiveColor = false;
	let revertDialogPreview: (() => void) | undefined;
	let dialogDrawingId: string | undefined;
	let customPosition: { left: number; top: number } | undefined;
	const manager = () => getSession()?.manager;
	const textEditor = createAttachedTextEditor(app, getSession);
	const bar = element('div', 'drawing-editbar'); bar.hidden = true; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', '绘图操作栏');
	const grip = button('', () => {}, 'drawing-bar-grip'); grip.setAttribute('aria-label', '移动绘图操作栏'); grip.title = '拖动操作栏 · 方向键移动';
	grip.append(element('span', '', '⠿'));
	const content = element('div', 'drawing-bar-content'); bar.append(grip, content); overlay.append(bar);
	bar.onkeydown = event => {
		if (event.target === grip || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
		const items = [...content.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]; if (!items.length) return;
		event.preventDefault(); const index = items.indexOf(document.activeElement as HTMLButtonElement);
		items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + items.length) % items.length].focus();
	};
	const dialog = element('dialog', 'drawing-properties-dialog'); dialog.setAttribute('aria-label', '绘图设置'); app.append(dialog);
	const history = element('div', 'drawing-history');
	const undo = iconButton('undo', '撤销画线', () => manager()?.undo());
	const redo = iconButton('redo', '重做画线', () => manager()?.redo());
	undo.title = '撤销画线 · ⌘/Ctrl Z'; redo.title = '重做画线 · ⌘/Ctrl Shift Z'; undo.disabled = true; redo.disabled = true;
	history.append(undo, redo); app.querySelector('.toolbar .spacer')?.before(history);

	function closePopup(restoreFocus = false): void {
		const trigger = popupTrigger;
		popup?.remove(); popup = undefined; popupTrigger = undefined; liveColorEdit = undefined;
		trigger?.setAttribute('aria-expanded', 'false');
		if (restoreFocus && trigger?.isConnected) trigger.focus();
	}
	function placePopup(x: number, y: number): void {
		if (!popup) return;
		const bounds = popup.getBoundingClientRect();
		popup.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`;
		popup.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`;
	}
	function placePopupForTrigger(trigger: HTMLElement, point?: { x: number; y: number }): void {
		if (!popup) return;
		if (point) {
			placePopup(point.x, point.y);
			return;
		}
		const rect = trigger.getBoundingClientRect();
		const bounds = popup.getBoundingClientRect();
		let x = rect.left;
		let y = rect.bottom + 6;
		if (dialog.open) {
			const footerRect = dialog.querySelector<HTMLElement>('.drawing-properties-footer')?.getBoundingClientRect();
			const clampedLeft = Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8));
			const clampedTop = Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8));
			const overlapsFooter =
				footerRect &&
				clampedLeft < footerRect.right &&
				clampedLeft + bounds.width > footerRect.left &&
				clampedTop < footerRect.bottom &&
				clampedTop + bounds.height > footerRect.top;
			if (overlapsFooter) {
				const dialogRect = dialog.getBoundingClientRect();
				if (dialogRect.right + 8 + bounds.width <= window.innerWidth - 8) {
					x = dialogRect.right + 8;
					y = rect.top;
				} else if (rect.top - bounds.height - 6 >= 8) {
					y = rect.top - bounds.height - 6;
				}
			}
		}
		placePopup(x, y);
	}
	function showPopup(trigger: HTMLElement, title: string, build: (body: HTMLDivElement) => void, point?: { x: number; y: number }, options?: { hideTitle?: boolean; className?: string }): void {
		if (popupTrigger === trigger && popup) { closePopup(true); return; }
		closePopup(); popupTrigger = trigger; trigger.setAttribute('aria-expanded', 'true');
		popup = element('div', `drawing-property-popover${options?.className ? ` ${options.className}` : ''}`); popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-label', title); popup.tabIndex = -1;
		if (!options?.hideTitle) popup.append(element('div', 'drawing-popover-title', title));
		build(popup);
		(dialog.open ? dialog : app).append(popup);
		placePopupForTrigger(trigger, point);
		popup.querySelector<HTMLElement>('[aria-checked=true], button, input')?.focus();
	}
	function colorPicker(trigger: HTMLButtonElement, label: string, current: string, onSelect: (value: string) => void, opacity?: { value: number; max: number; onSelect: (value: number) => void }): void {
		showPopup(trigger, label, body => {
			const container = element('div', 'tv-color-picker-host');
			body.append(container);
			renderTradingViewColorPicker({
				container,
				label,
				current,
				onSelect,
				opacity: opacity ? {
					...opacity,
					label: label === '文字颜色' ? '文字不透明度' : '不透明度',
				} : undefined,
				onResize: () => placePopupForTrigger(trigger),
			});
		}, undefined, { hideTitle: true, className: 'tv-color-popover' });
	}
	function patch(options: Partial<DrawingStyleOptions>): void {
		const drawing = manager()?.selectedDrawing();
		if (!drawing) return;
		manager()?.updateDrawingOptions(drawing.id, options);
		getSession()?.rememberStyle(drawing.type, options);
	}
	function action(name: IconName, label: string, run: () => void): HTMLButtonElement {
		const node = iconButton(name, label, run); node.className = 'drawing-property-button';
		if (name === 'settings') node.replaceChildren(drawingIcon('settings'));
		if (name === 'brush') node.replaceChildren(drawingIcon('pencil'));
		if (name === 'layers') node.replaceChildren(drawingIcon('fill'));
		content.append(node); return node;
	}
	function divider(): void { content.append(element('span', 'drawing-property-divider')); }
	function more(trigger: HTMLElement, point?: { x: number; y: number }): void {
		const drawing = manager()?.selectedDrawing(); if (!drawing) return;
		const options = drawing.options();
		showPopup(trigger, toolLabel(drawing.type), body => {
			const item = (name: IconName, label: string, run: () => void, disabled = false) => {
				const row = button('', () => { closePopup(); run(); }, 'drawing-property-menu-item'); row.disabled = disabled; row.append(icon(name), element('span', '', label)); body.append(row);
			};
			item('settings', '设置…', () => open());
			item('copy', '克隆', () => manager()?.cloneDrawing(drawing.id));
			item('lock', options.locked ? '解锁' : '锁定', () => patch({ locked: !options.locked }));
			item('eye', '隐藏', () => { patch({ visible: false }); manager()?.selectDrawing(null); });
			item('arrowUp', '置于 K 线上方', () => patch({ zOrder: 'top' }));
			item('arrowDown', '置于 K 线下方', () => patch({ zOrder: 'bottom' }));
			item('layers', '绘图对象…', openObjects);
			item('trash', '删除', () => manager()?.removeDrawing(drawing.id), options.locked);
		}, point);
	}
	function renderBar(): void {
		content.replaceChildren();
		const drawing = state?.selectedDrawing;
		if (!drawing) {
			const tool = state?.activeTool ? getToolDefinition(state.activeTool) : undefined;
			if (!tool) return;
			const label = element('span', 'drawing-creation-label', toolLabel(tool.type)); content.append(label);
			if (tool.creation === 'path') action('check', '完成路径', () => manager()?.finishDrawing());
			action('close', '退出绘图', () => manager()?.setActiveTool(null)); return;
		}
		const drawingId = drawing.id;
		const profile = propertyProfile(drawing.type); const options = drawing.options();
		const marker = element('span', 'drawing-object-marker'); marker.title = toolLabel(drawing.type); marker.append(toolIcon(drawing.type)); content.append(marker); divider();
		function color(key: 'color' | 'fillColor' | 'textColor' | 'backgroundColor', label: string, name: IconName): void {
			const underline = element('span', 'drawing-color-underline'); underline.style.backgroundColor = options[key];
			const commitLive = (nextPatch: Partial<DrawingStyleOptions>): void => {
				const active = manager()?.selectedDrawing();
				if (!active || active.id !== drawingId) return;
				const recordHistory = !liveColorEdit?.recorded;
				if (liveColorEdit) liveColorEdit.recorded = true;
				if (key in nextPatch && typeof nextPatch[key] === 'string') underline.style.backgroundColor = nextPatch[key];
				applyingLiveColor = true;
				try { manager()?.updateDrawingOptions(active.id, nextPatch, recordHistory); }
				finally { applyingLiveColor = false; }
				getSession()?.rememberStyle(active.type, nextPatch);
			};
			const control = action(name, label, () => {
				const currentOpts = manager()?.selectedDrawing()?.options() ?? options;
				colorPicker(
					control,
					label,
					currentOpts[key],
					value => commitLive({ [key]: value }),
					key === 'fillColor'
						? { value: currentOpts.fillOpacity, max: 1, onSelect: value => commitLive({ fillOpacity: value }) }
						: key === 'textColor'
							? { value: currentOpts.textOpacity, max: 1, onSelect: value => commitLive({ textOpacity: value }) }
							: undefined
				);
				if (popup && popupTrigger === control) liveColorEdit = { drawingId, key, underline, recorded: false };
			});
			control.classList.add('drawing-color-button'); control.setAttribute('aria-haspopup', 'dialog'); control.setAttribute('aria-expanded', 'false');
			control.append(underline);
		}
		if (profile.stroke) color('color', profile.attached === 'mark' ? '标记颜色' : profile.annotation ? '边框颜色' : '线条颜色', 'brush');
		if (profile.fill) color('fillColor', '填充颜色', 'layers');
		if (profile.textColor) color('textColor', '文字颜色', 'text');
		if (profile.background && profile.annotation) color('backgroundColor', '文字背景', 'layers');
		if (profile.width) {
			const width = button(`${options.lineWidth}px`, () => showPopup(width, '线宽', body => {
				for (const value of [1, 2, 3, 4, 6, 8, 16, 24, 32]) {
					const choice = button('', () => { closePopup(true); patch({ lineWidth: value }); }, 'drawing-property-menu-item'); choice.setAttribute('aria-label', `线宽 ${value}px`); choice.setAttribute('aria-pressed', String(options.lineWidth === value)); choice.append(lineSample(Math.min(value, 8)), element('span', '', `${value}px`)); body.append(choice);
				}
			}), 'drawing-property-button drawing-width-button'); width.setAttribute('aria-label', '线宽'); width.setAttribute('aria-haspopup', 'dialog'); content.append(width);
		}
		if (profile.lineStyle) {
			const style = button('', () => showPopup(style, '线型', body => {
				STYLES.forEach((label, value) => {
					const choice = button('', () => { closePopup(true); patch({ lineStyle: value }); }, 'drawing-property-menu-item'); choice.append(lineSample(2, value), element('span', '', label)); choice.setAttribute('aria-pressed', String(Number(options.lineStyle) === value)); body.append(choice);
				});
			}), 'drawing-property-button'); style.setAttribute('aria-label', '线型'); style.title = STYLES[options.lineStyle]; style.append(lineSample(2, options.lineStyle)); content.append(style);
		}
		if (profile.font) {
			const size = button(String(options.fontSize), () => showPopup(size, '字号', body => {
				for (const value of [8, 10, 12, 13, 14, 16, 20, 24, 28, 32, 40, 48, 72]) {
					const choice = button(String(value), () => { closePopup(true); patch({ fontSize: value }); }, 'drawing-property-menu-item'); choice.setAttribute('aria-label', `字号 ${value}`); choice.setAttribute('aria-pressed', String(value === options.fontSize)); body.append(choice);
				}
			}), 'drawing-property-button'); size.setAttribute('aria-label', '字号'); size.title = '字号'; content.append(size);
		}
		if (profile.text) {
			if (profile.primaryText || options.attachedText) {
				for (const [key, label, glyph] of [['textBold', '粗体', 'B'], ['textItalic', '斜体', 'I']] as const) {
					const toggle = button(glyph, () => patch({ [key]: !options[key] }), 'drawing-property-button'); toggle.setAttribute('aria-label', label); toggle.setAttribute('aria-pressed', String(options[key])); toggle.style.fontWeight = key === 'textBold' ? '700' : '400'; toggle.style.fontStyle = key === 'textItalic' ? 'italic' : 'normal'; content.append(toggle);
				}
			}
			const edit = action('text', profile.attached && !options.attachedText ? '添加文字' : '编辑文字', () => profile.attached ? textEditor.open(drawing, drawing.attachedTextTargets()[0]) : open('text')); edit.disabled = options.locked;
		}
		if (profile.wave) {
			const currentDegree = WAVE_DEGREES.find(d => d.value === options.waveDegree) ?? WAVE_DEGREES[1];
			const degree = button(currentDegree.short, () => showPopup(degree, '浪级样式', body => {
				for (const choiceSpec of WAVE_DEGREES) {
					const choice = button(choiceSpec.label, () => { closePopup(true); patch({ waveDegree: choiceSpec.value }); }, 'drawing-property-menu-item');
					choice.setAttribute('aria-pressed', String(options.waveDegree === choiceSpec.value));
					body.append(choice);
				}
			}), 'drawing-property-button drawing-text-chip');
			degree.setAttribute('aria-label', '浪级样式'); degree.title = `浪级：${currentDegree.label}`; degree.setAttribute('aria-haspopup', 'dialog');
			content.append(degree);
			const showLines = action('trend', options.waveShowLines ? '隐藏波浪连线' : '显示波浪连线', () => patch({ waveShowLines: !options.waveShowLines }));
			showLines.setAttribute('aria-pressed', String(options.waveShowLines));
		}
		if (profile.position) {
			const flip = action('swap', '反转多空', () => {
				const current = manager()?.selectedDrawing();
				if (!current || current.options().locked || (current.type !== 'long-position' && current.type !== 'short-position')) return;
				const flipped = flipPosition(current.type, current.points());
				manager()?.replaceDrawing(current.id, flipped.type, flipped.points);
			});
			flip.disabled = options.locked;
			const always = button('常显', () => patch({ alwaysShowStats: !options.alwaysShowStats }), 'drawing-property-button drawing-text-chip');
			always.setAttribute('aria-label', '始终显示统计'); always.title = '开启后即使未悬浮也在图形上显示目标/止损/盈亏比'; always.setAttribute('aria-pressed', String(options.alwaysShowStats));
			const compact = button('紧凑', () => patch({ compactStats: !options.compactStats }), 'drawing-property-button drawing-text-chip');
			compact.setAttribute('aria-label', '紧凑统计'); compact.title = '切换紧凑统计标签'; compact.setAttribute('aria-pressed', String(options.compactStats));
			content.append(always, compact);
		}
		if (profile.fibReverse) {
			const reverse = action('swap', '反转层级', () => {
				const current = manager()?.selectedDrawing();
				if (!current || current.options().locked) return;
				const pts = current.points();
				if (pts.length >= 2) manager()?.updateDrawing(current.id, { points: [pts[1], pts[0], ...pts.slice(2)] });
			});
			reverse.disabled = options.locked;
		}
		divider(); action('settings', '绘图设置', () => open());
		action('copy', '克隆画线', () => manager()?.cloneDrawing(drawing.id));
		const lock = action('lock', options.locked ? '解锁画线' : '锁定画线', () => patch({ locked: !options.locked })); lock.replaceChildren(drawingIcon(options.locked ? 'lock' : 'unlock')); lock.setAttribute('aria-pressed', String(options.locked));
		const remove = action('trash', '删除选中画线', () => manager()?.removeDrawing(drawing.id)); remove.disabled = options.locked;
		const overflow = action('more', '更多绘图操作', () => more(overflow)); overflow.setAttribute('aria-haspopup', 'dialog');
	}

	function open(preferredTab?: string): void {
		const drawing = manager()?.selectedDrawing(); const session = getSession(); if (!drawing || !session || dialog.open) return;
		textEditor.close(); closePopup(); dialogDrawingId = drawing.id;
		const profile = propertyProfile(drawing.type); const options = structuredClone(drawing.options());
		const draft = { color: options.color, fillColor: options.fillColor, textColor: options.textColor, backgroundColor: options.backgroundColor }; const fields = new Map<keyof DrawingStyleOptions, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>();
		let committed = false;
		const previewOption = (partial: Partial<DrawingStyleOptions>): void => {
			if (getSession() === session && session.manager.getDrawing(drawing.id)) drawing.applyOptions(partial);
		};
		revertDialogPreview = () => {
			if (!committed && getSession() === session && session.manager.getDrawing(drawing.id)) drawing.applyOptions(options);
		};
		dialog.replaceChildren();
		const heading = element('div', 'drawing-properties-heading'); heading.append(element('h2', '', toolLabel(drawing.type)), iconButton('close', '关闭绘图设置', () => dialog.close()));
		const form = element('form', 'drawing-properties-form'); form.noValidate = true;
		const tabs = element('div', 'drawing-property-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '绘图属性');
		const body = element('div', 'drawing-properties-body'); const panels = new Map<string, HTMLDivElement>(); const tabButtons = new Map<string, HTMLButtonElement>();
		function selectTab(id: string): void {
			closePopup();
			for (const [key, panel] of panels) { panel.hidden = key !== id; const tab = tabButtons.get(key)!; tab.setAttribute('aria-selected', String(key === id)); tab.tabIndex = key === id ? 0 : -1; }
		}
		function tab(id: string, label: string): HTMLDivElement {
			const control = button(label, () => selectTab(id), 'drawing-property-tab'); control.id = `drawing-tab-${id}`; control.setAttribute('role', 'tab'); control.setAttribute('aria-controls', `drawing-panel-${id}`);
			const panel = element('div', 'drawing-property-panel'); panel.id = `drawing-panel-${id}`; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', control.id);
			panels.set(id, panel); tabButtons.set(id, control); tabs.append(control); body.append(panel); return panel;
		}
		function row(panel: HTMLElement, label: string, input: HTMLElement): void { const wrapper = element('label', 'drawing-property-row'); wrapper.append(element('span', '', label), input); panel.append(wrapper); }
		function field(panel: HTMLElement, key: keyof DrawingStyleOptions, label: string, type = 'number', min?: number, max?: number, step = 'any'): void {
			const input = element('input'); input.type = type; input.setAttribute('aria-label', label); input.dataset.field = key;
			if (type === 'checkbox') input.checked = Boolean(options[key]); else { input.value = String(options[key]); input.required = true; }
			if (min !== undefined) input.min = String(min); if (max !== undefined) input.max = String(max); if (type === 'number') input.step = step;
			fields.set(key, input); row(panel, label, input);
		}
		function colorField(panel: HTMLElement, key: 'color' | 'fillColor' | 'textColor' | 'backgroundColor', label: string): void {
			const control = button('', () => colorPicker(control, label, draft[key], value => { draft[key] = value; swatch.style.backgroundColor = value; previewOption({ [key]: value }); }), 'drawing-settings-color');
			control.setAttribute('aria-label', label); control.setAttribute('aria-haspopup', 'dialog'); const swatch = element('span'); swatch.style.backgroundColor = draft[key]; control.append(swatch, icon('chevron')); row(panel, label, control);
		}
		function selectField(panel: HTMLElement, key: 'lineStyle' | 'zOrder' | 'textAlign' | 'textPosition' | 'textOrientation' | 'waveDegree', label: string, choices: readonly string[]): void {
			const select = element('select'); select.setAttribute('aria-label', label); fields.set(key, select);
			choices.forEach((name, i) => { const option = element('option', '', name); option.value = key === 'lineStyle' ? String(i) : ({ zOrder: ['top', 'normal', 'bottom'], textAlign: ['left', 'center', 'right'], textPosition: ['top', 'middle', 'bottom'], textOrientation: ['horizontal', 'vertical'], waveDegree: WAVE_DEGREES.map(d => d.value) }[key])[i]; select.append(option); }); select.value = String(options[key]); row(panel, label, select);
		}
		if (profile.position || profile.regression || profile.volume) {
			const inputs = tab('inputs', '输入');
			if (profile.position) { field(inputs, 'accountSize', '账户资金', 'number', 1, 1e12); field(inputs, 'riskPercent', '风险 (%)', 'number', .01, 100); field(inputs, 'alwaysShowStats', '始终显示统计', 'checkbox'); field(inputs, 'compactStats', '紧凑统计标签', 'checkbox'); }
			if (profile.regression) field(inputs, 'deviations', '标准差倍数', 'number', .1, 10);
			if (profile.volume) field(inputs, 'profileRows', '成交量分布行数', 'number', 4, 100, '1');
		}
		const style = tab('style', '样式');
		const strokeControls = element('div', 'drawing-stroke-controls');
		if (profile.stroke || profile.width || profile.lineStyle) style.append(strokeControls);
		if (profile.stroke) colorField(strokeControls, 'color', profile.attached === 'mark' ? '标记颜色' : profile.annotation ? '边框颜色' : '线条颜色');
		if (profile.width) field(strokeControls, 'lineWidth', '线宽', 'number', .5, 32, '.5');
		if (profile.lineStyle) selectField(strokeControls, 'lineStyle', '线型', STYLES);
		if (profile.fill) colorField(style, 'fillColor', profile.annotation ? '背景颜色' : '填充颜色');
		if (profile.opacity) field(style, 'fillOpacity', '填充不透明度', 'number', 0, drawing.type === 'fib-retracement' || drawing.type === 'fib-extension' ? .18 : 1, '.01');
		if (profile.extend) { field(style, 'extendLeft', '向左延伸', 'checkbox'); if (drawing.type !== 'horizontal-ray' && drawing.type !== 'pitchfan') field(style, 'extendRight', '向右延伸', 'checkbox'); }
		if (profile.midline) field(style, 'showMidline', '显示中线', 'checkbox');
		if (profile.wave) {
			selectField(style, 'waveDegree', '浪级样式', WAVE_DEGREES.map(d => d.label));
			field(style, 'waveShowLines', '显示波浪连线', 'checkbox');
		}
		if (profile.labels) field(style, 'showLabels', '显示标签 / 统计', 'checkbox');
		let levels: Array<{ value: HTMLInputElement; visible: HTMLInputElement; color: string; text: HTMLInputElement; originalText?: string }> | undefined;
		if (profile.levels) {
			levels = []; const section = element('div', 'drawing-levels'); section.append(element('h3', '', '斐波那契层级')); const list = element('div', 'drawing-level-list'); section.append(list);
			const appendLevel = (value: number, visible: boolean, color: string, originalText?: string) => {
				const row = element('div', 'drawing-level-row'); const input = element('input'); input.type = 'number'; input.step = 'any'; input.min = '-1000'; input.max = '1000'; input.required = true; input.value = String(value); input.setAttribute('aria-label', '层级比例');
				const checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.checked = visible; checkbox.setAttribute('aria-label', '显示层级');
				const text = element('input'); text.type = 'text'; text.value = originalText ?? ''; text.maxLength = 10000; text.placeholder = '添加文字'; text.setAttribute('aria-label', `层级 ${value} 文字`);
				const entry = { value: input, visible: checkbox, color, text, originalText }; levels!.push(entry); row.append(checkbox, input);
				if (profile.levelColors) {
					const swatch = button('', () => colorPicker(swatch, '层级颜色', entry.color, next => {
						entry.color = next; swatch.style.backgroundColor = next;
						previewOption({ fibLevels: levels!.map(level => ({ value: Number(level.value.value), visible: level.visible.checked, color: level.color, ...(profile.attached === 'levels' ? { text: level.text.value } : level.originalText !== undefined ? { text: level.originalText } : {}) })) });
					}), 'drawing-level-color'); swatch.style.backgroundColor = color; swatch.setAttribute('aria-label', '层级颜色'); row.append(swatch);
				}
				row.append(iconButton('close', '删除层级', () => { levels = levels!.filter(item => item !== entry); row.remove(); }));
				if (profile.attached === 'levels') { row.classList.add('drawing-level-with-text'); row.append(text); }
				list.append(row);
			};
			options.fibLevels.forEach(level => appendLevel(level.value, level.visible, level.color, level.text));
			section.append(button('＋ 添加层级', () => { if (levels!.length < 100) appendLevel(1, true, options.color); })); style.append(section);
		}
		if (profile.font || profile.text) {
			const textPanel = profile.text ? tab('text', '文字') : style;
			const textControls = element('div', 'drawing-text-controls'); textPanel.append(textControls);
			if (profile.attached) field(textControls, 'showText', '文字', 'checkbox');
			if (profile.textColor) colorField(textControls, 'textColor', '文字颜色');
			if (profile.font) field(textControls, 'fontSize', '字号', 'number', 8, 72, '1');
			if (profile.text) {
				for (const [key, label, glyph] of [['textBold', '粗体', 'B'], ['textItalic', '斜体', 'I']] as const) {
					const input = element('input'); input.type = 'checkbox'; input.checked = options[key]; input.hidden = true; fields.set(key, input);
					const toggle = button(glyph, () => { input.checked = !input.checked; toggle.setAttribute('aria-pressed', String(input.checked)); }, 'drawing-property-button'); toggle.setAttribute('aria-label', label); toggle.setAttribute('aria-pressed', String(input.checked)); toggle.style.fontWeight = key === 'textBold' ? '700' : '400'; toggle.style.fontStyle = key === 'textItalic' ? 'italic' : 'normal'; textControls.append(input, toggle);
				}
				const text = element('textarea'); const key = profile.attached ? 'attachedText' : 'text'; text.value = options[key]; text.maxLength = 10000; text.setAttribute('aria-label', '标注内容'); text.placeholder = '输入文字'; fields.set(key, text); textPanel.append(text);
				text.oninput = () => { const enabled = fields.get('showText'); if (enabled instanceof HTMLInputElement && text.value) enabled.checked = true; };
				const opacity = element('input'); opacity.type = 'range'; opacity.min = '0'; opacity.max = '100'; opacity.step = '1'; opacity.value = String(Math.round(options.textOpacity * 100)); opacity.setAttribute('aria-label', '文字不透明度'); fields.set('textOpacity', opacity);
				const amount = element('output', '', `${opacity.value}%`); const opacityControl = element('div', 'drawing-text-opacity'); opacityControl.append(opacity, amount); row(textPanel, '文字不透明度', opacityControl); opacity.oninput = () => { amount.value = `${opacity.value}%`; };
			}
			if (profile.background) colorField(profile.attached ? style : textPanel, 'backgroundColor', '标签背景');
			if (profile.attached && !['center', 'mark'].includes(profile.attached)) {
				const alignment = element('div', 'drawing-text-alignment'); textPanel.append(alignment);
				selectField(alignment, 'textPosition', '文字位置', profile.attached === 'channel' ? ['上方', '内部', '下方'] : ['上方', '居中', '下方']);
				selectField(alignment, 'textAlign', '文字对齐', profile.attached === 'vertical' ? ['顶部', '居中', '底部'] : ['左侧', '居中', '右侧']);
				if (profile.attached === 'vertical') selectField(textPanel, 'textOrientation', '文字方向', ['水平', '垂直']);
			}
		}

		const originalPoints = drawing.points().map(point => ({ ...point }));
		const coordinates: Array<{ time: HTMLInputElement; price: HTMLInputElement; originalTime: string; originalPrice: string }> = [];
		if (drawing.type === 'anchored-text' && options.anchorX !== undefined && options.anchorY !== undefined) {
			const coords = tab('coordinates', '位置'); field(coords, 'anchorX', '水平位置 (0–1)', 'number', -10, 10); field(coords, 'anchorY', '垂直位置 (0–1)', 'number', -10, 10);
		} else if (drawing.type !== 'anchored-text' && getToolDefinition(drawing.type).pointCount > 0 && originalPoints.every(point => typeof point.time === 'number')) {
			const coords = tab('coordinates', '坐标'); coords.append(element('p', 'drawing-property-note', '时间使用 UTC，可定位到未来空白区。'));
			originalPoints.forEach((point, i) => {
				const group = element('fieldset', 'drawing-coordinate'); group.append(element('legend', '', profile.position ? ['入场', '止损锚点', '目标锚点'][i] : `锚点 ${i + 1}`));
				const time = element('input'); time.type = 'datetime-local'; time.step = '.001'; time.required = true; time.value = new Date(Number(point.time) * 1000).toISOString().replace(/Z$/, ''); time.setAttribute('aria-label', `锚点 ${i + 1} 时间 (UTC)`);
				const price = element('input'); price.type = 'number'; price.step = 'any'; price.min = '-1000000000000000'; price.max = '1000000000000000'; price.required = true; price.value = String(point.price); price.setAttribute('aria-label', `锚点 ${i + 1} 价格`);
				row(group, '时间 (UTC)', time); row(group, '价格', price); coords.append(group); coordinates.push({ time, price, originalTime: time.value, originalPrice: price.value });
			});
		}
		const visibility = tab('visibility', '可见性'); field(visibility, 'visible', '显示画线', 'checkbox'); selectField(visibility, 'zOrder', '视觉顺序', ['K 线上方', '普通', 'K 线下方']);
		const footer = element('div', 'drawing-properties-footer'); const error = element('p', 'drawing-property-error'); error.setAttribute('role', 'alert');
		const cancel = button('取消', () => dialog.close()); const save = button('确定', () => {}, 'primary-button'); save.type = 'submit'; footer.append(error, cancel, save);
		form.append(tabs, body, footer); dialog.append(heading, form);
		form.onsubmit = event => {
			event.preventDefault();
			const invalid = Array.from(form.querySelectorAll<HTMLInputElement>('input')).find(input => !input.checkValidity());
			if (invalid) { for (const [id, panel] of panels) if (panel.contains(invalid)) selectTab(id); invalid.reportValidity(); return; }
			try {
				const changed: Record<string, unknown> = {};
				for (const [key, input] of fields) changed[key] = input instanceof HTMLInputElement && input.type === 'checkbox' ? input.checked : typeof options[key] === 'number' ? Number(input.value) / (key === 'textOpacity' ? 100 : 1) : input.value;
				for (const key of ['color', 'fillColor', 'textColor', 'backgroundColor'] as const) if (draft[key] !== options[key]) changed[key] = draft[key];
				if (levels) changed.fibLevels = levels.map(level => ({ value: Number(level.value.value), visible: level.visible.checked, color: level.color, ...(profile.attached === 'levels' ? { text: level.text.value } : level.originalText !== undefined ? { text: level.originalText } : {}) }));
				const patch = parseDrawingStyle(changed);
				const pointsChanged = coordinates.some(item => item.time.value !== item.originalTime || item.price.value !== item.originalPrice);
				const anchors = coordinates.map((item, i) => ({ time: item.time.value === item.originalTime ? Number(originalPoints[i].time) : Date.parse(`${item.time.value}Z`) / 1000, price: Number(item.price.value) }));
				if (pointsChanged && anchors.some(anchor => !Number.isFinite(anchor.time) || Math.abs(anchor.time) > 8e12)) throw new Error('请输入有效的 UTC 时间');
				if (getSession() !== session || !session.manager.getDrawing(drawing.id)) { dialog.close(); return; }
				const optionsChanged = Object.entries(patch).some(([key, value]) => JSON.stringify(value) !== JSON.stringify(options[key as keyof DrawingStyleOptions]));
				if (optionsChanged || pointsChanged) {
					// Restore the pre-preview options before committing so undo captures the original state.
					drawing.applyOptions(options);
					session.manager.updateDrawing(drawing.id, { options: patch, points: pointsChanged ? session.projectAnchors(anchors) : undefined });
					if (optionsChanged) session.rememberStyle(drawing.type, patch);
				}
				committed = true;
				dialog.close(); if (patch.visible === false) session.manager.selectDrawing(null);
			} catch (cause) { error.textContent = cause instanceof Error ? cause.message : '无法保存设置'; }
		};
		tabs.onkeydown = event => {
			if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
			event.preventDefault(); const keys = [...panels.keys()]; const index = [...tabButtons.values()].indexOf(document.activeElement as HTMLButtonElement);
			const next = event.key === 'Home' ? 0 : event.key === 'End' ? keys.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length;
			selectTab(keys[next]); tabButtons.get(keys[next])?.focus();
		};
		selectTab(preferredTab && panels.has(preferredTab) ? preferredTab : panels.keys().next().value!); dialog.showModal();
		if (preferredTab === 'text') fields.get(profile.attached ? 'attachedText' : 'text')?.focus();
	}

	function moveBar(left: number, top: number): void {
		customPosition = { left: Math.max(6, Math.min(left, overlay.clientWidth - bar.offsetWidth - 6)), top: Math.max(6, Math.min(top, overlay.clientHeight - bar.offsetHeight - 6)) };
		bar.style.left = `${customPosition.left}px`; bar.style.top = `${customPosition.top}px`;
	}
	let drag: { id: number; x: number; y: number; left: number; top: number } | undefined;
	grip.onpointerdown = event => {
		if (event.button !== 0) return; event.preventDefault(); closePopup(); const rect = bar.getBoundingClientRect(); const parent = overlay.getBoundingClientRect();
		drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left - parent.left, top: rect.top - parent.top }; grip.setPointerCapture(event.pointerId);
	};
	grip.onpointermove = event => { if (drag?.id === event.pointerId) moveBar(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y); };
	grip.onpointerup = () => { drag = undefined; }; grip.onpointercancel = () => { if (drag) moveBar(drag.left, drag.top); drag = undefined; };
	grip.onkeydown = event => {
		if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
		event.preventDefault(); moveBar(bar.offsetLeft + (event.key === 'ArrowLeft' ? -10 : event.key === 'ArrowRight' ? 10 : 0), bar.offsetTop + (event.key === 'ArrowUp' ? -10 : event.key === 'ArrowDown' ? 10 : 0));
	};
	const resize = new ResizeObserver(() => {
		if (customPosition && !bar.hidden) moveBar(customPosition.left, customPosition.top);
		if (popup) {
			if (!popupTrigger || !popupTrigger.isConnected || overlay.clientWidth <= 0 || popupTrigger === bar) closePopup();
			else placePopupForTrigger(popupTrigger);
		}
	}); resize.observe(overlay);
	const onPointer = (event: PointerEvent) => { if (popup && event.target instanceof Node && !popup.contains(event.target) && !popupTrigger?.contains(event.target)) closePopup(); };
	const onKey = (event: KeyboardEvent) => {
		if (!popup) return;
		if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closePopup(true); return; }
		if (event.target instanceof HTMLInputElement) return;
		if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
			const items = [...popup.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]; if (!items.length) return; event.preventDefault();
			const index = items.indexOf(document.activeElement as HTMLButtonElement); const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1) + items.length) % items.length; items[next].focus();
		}
	};
	const chartTarget = (event: MouseEvent) => event.target instanceof Element && event.target.closest('.chart-stage') && !manager()?.activeTool();
	const onDoubleClick = (event: MouseEvent) => { if (textEditor.isOpen() || !chartTarget(event)) return; const drawing = manager()?.drawingAt(event.clientX, event.clientY); if (drawing) { manager()?.selectDrawing(drawing.id); open(); } };
	const onContext = (event: MouseEvent) => {
		if (!chartTarget(event)) return; const drawing = manager()?.drawingAt(event.clientX, event.clientY); if (!drawing) return;
		event.preventDefault(); manager()?.selectDrawing(drawing.id); more(bar, { x: event.clientX, y: event.clientY });
	};
	const onTextPointer = (event: PointerEvent) => {
		if (event.button !== 0 || !event.isPrimary || !chartTarget(event) || dialog.open || textEditor.isOpen()) return;
		const hit = manager()?.textTargetAt(event.clientX, event.clientY); if (!hit || hit.drawing.options().locked) return;
		event.preventDefault(); event.stopImmediatePropagation(); manager()?.selectDrawing(hit.drawing.id); textEditor.open(hit.drawing, hit.target);
	};
	overlay.addEventListener('pointerdown', onTextPointer, true);
	dialog.addEventListener('close', () => {
		if (!dialog.open) {
			revertDialogPreview?.(); revertDialogPreview = undefined;
			dialogDrawingId = undefined;
		}
		if (popup && dialog.contains(popup)) closePopup();
	});
	document.addEventListener('pointerdown', onPointer, true); window.addEventListener('keydown', onKey, true);
	overlay.addEventListener('dblclick', onDoubleClick); overlay.addEventListener('contextmenu', onContext);
	return {
		open,
		update(next: DrawingManagerState, ready: boolean) {
			state = next; textEditor.update(); undo.disabled = !ready || !next.canUndo; redo.disabled = !ready || !next.canRedo;
			const visible = ready && Boolean(next.activeTool || next.selectedDrawing);
			bar.hidden = !visible;
			if (dialog.open && (!ready || dialogDrawingId !== next.selectedId)) dialog.close();
			const nextSignature = JSON.stringify([next.activeTool, next.selectedId, next.selectedDrawing?.options()]);
			if (applyingLiveColor && liveColorEdit && popup && visible && !next.activeTool && next.selectedId === liveColorEdit.drawingId && next.selectedDrawing) {
				signature = nextSignature;
				liveColorEdit.underline.style.backgroundColor = next.selectedDrawing.options()[liveColorEdit.key];
				return;
			}
			if (signature !== nextSignature || !visible) {
				const focusLabel = bar.contains(document.activeElement) ? document.activeElement?.getAttribute('aria-label') : null;
				closePopup(); signature = nextSignature; renderBar();
				if (focusLabel && visible) [...content.querySelectorAll<HTMLButtonElement>('button')].find(control => control.getAttribute('aria-label') === focusLabel)?.focus({ preventScroll: true });
				if (customPosition && visible) moveBar(customPosition.left, customPosition.top);
			}
		},
		close() { textEditor.close(); closePopup(); if (dialog.open) dialog.close(); bar.hidden = true; signature = ''; state = undefined; undo.disabled = true; redo.disabled = true; },
		destroy() { textEditor.close(); overlay.removeEventListener('pointerdown', onTextPointer, true); closePopup(); resize.disconnect(); document.removeEventListener('pointerdown', onPointer, true); window.removeEventListener('keydown', onKey, true); overlay.removeEventListener('dblclick', onDoubleClick); overlay.removeEventListener('contextmenu', onContext); dialog.remove(); bar.remove(); history.remove(); },
	};
}
