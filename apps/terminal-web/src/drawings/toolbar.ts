import type { DrawingManager, DrawingManagerState, DrawingToolType } from '@tradingview/lwc-plugin-drawing-tools';
import { element } from '../ui';
import { DRAWING_TOOL_GROUPS, sectionTools, toolLabel } from './catalog';
import { drawingIcon, toolIcon, type DrawingIconName } from './icons';

export type CursorMode = 'cross' | 'arrow';

export function createDrawingToolbar(app: HTMLElement, rail: HTMLElement, onCursorChange: (mode: CursorMode) => void) {
	let manager: DrawingManager | undefined;
	let ready = false;
	let state: DrawingManagerState | undefined;
	let cursorMode: CursorMode = 'cross';
	let openId = '';
	let menuAnchor: HTMLButtonElement | undefined;
	const controls: HTMLButtonElement[] = [];
	const groupButtons = new Map<string, { main: HTMLButtonElement; expand: HTMLButtonElement; row: HTMLDivElement; type: DrawingToolType }>();
	const root = element('div', 'drawing-toolbar'); root.setAttribute('role', 'toolbar'); root.setAttribute('aria-label', '绘图工具'); root.setAttribute('aria-orientation', 'vertical');
	const menu = element('div', 'drawing-flyout'); menu.id = 'drawing-tool-menu'; menu.hidden = true; menu.setAttribute('role', 'menu');
	app.append(menu); rail.append(root);
	const labelButton = (b: HTMLButtonElement, label: string): void => { b.title = label; b.setAttribute('aria-label', label); };
	const makeButton = (name: DrawingIconName, label: string, action: () => void): HTMLButtonElement => {
		const b = element('button', 'drawing-rail-button'); b.type = 'button'; labelButton(b, label); b.append(drawingIcon(name));
		b.onclick = () => { if (ready && manager) action(); }; controls.push(b); return b;
	};
	const divider = (): void => { root.append(element('div', 'drawing-rail-divider')); };
	function setMenuExpanded(anchor: HTMLButtonElement, expanded: boolean): void {
		const row = anchor.closest('.drawing-tool-slot');
		row?.classList.toggle('menu-open', expanded);
		for (const button of row?.querySelectorAll('button[aria-haspopup=menu]') ?? [anchor]) button.setAttribute('aria-expanded', String(expanded));
	}
	function closeMenu(restoreFocus = false): void {
		menu.hidden = true; openId = '';
		if (menuAnchor) setMenuExpanded(menuAnchor, false);
		if (restoreFocus) menuAnchor?.focus();
		menuAnchor = undefined;
	}
	function menuItems(): HTMLButtonElement[] { return Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')); }
	function positionMenu(anchor: HTMLElement): void {
		const rect = anchor.getBoundingClientRect();
		const railRect = rail.getBoundingClientRect(); const top = Math.max(8, railRect.top);
		menu.style.maxHeight = `${window.innerHeight - top - 8}px`;
		menu.style.left = `${Math.max(8, Math.min(railRect.right + 4, window.innerWidth - menu.offsetWidth - 8))}px`;
		menu.style.top = `${Math.max(top, Math.min(rect.top - 4, window.innerHeight - menu.offsetHeight - 8))}px`;
	}
	function showMenu(id: string, anchor: HTMLButtonElement, label: string, render: () => void): void {
		if (openId === id) { closeMenu(true); return; }
		closeMenu(); menu.replaceChildren(); menu.setAttribute('aria-label', label);
		openId = id; menuAnchor = anchor; setMenuExpanded(anchor, true);
		render(); menu.hidden = false; menu.scrollTop = 0; positionMenu(anchor);
		menuItems()[0]?.focus({ preventScroll: true });
	}
	function heading(label: string): void { const title = element('div', 'drawing-menu-heading', label); title.setAttribute('role', 'presentation'); menu.append(title); }
	function item(label: string, graphic: HTMLElement, action: () => void, checked?: boolean, disabled = false, shortcut = ''): HTMLButtonElement {
		const b = element('button', 'drawing-menu-item'); b.type = 'button'; b.disabled = disabled; b.tabIndex = -1;
		b.setAttribute('role', checked === undefined ? 'menuitem' : 'menuitemradio');
		if (checked !== undefined) b.setAttribute('aria-checked', String(checked));
		b.append(graphic, element('span', 'drawing-menu-label', label));
		if (shortcut) b.append(element('span', 'drawing-menu-shortcut', shortcut));
		if (checked) b.append(element('span', 'drawing-menu-check', '✓'));
		b.onclick = () => { closeMenu(true); if (ready && manager) action(); };
		menu.append(b); return b;
	}
	const menuButton = (b: HTMLButtonElement): HTMLButtonElement => {
		b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-expanded', 'false'); b.setAttribute('aria-controls', menu.id); return b;
	};
	const expandButton = (label: string, action: () => void): HTMLButtonElement => {
		const b = menuButton(makeButton('chevron', `展开${label}`, action)); b.classList.add('drawing-group-expand'); return b;
	};
	// An inactive group selects its displayed tool; an active group toggles its menu.
	function activateGroup(id: string, selected: boolean, select: () => void, expand: () => void): void {
		if (openId === id || !selected) select(); else expand();
	}
	const cursor = menuButton(makeButton('cross', '十字线光标 · Esc', () => activateGroup('cursor', !state?.activeTool, () => selectCursor(cursorMode), () => openCursorMenu(cursor))));
	const openCursorMenu = (anchor: HTMLButtonElement): void => showMenu('cursor', anchor, '光标', () => {
		heading('光标');
		item('十字线', drawingIcon('cross'), () => selectCursor('cross'), cursorMode === 'cross' && !state?.activeTool, false, 'Esc');
		item('箭头', drawingIcon('cursor'), () => selectCursor('arrow'), cursorMode === 'arrow' && !state?.activeTool);
	});
	const cursorExpand = expandButton('光标', () => openCursorMenu(cursorExpand));
	const cursorRow = element('div', 'drawing-tool-slot'); cursorRow.dataset.group = 'cursor'; cursorRow.append(cursor, cursorExpand); root.append(cursorRow);
	function selectCursor(mode: CursorMode): void {
		closeMenu(); cursorMode = mode; manager?.setActiveTool(null); onCursorChange(mode);
		if (state) sync(state);
	}
	function selectTool(type: DrawingToolType): void { closeMenu(); manager?.setActiveTool(type); }
	for (const group of DRAWING_TOOL_GROUPS) {
		const first = group.sections.flatMap(sectionTools)[0]; if (!first) continue;
		const row = element('div', 'drawing-tool-slot'); row.dataset.group = group.id;
		const main = menuButton(makeButton('line', toolLabel(first.type), () => {
			const type = groupButtons.get(group.id)!.type;
			activateGroup(group.id, state?.activeTool === type, () => selectTool(type), () => openGroupMenu(main));
		}));
		main.replaceChildren(toolIcon(first.type)); main.dataset.tool = first.type;
		const openGroupMenu = (anchor: HTMLButtonElement): void => showMenu(group.id, anchor, group.label, () => {
			for (const section of group.sections) {
				const definitions = sectionTools(section); if (!definitions.length) continue;
				heading(section.label);
				for (const def of definitions) {
					const b = item(toolLabel(def.type), toolIcon(def.type), () => selectTool(def.type), state?.activeTool === def.type);
					b.dataset.tool = def.type;
				}
			}
		});
		const expand = expandButton(group.label, () => openGroupMenu(expand));
		main.addEventListener('keydown', event => { if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); openGroupMenu(main); } });
		groupButtons.set(group.id, { main, expand, row, type: first.type }); row.append(main, expand); root.append(row);
	}
	cursor.addEventListener('keydown', event => { if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); openCursorMenu(cursor); } });
	divider();
	const measure = makeButton('ruler', '测量 · 价格与日期范围', () => selectTool('price-date-range'));
	const zoom = makeButton('zoom', '放大图表', () => {
		closeMenu(); const scale = manager?.chart().timeScale(); const range = scale?.getVisibleLogicalRange(); if (!range) return;
		const inset = (range.to - range.from) * .2; scale?.setVisibleLogicalRange({ from: range.from + inset, to: range.to - inset });
	}); root.append(measure, zoom); divider();
	const magnet = makeButton('magnet', '磁吸：关闭', () => { closeMenu(); manager?.cycleMagnetMode(); onCursorChange(cursorMode); });
	const magnetBadge = element('span', 'drawing-mode-badge'); magnetBadge.hidden = true; magnet.append(magnetBadge);
	const magnetExpand = expandButton('磁吸模式', () => showMenu('magnet', magnetExpand, '磁吸模式', () => {
		heading('磁吸模式');
		for (const [mode, label] of [['off', '关闭'], ['weak', '弱磁吸'], ['strong', '强磁吸']] as const) {
			item(label, drawingIcon('magnet'), () => { manager?.setMagnetMode(mode); onCursorChange(cursorMode); }, state?.magnetMode === mode);
		}
	}));
	const magnetRow = element('div', 'drawing-tool-slot'); magnetRow.append(magnet, magnetExpand);
	const stay = makeButton('stay', '保持绘图模式', () => { closeMenu(); manager?.setStayInDrawingMode(!state?.stayInDrawingMode); });
	const lock = makeButton('unlock', '锁定所有画线', () => {
		closeMenu(); if (!manager) return;
		const drawings = manager.exportState().drawings;
		const locked = !drawings.every(d => d.options.locked);
		manager.importState(drawings.map(d => ({ ...d, options: { ...d.options, locked } })));
	});
	const hide = makeButton('eye', '隐藏所有画线', () => { closeMenu(); manager?.setDrawingsVisible(!state?.drawingsVisible); });
	const remove = makeButton('trash', '删除画线', () => showMenu('remove', remove, '删除画线', () => {
		heading('删除画线');
		item('删除选中画线', drawingIcon('trash'), () => { if (state?.selectedId && !state.selectedDrawing?.options().locked) manager?.removeDrawing(state.selectedId); }, undefined, !state?.selectedId || Boolean(state.selectedDrawing?.options().locked), 'Del');
		const locked = manager?.drawings().some(d => d.options().locked);
		item(locked ? '删除所有未锁定画线' : '删除所有画线', drawingIcon('trash'), () => {
			if (manager) manager.importState(manager.exportState().drawings.filter(d => d.options.locked));
		}, undefined, !manager?.drawings().some(d => !d.options().locked));
	})); remove.setAttribute('aria-haspopup', 'menu'); remove.setAttribute('aria-expanded', 'false'); remove.setAttribute('aria-controls', menu.id);
	root.append(magnetRow, stay, lock, hide); divider(); root.append(remove);

	function sync(next?: DrawingManagerState): void {
		state = next;
		for (const b of controls) b.disabled = !ready || !manager;
		const activeTool = next?.activeTool;
		cursor.replaceChildren(drawingIcon(cursorMode === 'cross' ? 'cross' : 'cursor'));
		labelButton(cursor, `${cursorMode === 'cross' ? '十字线' : '箭头'}光标 · Esc`); cursor.setAttribute('aria-pressed', String(!activeTool));
		for (const group of DRAWING_TOOL_GROUPS) {
			const buttons = groupButtons.get(group.id); if (!buttons) continue;
			const active = Boolean(activeTool && group.sections.some(section => section.tools.includes(activeTool)));
			if (active && activeTool && buttons.type !== activeTool) {
				buttons.type = activeTool; buttons.main.dataset.tool = activeTool; buttons.main.replaceChildren(toolIcon(activeTool)); labelButton(buttons.main, toolLabel(activeTool));
			}
			buttons.main.setAttribute('aria-pressed', String(active));
		}
		measure.setAttribute('aria-pressed', String(activeTool === 'price-date-range'));
		const magnetMode = next?.magnetMode ?? 'off';
		labelButton(magnet, `磁吸：${{ off: '关闭', weak: '弱', strong: '强' }[magnetMode]}`);
		magnet.setAttribute('aria-pressed', String(magnetMode !== 'off')); magnetBadge.hidden = magnetMode === 'off'; magnetBadge.textContent = magnetMode === 'weak' ? '弱' : '强';
		stay.setAttribute('aria-pressed', String(Boolean(next?.stayInDrawingMode)));
		const allLocked = Boolean(next?.count && manager?.drawings().every(d => d.options().locked));
		lock.disabled ||= !next?.count; lock.setAttribute('aria-pressed', String(allLocked)); lock.replaceChildren(drawingIcon(allLocked ? 'lock' : 'unlock')); labelButton(lock, allLocked ? '解锁所有画线' : '锁定所有画线');
		const hidden = next?.drawingsVisible === false; hide.setAttribute('aria-pressed', String(hidden)); hide.replaceChildren(drawingIcon(hidden ? 'eyeOff' : 'eye')); labelButton(hide, hidden ? '显示所有画线' : '隐藏所有画线');
		remove.disabled ||= !next?.count;
	}
	const outside = (event: PointerEvent): void => { if (event.target instanceof Node && !menu.contains(event.target) && !root.contains(event.target)) closeMenu(); };
	const toolbarKeydown = (event: KeyboardEvent): void => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); };
	const keydown = (event: KeyboardEvent): void => {
		if (menu.hidden) return;
		// Menu keys must not reach the chart's Enter/Delete/undo shortcuts.
		if (event.target instanceof Node && menu.contains(event.target)) event.stopPropagation();
		if (event.key === 'Escape' || event.key === 'ArrowLeft') { event.preventDefault(); event.stopPropagation(); closeMenu(true); return; }
		if (event.key === 'Tab') { closeMenu(true); return; }
		const items = menuItems(); const index = items.findIndex(b => b === document.activeElement);
		const next = event.key === 'ArrowDown' ? (index + 1) % items.length : event.key === 'ArrowUp' ? (index - 1 + items.length) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : -1;
		if (next >= 0) { event.preventDefault(); event.stopPropagation(); items[next]?.focus(); }
	};
	const reposition = (): void => closeMenu();
	document.addEventListener('pointerdown', outside); document.addEventListener('keydown', keydown, true);
	root.addEventListener('keydown', toolbarKeydown);
	window.addEventListener('resize', reposition); rail.addEventListener('scroll', reposition);
	sync();
	return {
		update: sync,
		attach(next?: DrawingManager) { closeMenu(); manager = next; ready = false; sync(next?.getState()); },
		setReady(value: boolean) { ready = value; if (!value) closeMenu(); sync(state); },
		destroy() {
			document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', keydown, true); window.removeEventListener('resize', reposition); rail.removeEventListener('scroll', reposition);
			menu.remove(); root.remove();
		},
	};
}
