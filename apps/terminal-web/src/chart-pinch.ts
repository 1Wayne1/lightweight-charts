import type { TerminalChart } from './chart';

export interface LogicalRange {
	from: number;
	to: number;
}

export interface PinchSnapshot {
	startDistance: number;
	anchorLogical: number;
	startSpan: number;
	plotLeft: number;
	plotWidth: number;
}

const MIN_PINCH_DISTANCE = 12;
const MAX_BAR_PIXELS = 64;
const MIN_BAR_PIXELS = 0.5;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export function createPinchSnapshot(
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	range: LogicalRange,
	plotLeft: number,
	plotWidth: number,
): PinchSnapshot | null {
	const startDistance = Math.hypot(x2 - x1, y2 - y1);
	const startSpan = range.to - range.from;
	if (!Number.isFinite(startDistance) || startDistance < MIN_PINCH_DISTANCE || !Number.isFinite(startSpan) || startSpan <= 0 || plotWidth <= 0) {
		return null;
	}
	const midX = (x1 + x2) / 2 - plotLeft;
	const ratio = clamp(midX / plotWidth, 0, 1);
	return {
		startDistance,
		anchorLogical: range.from + ratio * startSpan,
		startSpan,
		plotLeft,
		plotWidth,
	};
}

export function computePinchRange(
	snapshot: PinchSnapshot,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
): LogicalRange | null {
	const currentDistance = Math.hypot(x2 - x1, y2 - y1);
	if (!Number.isFinite(currentDistance) || currentDistance < MIN_PINCH_DISTANCE) return null;
	const scale = currentDistance / snapshot.startDistance;
	const minSpan = Math.max(6, snapshot.plotWidth / MAX_BAR_PIXELS);
	const maxSpan = Math.max(minSpan, Math.min(2500, snapshot.plotWidth / MIN_BAR_PIXELS));
	const nextSpan = clamp(snapshot.startSpan / scale, minSpan, maxSpan);
	const midX = (x1 + x2) / 2 - snapshot.plotLeft;
	const ratio = clamp(midX / snapshot.plotWidth, 0, 1);
	const from = snapshot.anchorLogical - ratio * nextSpan;
	return { from, to: from + nextSpan };
}

function isTouchInsideRect(touch: Touch, rect: DOMRect): boolean {
	return touch.clientX >= rect.left && touch.clientX <= rect.right &&
		touch.clientY >= rect.top && touch.clientY <= rect.bottom;
}

/**
 * Prevent browser page pinch-zoom across the mobile shell while giving the chart
 * a forgiving two-finger pinch controller that works across panes, overlays, and staggered touches.
 */
export function installViewportZoomGuard(): () => void {
	const preventGesture = (event: Event): void => {
		if (event.cancelable) event.preventDefault();
	};
	const preventMultiTouchZoom = (event: TouchEvent): void => {
		if (event.touches.length >= 2 && event.cancelable) event.preventDefault();
	};
	// Safari fires non-standard gesture* events for two-finger page zoom even when user-scalable=no is set.
	document.addEventListener('gesturestart', preventGesture, { passive: false });
	document.addEventListener('gesturechange', preventGesture, { passive: false });
	document.addEventListener('gestureend', preventGesture, { passive: false });
	document.addEventListener('touchstart', preventMultiTouchZoom, { passive: false, capture: true });
	document.addEventListener('touchmove', preventMultiTouchZoom, { passive: false, capture: true });
	return () => {
		document.removeEventListener('gesturestart', preventGesture);
		document.removeEventListener('gesturechange', preventGesture);
		document.removeEventListener('gestureend', preventGesture);
		document.removeEventListener('touchstart', preventMultiTouchZoom, true);
		document.removeEventListener('touchmove', preventMultiTouchZoom, true);
	};
}

