import { CrosshairMode, type Time } from 'lightweight-charts';
import { element, iconButton } from '../ui';
import type { TerminalChart } from '../chart';
import type { DrawingSession } from './session';
import './price-axis-shortcut.css';

/** A price-axis affordance; the drawing itself still belongs to the active session. */
export function createPriceAxisShortcut(overlay: HTMLElement, chart: TerminalChart, session: DrawingSession) {
	const row = element('div', 'price-axis-shortcut'); row.hidden = true;
	const button = iconButton('plus', '绘制水平线'); button.className = 'price-axis-shortcut-button';
	button.append(element('span', 'price-axis-shortcut-tooltip', '绘制水平线'));
	row.append(button); overlay.append(row);
	let pointer: { x: number; y: number; touch: boolean } | undefined;
	let candidate: { price: number; text: string } | undefined;
	let pressed: { price: number; text: string; x: number; y: number; id: number } | undefined;
	let touchStart: { x: number; y: number; id: number } | undefined;
	let frozen = false;
	let frame: number | undefined;
	let destroyed = false;
	let crosshairTime: Time | undefined;
	let savedCrosshair: {
		mode: CrosshairMode;
		vertLine: { visible: boolean; labelVisible: boolean };
		horzLine: { visible: boolean; labelVisible: boolean };
	} | undefined;

	function pinCrosshair(): void {
		if (candidate && crosshairTime !== undefined) chart.chart.setCrosshairPosition(candidate.price, crosshairTime, chart.series);
	}

	function hide(): void {
		row.hidden = true; pointer = undefined; candidate = undefined; pressed = undefined; frozen = false;
		crosshairTime = undefined;
		if (frame !== undefined) cancelAnimationFrame(frame); frame = undefined;
		if (savedCrosshair) {
			const restore = savedCrosshair; savedCrosshair = undefined;
			chart.chart.clearCrosshairPosition(); chart.chart.applyOptions({ crosshair: restore });
		}
	}
	function render(): void {
		if (destroyed || !pointer) return;
		const pane = chart.series.getPane();
		const bounds = pane.getHTMLElement()?.getBoundingClientRect();
		const parent = overlay.getBoundingClientRect();
		if (!session.isReady() || session.manager.activeTool() || !session.manager.drawingsVisible() || !pane.visible() || !bounds || bounds.height <= 0 || parent.width <= 0 || document.querySelector('dialog[open]')) { hide(); return; }
		const axisWidth = pane.priceScale('right').width();
		const right = bounds.right - axisWidth;
		const left = bounds.left + pane.priceScale('left').width();
		const { fontSize } = chart.chart.options().layout;
		// Match the chart's crosshair label padding and device-pixel rounding.
		const ratio = window.devicePixelRatio || 1;
		let height = Math.round(fontSize * 1.75 * ratio);
		if (height % 2 !== Math.max(1, Math.floor(ratio)) % 2) height++;
		const size = height / ratio;
		const localY = pointer.y - bounds.top;
		if (axisWidth <= 0 || right <= left || pointer.x < right - size || pointer.x > bounds.right || localY < size / 2 || localY > pane.getHeight() - size / 2) { hide(); return; }
		if (!frozen || !candidate) {
			const raw = chart.series.coordinateToPrice(localY);
			const format = chart.series.options().priceFormat;
			const minMove = format.minMove;
			if (raw === null || !Number.isFinite(raw) || !Number.isFinite(minMove) || minMove <= 0) { hide(); return; }
			const precision = format.type === 'price' ? format.precision ?? 2 : 8;
			const price = Number((Math.round(raw / minMove) * minMove).toFixed(Math.min(16, precision)));
			if (price <= 0 || price > 1e15) { hide(); return; }
			candidate = { price, text: chart.series.priceFormatter().format(price) };
		}
		const y = chart.series.priceToCoordinate(candidate.price);
		if (y === null || y < size / 2 || y > pane.getHeight() - size / 2) { hide(); return; }
		crosshairTime = chart.chart.timeScale().getVisibleRange()?.to;
		if (crosshairTime === undefined) { hide(); return; }
		if (!savedCrosshair) {
			const { mode, vertLine, horzLine } = chart.chart.options().crosshair;
			savedCrosshair = {
				mode,
				vertLine: { visible: vertLine.visible, labelVisible: vertLine.labelVisible },
				horzLine: { visible: horzLine.visible, labelVisible: horzLine.labelVisible },
			};
			// Keep the native Canvas price label, including font metrics and pixel alignment.
			chart.chart.applyOptions({ crosshair: { mode: CrosshairMode.Normal, vertLine: { visible: false, labelVisible: false }, horzLine: { visible: true, labelVisible: true } } });
		}
		pinCrosshair();
		row.hidden = false; row.classList.toggle('is-touch', pointer.touch);
		const mid = Math.round(y * ratio) - Math.floor(ratio * .5);
		const top = Math.floor(mid + Math.max(1, Math.floor(ratio)) / 2 - height / 2) / ratio;
		row.style.top = `${bounds.top - parent.top + top}px`;
		row.style.left = `${right - parent.left - size}px`;
		row.style.setProperty('--shortcut-size', `${size}px`);
		button.setAttribute('aria-label', `在 ${candidate.text} 绘制水平线`);
		button.title = `在 ${candidate.text} 绘制水平线`;
	}
	function tick(): void {
		frame = undefined; render();
		if (!row.hidden && !destroyed) frame = requestAnimationFrame(tick);
	}
	function show(x: number, y: number, touch: boolean): void {
		pointer = { x, y, touch }; frozen = false; render();
		if (!row.hidden && frame === undefined) frame = requestAnimationFrame(tick);
	}
	function onMove(event: PointerEvent): void {
		if (event.pointerType === 'touch') return;
		// Hovering the button follows the pointer just like hovering the price axis.
		// Only a press freezes the chosen price; drag cancellation is handled below.
		if (pressed) return;
		if (event.buttons || !(event.target instanceof Element) || (!button.contains(event.target) && !event.target.closest('.chart-stage'))) { hide(); return; }
		show(event.clientX, event.clientY, false);
	}
	function onDown(event: PointerEvent): void {
		if (!event.isPrimary) { onCancel(); return; }
		if (button.contains(event.target as Node)) return;
		hide();
		if (event.pointerType === 'touch' && event.isPrimary && event.target instanceof Element && event.target.closest('.chart-stage')) touchStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
		else touchStart = undefined;
	}
	function onUp(event: PointerEvent): void {
		if (pressed?.id === event.pointerId) {
			const bounds = button.getBoundingClientRect();
			const touchInset = pointer?.touch ? (40 - bounds.height) / 2 : 0;
			if (event.clientX < bounds.left - touchInset * 2 || event.clientX > bounds.right || event.clientY < bounds.top - touchInset || event.clientY > bounds.bottom + touchInset) hide();
		}
		const start = touchStart; touchStart = undefined;
		if (start?.id === event.pointerId && Math.hypot(start.x - event.clientX, start.y - event.clientY) < 6) show(event.clientX, event.clientY, true);
	}
	function onPressMove(event: PointerEvent): void {
		// A drag must stay cancelled even if the pointer returns to its starting point.
		if (touchStart?.id === event.pointerId && Math.hypot(touchStart.x - event.clientX, touchStart.y - event.clientY) >= 6) touchStart = undefined;
		if (pressed?.id === event.pointerId && Math.hypot(pressed.x - event.clientX, pressed.y - event.clientY) >= 6) hide();
	}
	function onLeave(): void { if (!pointer?.touch && document.activeElement !== button && !pressed) hide(); }
	function onCancel(): void { touchStart = undefined; hide(); }
	function onKey(event: KeyboardEvent): void { if (event.key === 'Escape') hide(); }
	button.onpointerdown = event => {
		if (event.button !== 0 || !event.isPrimary || !candidate) return;
		event.stopPropagation(); frozen = true;
		pressed = { ...candidate, x: event.clientX, y: event.clientY, id: event.pointerId };
		button.focus({ preventScroll: true });
	};
	button.onclick = event => {
		event.stopPropagation(); const target = pressed ?? candidate;
		if (!target || destroyed || row.hidden) return;
		session.addHorizontalLine(target.price); hide();
	};
	button.onpointercancel = onCancel;
	button.onfocus = () => { frozen = true; };
	button.onblur = () => { if (!button.matches(':hover')) hide(); };
	const unsubscribe = session.manager.subscribeStateChange(() => { if (!row.hidden) render(); });
	// The chart clears its crosshair when the pointer enters our DOM button.
	// Re-pin synchronously so the same native label survives that mouseleave.
	chart.chart.subscribeCrosshairMove(pinCrosshair);
	overlay.addEventListener('pointermove', onMove);
	overlay.addEventListener('pointerleave', onLeave);
	document.addEventListener('pointerdown', onDown, true);
	window.addEventListener('pointerup', onUp);
	window.addEventListener('pointermove', onPressMove);
	window.addEventListener('pointercancel', onCancel);
	window.addEventListener('blur', onCancel);
	window.addEventListener('keydown', onKey);
	overlay.addEventListener('wheel', onCancel, { passive: true });
	return {
		destroy() {
			destroyed = true; hide(); unsubscribe(); row.remove();
			chart.chart.unsubscribeCrosshairMove(pinCrosshair);
			overlay.removeEventListener('pointermove', onMove); overlay.removeEventListener('pointerleave', onLeave);
			document.removeEventListener('pointerdown', onDown, true); window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointermove', onPressMove);
			window.removeEventListener('pointercancel', onCancel); window.removeEventListener('blur', onCancel); window.removeEventListener('keydown', onKey);
			overlay.removeEventListener('wheel', onCancel);
		},
	};
}
