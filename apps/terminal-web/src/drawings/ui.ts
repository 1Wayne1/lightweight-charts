import { TOOL_DEFINITIONS, getToolDefinition, type DrawingManagerState } from '@tradingview/lwc-plugin-drawing-tools';
import { element, iconButton } from '../ui';
import { DRAWING_TOOL_GROUPS, FEATURED_TOOLS, sectionTools, toolLabel } from './catalog';
import { toolIcon } from './icons';
import { createDrawingProperties } from './properties';
import { createDrawingToolbar, type CursorMode } from './toolbar';
import type { DrawingSession } from './session';
import './drawing.css';

export function createDrawingUI(
	app: HTMLElement,
	rail: HTMLElement,
	overlay: HTMLElement,
	onToolChange?: (active: boolean) => void,
	onCursorChange: (mode: CursorMode) => void = () => {},
	onHistoryChange?: (canUndo: boolean, canRedo: boolean) => void,
) {
	let session: DrawingSession | undefined;
	let unsubscribe: (() => void) | undefined;
	let state: DrawingManagerState | undefined;
	let ready = false;
	const manager = () => session?.manager;
	const button = (label: string, action: () => void): HTMLButtonElement => { const b = element('button', 'drawing-button', label); b.type = 'button'; b.onclick = action; return b; };
	const toolbar = createDrawingToolbar(app, rail, onCursorChange);
	const dialog = (title: string): { dialog: HTMLDialogElement; body: HTMLDivElement } => {
		const dialog = element('dialog', 'drawing-dialog');
		dialog.tabIndex = -1;
		const head = element('div', 'dialog-heading');
		head.append(element('h2', '', title), iconButton('close', `关闭${title}`, () => dialog.close()));
		const body = element('div', 'drawing-dialog-body'); dialog.append(head, body); app.append(dialog);
		return { dialog, body };
	};
	const tools = dialog('绘图工具');
	const search = element('input', 'drawing-search'); search.placeholder = '搜索绘图工具'; search.setAttribute('aria-label', '搜索绘图工具');
	const catalog = element('div', 'drawing-catalog'); tools.body.append(search, catalog);
	function appendToolSection(title: string, defs: readonly (typeof TOOL_DEFINITIONS)[number][]): void {
		const section = element('section', 'drawing-group'); section.append(element('h3', '', title));
		const grid = element('div', 'drawing-tool-grid');
		for (const def of defs) {
			const choice = button('', () => { if (ready) manager()?.setActiveTool(def.type); tools.dialog.close(); });
			choice.append(toolIcon(def.type), element('span', '', toolLabel(def.type)));
			choice.dataset.tool = def.type; choice.setAttribute('aria-pressed', String(state?.activeTool === def.type));
			grid.append(choice);
		}
		section.append(grid); catalog.append(section);
	}
	function renderTools(): void {
		catalog.replaceChildren();
		const query = search.value.trim().toLowerCase();
		if (!query) appendToolSection('常用工具', FEATURED_TOOLS.map(type => getToolDefinition(type)));
		for (const group of DRAWING_TOOL_GROUPS) {
			const sections = group.sections.map(section => ({ label: section.label, definitions: sectionTools(section).filter(def => `${toolLabel(def.type)} ${def.label} ${def.type} ${group.label} ${section.label}`.toLowerCase().includes(query)) })).filter(section => section.definitions.length);
			if (!sections.length) continue;
			catalog.append(element('h2', 'drawing-catalog-title', group.label));
			for (const section of sections) appendToolSection(section.label, section.definitions);
		}
		if (!catalog.childElementCount) catalog.append(element('p', 'drawing-empty', '没有找到匹配的绘图工具'));
	}
	function openTools(): void { if (!session || !ready) return; search.value = ''; renderTools(); tools.dialog.showModal(); tools.dialog.focus({ preventScroll: true }); }
	search.oninput = renderTools;

	const properties = createDrawingProperties(app, overlay, () => session, () => openObjects());
	const hint = element('div', 'drawing-hint'); hint.hidden = true;
	const saveStatus = element('div', 'drawing-save-status'); saveStatus.setAttribute('role', 'status'); saveStatus.hidden = true;
	overlay.append(hint, saveStatus);

	const objects = dialog('绘图对象');
	function renderObjects(): void {
		objects.body.replaceChildren();
		for (const drawing of manager()?.drawings() ?? []) {
			const row = element('div', 'drawing-object');
			row.append(button(getToolDefinition(drawing.type).shortLabel, () => { manager()?.selectDrawing(drawing.id); objects.dialog.close(); properties.open(); }),
				button(drawing.options().visible ? '隐藏' : '显示', () => manager()?.updateDrawingOptions(drawing.id, { visible: !drawing.options().visible })),
				button(drawing.options().locked ? '解锁' : '锁定', () => manager()?.updateDrawingOptions(drawing.id, { locked: !drawing.options().locked })),
				button('删除', () => { if (!drawing.options().locked) manager()?.removeDrawing(drawing.id); }));
			objects.body.append(row);
		}
		if (!state?.count) objects.body.append(element('p', '', '该交易对还没有画线'));
		objects.body.append(button('导出画线备份', () => {
			if (!session) return;
			const blob = new Blob([JSON.stringify(session.exportStore(), null, 2)], { type: 'application/json' });
			const url = URL.createObjectURL(blob); const link = element('a'); link.href = url; link.download = 'crypto-terminal-drawings.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
		}));
	}
	function openObjects(): void { if (!session) return; renderObjects(); objects.dialog.showModal(); objects.dialog.focus({ preventScroll: true }); }
	function update(next: DrawingManagerState): void {
		state = next; const tool = next.activeTool ? getToolDefinition(next.activeTool) : undefined;
		toolbar.update(next);
		onToolChange?.(Boolean(tool));
		onHistoryChange?.(ready && next.canUndo, ready && next.canRedo);
		properties.update(next, ready);
		hint.hidden = !tool;
		hint.textContent = tool
			? (tool.creation === 'freehand'
				? '按住拖动画线，松手完成'
				: tool.creation === 'path'
					? '依次点选路径，点“完成路径”或按 Enter 完成'
					: tool.pointCount === 1
						? `${tool.shortLabel} · 点击或按住拖动定位后松手`
						: tool.pointCount === 2
							? `${tool.shortLabel} · 点击两点或按住拖动绘制`
							: `${tool.shortLabel} · 依次点选 ${tool.pointCount} 个锚点${tool.type.includes('position') ? '：入场、止损、目标' : ''}`)
			: '';
		if (objects.dialog.open) renderObjects();
	}
	return {
		openTools: () => openTools(), openObjects,
		setReady(nextReady: boolean) {
			ready = nextReady;
			toolbar.setReady(ready);
			if (state) update(state);
		},
		setStatus(message: string, error: boolean) {
			const show = error && Boolean(message);
			saveStatus.textContent = show ? message : '';
			saveStatus.classList.toggle('error', show);
			saveStatus.hidden = !show;
		},
		attach(next?: DrawingSession) {
			unsubscribe?.(); properties.close(); session = next; state = undefined; ready = false;
			toolbar.attach(next?.manager);
			onToolChange?.(false);
			onHistoryChange?.(false, false);

			if (next) {
				const stateUnsub = next.manager.subscribeStateChange(update);
				const textUnsub = next.manager.subscribeTextEdit(() => properties.open('text'));
				unsubscribe = () => { stateUnsub(); textUnsub(); };
			} else { hint.hidden = true; saveStatus.textContent = ''; saveStatus.hidden = true; }
			for (const item of [tools, objects]) if (item.dialog.open) item.dialog.close();
		},
		destroy() { unsubscribe?.(); toolbar.destroy(); properties.destroy(); for (const item of [tools, objects]) item.dialog.remove(); hint.remove(); saveStatus.remove(); },
	};
}
