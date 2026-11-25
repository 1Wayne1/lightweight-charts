interface TabSlot {
	element: HTMLElement;
	left: number;
	width: number;
}

interface TabDrag {
	pointerId: number;
	tab: HTMLElement;
	id: string;
	startX: number;
	startY: number;
	startScroll: number;
	startLeft: number;
	width: number;
	slots: TabSlot[];
	sourceIndex: number;
	x: number;
	y: number;
	active: boolean;
	targetIndex: number | null;
}

/** Preview a reorder with pointer movement; only commit after a valid release. */
export function attachTabReorder(container: HTMLElement, onMove: (id: string, index: number) => void) {
	let drag: TabDrag | undefined;
	let frame: number | undefined;
	let lastFrame = 0;
	let suppressClick = false;
	const settling = new Set<Animation>();
	const tabElements = () => Array.from(container.querySelectorAll<HTMLElement>('.tab'));
	const positions = () => new Map(tabElements().map(tab => [tab.dataset.tabId, tab.getBoundingClientRect().left]));

	function stopSettling(): void {
		for (const animation of settling) animation.cancel();
		settling.clear();
	}

	function animateToLayout(before: Map<string | undefined, number>): void {
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		for (const tab of tabElements()) {
			const left = before.get(tab.dataset.tabId);
			if (left === undefined) continue;
			const offset = left - tab.getBoundingClientRect().left;
			if (Math.abs(offset) < .5) continue;
			const animation = tab.animate([{ transform: `translateX(${offset}px)` }, { transform: 'translateX(0)' }], {
				duration: 180, easing: 'cubic-bezier(.2, .8, .2, 1)',
			});
			settling.add(animation);
			animation.onfinish = () => { settling.delete(animation); };
		}
	}

	function cancel(): void {
		stopSettling();
		const current = drag;
		drag = undefined;
		if (frame !== undefined) cancelAnimationFrame(frame);
		frame = undefined;
		current?.tab.classList.remove('is-dragging');
		container.classList.remove('is-reordering');
		for (const slot of current?.slots ?? []) slot.element.style.removeProperty('transform');
		if (current && container.hasPointerCapture(current.pointerId)) container.releasePointerCapture(current.pointerId);
	}

	function finish(commit = false): void {
		if (!drag) return;
		const { id, active, targetIndex } = drag;
		const before = active ? positions() : undefined;
		cancel();
		if (commit && active && targetIndex !== null) onMove(id, targetIndex);
		if (before) animateToLayout(before);
	}

	function preview(): void {
		if (!drag?.active) return;
		const bounds = container.getBoundingClientRect();
		// Keep the floating tab inside the viewport so its transform cannot grow scrollWidth.
		const left = Math.max(bounds.left, Math.min(bounds.right - drag.width, drag.startLeft + drag.x - drag.startX));
		drag.tab.style.transform = `translateX(${left - drag.startLeft + container.scrollLeft - drag.startScroll}px)`;
		const inside = drag.x >= bounds.left && drag.x <= bounds.right && drag.y >= bounds.top && drag.y <= bounds.bottom;
		// Use the original slots for hit testing: animated neighbors must not move the threshold.
		const scrollDelta = container.scrollLeft - drag.startScroll;
		const others = drag.slots.filter(slot => slot.element !== drag?.tab);
		const nextIndex = others.findIndex(slot => drag!.x < slot.left - scrollDelta + slot.width / 2);
		drag.targetIndex = inside ? (nextIndex < 0 ? others.length : nextIndex) : null;
		const destination = drag.targetIndex ?? drag.sourceIndex;
		for (const [index, slot] of drag.slots.entries()) {
			if (index === drag.sourceIndex) continue;
			const offset = index >= destination && index < drag.sourceIndex ? drag.width
				: index > drag.sourceIndex && index <= destination ? -drag.width : 0;
			slot.element.style.transform = `translateX(${offset}px)`;
		}
	}

	function scrollFrame(now: number): void {
		if (!drag?.active) return;
		const bounds = container.getBoundingClientRect();
		if (drag.y >= bounds.top && drag.y <= bounds.bottom && drag.x >= bounds.left && drag.x <= bounds.right) {
			const edge = 36;
			const speed = drag.x < bounds.left + edge ? -(1 - (drag.x - bounds.left) / edge)
				: drag.x > bounds.right - edge ? 1 - (bounds.right - drag.x) / edge : 0;
			container.scrollLeft += speed * Math.min(now - lastFrame, 32) * .65;
		}
		lastFrame = now;
		preview();
		frame = requestAnimationFrame(scrollFrame);
	}

	function onPointerDown(event: PointerEvent): void {
		cancel();
		suppressClick = false;
		if (!event.isPrimary || event.button !== 0 || !(event.target instanceof Element)) return;
		const handle = event.target.closest('.tab-focus');
		const tab = handle?.closest<HTMLElement>('.tab');
		if (!tab?.dataset.tabId || !container.contains(tab) || tabElements().length < 2) return;
		const bounds = tab.getBoundingClientRect();
		const slots = tabElements().map(element => {
			const rect = element.getBoundingClientRect();
			return { element, left: rect.left, width: rect.width };
		});
		drag = { pointerId: event.pointerId, tab, id: tab.dataset.tabId, startX: event.clientX, startY: event.clientY,
			startScroll: container.scrollLeft, startLeft: bounds.left, width: bounds.width,
			slots, sourceIndex: slots.findIndex(slot => slot.element === tab),
			x: event.clientX, y: event.clientY, active: false, targetIndex: null };
	}

	function onPointerMove(event: PointerEvent): void {
		if (!drag || event.pointerId !== drag.pointerId) return;
		drag.x = event.clientX;
		drag.y = event.clientY;
		if (!drag.active) {
			const dx = Math.abs(drag.x - drag.startX);
			const dy = Math.abs(drag.y - drag.startY);
			if (dy > 6 && dy > dx) { cancel(); return; }
			if (dx < 6) return;
			drag.active = true;
			suppressClick = true;
			drag.tab.classList.add('is-dragging');
			container.classList.add('is-reordering');
			container.setPointerCapture(event.pointerId);
			lastFrame = performance.now();
			frame = requestAnimationFrame(scrollFrame);
		}
		event.preventDefault();
		preview();
	}

	function onPointerUp(event: PointerEvent): void {
		if (!drag || event.pointerId !== drag.pointerId) return;
		drag.x = event.clientX;
		drag.y = event.clientY;
		preview();
		finish(true);
	}

	function onPointerCancel(event: PointerEvent): void {
		if (event.pointerId === drag?.pointerId) finish();
	}

	function onClick(event: MouseEvent): void {
		if (!suppressClick || event.detail === 0) return;
		suppressClick = false;
		event.preventDefault();
		event.stopImmediatePropagation();
	}

	function onKeyDown(event: KeyboardEvent): void {
		if (event.key === 'Escape' && drag) {
			event.preventDefault();
			event.stopImmediatePropagation();
			finish();
			return;
		}
		if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
		if (!(event.target instanceof Element) || !event.target.matches('.tab-focus') || !container.contains(event.target)) return;
		const tab = event.target.closest<HTMLElement>('.tab');
		if (!tab?.dataset.tabId) return;
		event.preventDefault();
		const index = tabElements().indexOf(tab) + (event.key === 'ArrowLeft' ? -1 : 1);
		const before = positions();
		cancel();
		onMove(tab.dataset.tabId, index);
		animateToLayout(before);
	}

	function onVisibility(): void { if (document.hidden) cancel(); }
	function onNativeDrag(event: DragEvent): void { event.preventDefault(); }
	container.addEventListener('pointerdown', onPointerDown);
	container.addEventListener('click', onClick, true);
	container.addEventListener('dragstart', onNativeDrag);
	container.addEventListener('lostpointercapture', onPointerCancel);
	window.addEventListener('pointermove', onPointerMove, { passive: false });
	window.addEventListener('pointerup', onPointerUp);
	window.addEventListener('pointercancel', onPointerCancel);
	window.addEventListener('keydown', onKeyDown, true);
	window.addEventListener('blur', cancel);
	window.addEventListener('resize', cancel);
	window.addEventListener('pagehide', cancel);
	document.addEventListener('visibilitychange', onVisibility);
	return {
		cancel,
		destroy(): void {
			cancel();
			container.removeEventListener('pointerdown', onPointerDown);
			container.removeEventListener('click', onClick, true);
			container.removeEventListener('dragstart', onNativeDrag);
			container.removeEventListener('lostpointercapture', onPointerCancel);
			window.removeEventListener('pointermove', onPointerMove);
			window.removeEventListener('pointerup', onPointerUp);
			window.removeEventListener('pointercancel', onPointerCancel);
			window.removeEventListener('keydown', onKeyDown, true);
			window.removeEventListener('blur', cancel);
			window.removeEventListener('resize', cancel);
			window.removeEventListener('pagehide', cancel);
			document.removeEventListener('visibilitychange', onVisibility);
		},
	};
}
