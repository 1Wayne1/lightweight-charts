import { type AttachedTextTarget, type BaseDrawing } from '@tradingview/lwc-plugin-drawing-tools';
import { element, iconButton } from '../ui';
import type { DrawingSession } from './session';

/** One draft, one undo entry. No writes until confirmation or an outside click. */
export function createAttachedTextEditor(app: HTMLElement, getSession: () => DrawingSession | undefined) {
	let close: (() => void) | undefined;
	let validate: (() => void) | undefined;
	function open(drawing: BaseDrawing, target?: AttachedTextTarget): void {
		close?.();
		const session = getSession(); if (!session || drawing.options().locked) return;
		const options = drawing.options(), index = target?.levelIndex;
		const original = index === undefined ? options.attachedText : options.fibLevels[index]?.text ?? '';
		const root = element('div', 'drawing-inline-text'); root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', index === undefined ? '编辑对象文字' : `编辑 ${options.fibLevels[index].value} 层级文字`);
		const input = element('textarea'); input.setAttribute('aria-label', '附加文字'); input.placeholder = '添加文字'; input.maxLength = 10000; input.value = original;
		input.style.color = target?.color ?? options.textColor; input.style.fontSize = `${options.fontSize}px`; input.style.fontWeight = options.textBold ? '700' : '400'; input.style.fontStyle = options.textItalic ? 'italic' : 'normal'; input.style.textAlign = options.textAlign;
		const footer = element('div', 'drawing-inline-text-footer'); const hint = element('span', '', 'Enter 确定 · Shift Enter 换行'); footer.append(hint);
		let frame = 0; let finished = false; let composing = false;
		function finish(save: boolean): void {
			if (finished) return; finished = true;
			cancelAnimationFrame(frame); document.removeEventListener('pointerdown', outside, true); root.remove(); close = undefined; validate = undefined;
			if (!save || getSession() !== session || session!.manager.getDrawing(drawing.id) !== drawing || drawing.options().locked) return;
			if (input.value === original) return;
			if (index === undefined) session!.manager.updateDrawingOptions(drawing.id, { attachedText: input.value, showText: true });
			else session!.manager.updateDrawingOptions(drawing.id, { showText: true, fibLevels: drawing.options().fibLevels.map((level, i) => i === index ? { ...level, text: input.value } : { ...level }) });
		}
		const cancel = iconButton('close', '取消文字编辑', () => finish(false)), save = iconButton('check', '保存文字', () => finish(true)); footer.append(cancel, save); root.append(input, footer); app.append(root);
		const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.contains(event.target)) finish(true); };
		input.addEventListener('compositionstart', () => { composing = true; }); input.addEventListener('compositionend', () => { composing = false; });
		input.onkeydown = event => {
			if (composing || event.isComposing) return;
			if (event.key === 'Escape' || (event.key === 'Enter' && !event.shiftKey)) { event.preventDefault(); event.stopPropagation(); finish(event.key === 'Enter'); }
		};
		root.onkeydown = event => { if (event.key === 'Escape' && !composing && !event.isComposing) { event.preventDefault(); event.stopPropagation(); finish(false); } };
		const resizeInput = () => { input.style.height = 'auto'; input.style.height = `${Math.min(180, Math.max(44, input.scrollHeight))}px`; };
		input.oninput = resizeInput;
		function position(): void {
			if (finished) return;
			const current = drawing.attachedTextTargets().find(item => item.levelIndex === index) ?? target;
			const point = session!.manager.paneToClient(current ?? drawing.screenPoints().find(p => p !== null) ?? { x: 30, y: 120 });
			const viewport = window.visualViewport; const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
			const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight;
			root.style.maxWidth = `${Math.max(160, width - 16)}px`;
			root.style.left = `${Math.max(left + 8, Math.min(point.x, left + width - root.offsetWidth - 8))}px`;
			root.style.top = `${Math.max(top + 8, Math.min(point.y, top + height - root.offsetHeight - 8))}px`;
			frame = requestAnimationFrame(position);
		}
		close = () => finish(false);
		validate = () => { if (getSession() !== session || session.manager.selectedDrawing() !== drawing || !drawing.isRenderVisible() || drawing.options().locked) finish(false); };
		document.addEventListener('pointerdown', outside, true); resizeInput(); position(); input.focus({ preventScroll: true }); input.setSelectionRange(input.value.length, input.value.length);
	}
	return { open, close: () => close?.(), update: () => validate?.(), isOpen: () => Boolean(close) };
}