export function attachChartPinch(stageWrap: HTMLElement, getChart: () => TerminalChart | undefined): () => void {
	let snapshot: PinchSnapshot | null = null;
	let blockUntilAllReleased = false;

	function pinchAllowed(terminal: TerminalChart): boolean {
		if (document.querySelector('dialog[open]')) return false;
		const handleScale = terminal.chart.options().handleScale;
		return typeof handleScale === 'boolean' ? handleScale : handleScale.pinch;
	}

	function startPinch(touches: TouchList): boolean {
		const terminal = getChart();
		if (!terminal || touches.length !== 2 || !pinchAllowed(terminal)) return false;
		const rect = stageWrap.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return false;
		const t0 = touches[0];
		const t1 = touches[1];
		const midX = (t0.clientX + t1.clientX) / 2;
		const midY = (t0.clientY + t1.clientY) / 2;
		const insideMid = midX >= rect.left && midX <= rect.right && midY >= rect.top && midY <= rect.bottom;
		if (!insideMid && !isTouchInsideRect(t0, rect) && !isTouchInsideRect(t1, rect)) return false;
		const range = terminal.chart.timeScale().getVisibleLogicalRange();
		if (!range) return false;
		let leftScaleWidth = 0;
		try {
			leftScaleWidth = terminal.series.getPane().priceScale('left').width();
		} catch {
			leftScaleWidth = 0;
		}
		const plotWidth = terminal.chart.timeScale().width();
		const created = createPinchSnapshot(t0.clientX, t0.clientY, t1.clientX, t1.clientY, range, rect.left + leftScaleWidth, plotWidth);
		if (!created) return false;
		snapshot = created;
		blockUntilAllReleased = true;
		return true;
	}

	const onTouchStart = (event: TouchEvent): void => {
		if (event.touches.length === 2) {
			if (startPinch(event.touches)) {
				if (event.cancelable) event.preventDefault();
				event.stopImmediatePropagation();
			}
		} else if (event.touches.length > 2 && blockUntilAllReleased) {
			snapshot = null;
			if (event.cancelable) event.preventDefault();
			event.stopImmediatePropagation();
		}
	};

	const onTouchMove = (event: TouchEvent): void => {
		if (!blockUntilAllReleased && event.touches.length === 2) {
			startPinch(event.touches);
		}
		if (!blockUntilAllReleased) return;
		if (event.cancelable) event.preventDefault();
		event.stopImmediatePropagation();
		if (event.touches.length !== 2) {
			snapshot = null;
			return;
		}
		const terminal = getChart();
		if (!terminal || !pinchAllowed(terminal)) {
			snapshot = null;
			return;
		}
		if (!snapshot && !startPinch(event.touches)) return;
		if (!snapshot) return;
		const next = computePinchRange(
			snapshot,
			event.touches[0].clientX,
			event.touches[0].clientY,
			event.touches[1].clientX,
			event.touches[1].clientY,
		);
		if (next) terminal.chart.timeScale().setVisibleLogicalRange(next);
	};

	const onTouchEnd = (event: TouchEvent): void => {
		if (!blockUntilAllReleased) return;
		if (event.touches.length === 2) {
			startPinch(event.touches);
			if (event.cancelable) event.preventDefault();
			event.stopImmediatePropagation();
			return;
		}
		snapshot = null;
		if (event.touches.length === 0) {
			blockUntilAllReleased = false;
			// Allow the final touchend to reach the chart so its internal active touch state resets cleanly.
		} else {
			if (event.cancelable) event.preventDefault();
			event.stopImmediatePropagation();
		}
	};

	const onTouchCancel = (): void => {
		snapshot = null;
		blockUntilAllReleased = false;
	};

	window.addEventListener('touchstart', onTouchStart, { passive: false, capture: true });
	window.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
	window.addEventListener('touchend', onTouchEnd, { passive: false, capture: true });
	window.addEventListener('touchcancel', onTouchCancel, { capture: true });

	return () => {
		snapshot = null;
		blockUntilAllReleased = false;
		window.removeEventListener('touchstart', onTouchStart, true);
		window.removeEventListener('touchmove', onTouchMove, true);
		window.removeEventListener('touchend', onTouchEnd, true);
		window.removeEventListener('touchcancel', onTouchCancel, true);
	};
}
