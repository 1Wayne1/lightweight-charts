import { instrumentKey, type ConnectionState, type Instrument, type MarketQuote, type Timeframe } from '@terminal/domain';
import type { IndicatorSettings } from './chart';
import { TIMEFRAME_GROUPS, TIMEFRAME_LONG_LABELS, TIMEFRAME_SHORT_LABELS } from './data/timeframes';
import { HoldSwitcher } from './hold-switcher';
import { closeIndicatorColorPopover, renderIndicatorPanel } from './indicator-ui';
import { coinBadge, formatPrice, instruments, marketFor, marketLabel, symbolLabel } from './markets';
import { element, icon, iconButton } from './ui';

// Include phone landscape independently of portrait width. Keep CSS on this same query.
export const MOBILE_QUERY = '(max-width: 760px), (max-width: 1100px) and (max-height: 600px)';
export const timeframeLabels: Record<Timeframe, string> = TIMEFRAME_LONG_LABELS;

interface MobileOptions {
	app: HTMLElement;
	priceOverlay: HTMLElement;
	settings: IndicatorSettings;
	openInstrument(instrument: Instrument): void;
	reorderWatchlist(fromIndex: number, toIndex: number): void;
	removeWatchlist(instrument: Instrument): void;
	openSearch(): void;
	openDrawings(): void;
	openDrawingObjects(): void;
	openSync(): void;
	drawingHistory(): { canUndo: boolean; canRedo: boolean; undo(): void; redo(): void };
	setTimeframe(timeframe: Timeframe): void;
	setRange(seconds: number): void;
	setIndicators(): void;
	fitChart(): void;
	setLayout(mobile: boolean): void;
}

export function createMobileUI(options: MobileOptions) {
	const { app } = options;
	const media = window.matchMedia(MOBILE_QUERY);
	let page: 'watchlist' | 'chart' = 'chart';
	let active: Instrument | undefined;
	let timeframe: Timeframe = '1h';
	let fullscreen = false;
	let quoteMap = new Map<string, MarketQuote>();
	const cleanups: (() => void)[] = [];

	let watchEditMode = false;
	const watchPage = element('section', 'mobile-watch-page');
	watchPage.id = 'mobile-watch-page';
	watchPage.setAttribute('aria-label', '手机自选表');
	const watchHeader = element('header', 'mobile-watch-header');
	const watchBrand = element('span', 'mobile-brand');
	watchBrand.append(icon('logo'), document.createTextNode('Crypto Terminal'));
	const watchHeaderActions = element('div', 'mobile-watch-header-actions');
	const watchEditBtn = element('button', 'mobile-watch-edit-btn', '编辑');
	watchEditBtn.type = 'button';
	watchEditBtn.setAttribute('aria-pressed', 'false');
	watchEditBtn.onclick = () => {
		watchEditMode = !watchEditMode;
		watchEditBtn.textContent = watchEditMode ? '完成' : '编辑';
		watchEditBtn.setAttribute('aria-pressed', String(watchEditMode));
		renderedSymbols = '';
		renderQuotes();
	};
	watchHeaderActions.append(watchEditBtn, iconButton('search', '搜索自选交易对', () => options.openSearch()));
	watchHeader.append(watchBrand, watchHeaderActions);
	const watchTitle = element('div', 'mobile-watch-title');
	const heading = element('h1');
	heading.append(element('span', 'flag'), document.createTextNode('自选表'));
	const quoteStatus = element('span', 'mobile-demo-tag', 'Binance · 连接中');
	watchTitle.append(heading, quoteStatus);
	const watchRows = element('div', 'mobile-watch-rows');
	watchPage.append(watchHeader, watchTitle, watchRows);

	// TradingView-inspired bottom chart action bar: symbol drum, timeframe, tools, quick undo, and fullscreen toggle.
	const chartBar = element('div', 'mobile-chartbar');
	const symbol = element('button', 'mobile-symbol');
	symbol.type = 'button';
	symbol.setAttribute('aria-label', '切换交易对，点击搜索或上下滑动切换');
	symbol.setAttribute('aria-expanded', 'false');
	symbol.setAttribute('aria-controls', 'mobile-symbol-wheel');
	symbol.title = '轻点搜索；按住直接上下滑动，松手切换';
	const symbolDrumTrack = element('span', 'symbol-drum-track');
	symbol.append(symbolDrumTrack);

	const period = element('button', 'mobile-period');
	period.type = 'button';
	period.setAttribute('aria-label', '选择日期范围和周期');
	period.onclick = () => openPeriodSheet();

	const toolStrip = element('div', 'mobile-tool-strip');
	const drawButton = iconButton('brush', '绘图工具', () => options.openDrawings());
	drawButton.setAttribute('aria-pressed', 'false');
	const indicatorButton = iconButton('indicator', '手机图表指标', () => openIndicators());
	const objectsButton = iconButton('layers', '绘图对象与备份', () => options.openDrawingObjects());
	const moreButton = iconButton('more', '图表选项', () => openChartOptions());
	toolStrip.append(drawButton, indicatorButton, objectsButton, moreButton);

	const rightActions = element('div', 'mobile-bar-end');
	const quickUndo = iconButton('undo', '手机撤销画线', () => options.drawingHistory().undo());
	quickUndo.classList.add('mobile-quick-undo');
	quickUndo.disabled = true;
	const fullscreenButton = iconButton('maximize', '全屏图表', () => setFullscreen(!fullscreen));
	fullscreenButton.classList.add('mobile-fullscreen-btn');
	fullscreenButton.setAttribute('aria-pressed', 'false');
	rightActions.append(quickUndo, fullscreenButton);
	chartBar.append(symbol, period, toolStrip, rightActions);

	const navigation = element('nav', 'mobile-navigation');
	navigation.setAttribute('aria-label', '手机主导航');
	const watchTab = element('button', 'mobile-nav-item');
	watchTab.type = 'button';
	watchTab.append(icon('list'), element('span', '', '自选表'));
	watchTab.setAttribute('aria-controls', watchPage.id);
	watchTab.onclick = () => showPage('watchlist');
	const chartTab = element('button', 'mobile-nav-item');
	chartTab.type = 'button';
	chartTab.append(icon('candles'), element('span', '', '图表'));
	chartTab.onclick = () => showPage('chart');
	navigation.append(watchTab, chartTab);
	const quoteLine = element('div', 'mobile-chart-quote');
	options.priceOverlay.insertBefore(quoteLine, options.priceOverlay.children[1] ?? null);

	function setFullscreen(next: boolean): void {
		if (fullscreen === next) return;
		fullscreen = next;
		app.classList.toggle('mobile-fullscreen', fullscreen);
		fullscreenButton.replaceChildren(icon(fullscreen ? 'minimize' : 'maximize'));
		const label = fullscreen ? '退出全屏' : '全屏图表';
		fullscreenButton.title = label;
		fullscreenButton.setAttribute('aria-label', label);
		fullscreenButton.setAttribute('aria-pressed', String(fullscreen));
	}

	// Shared light bottom sheet with smooth enter/exit transitions and live drag-to-dismiss.
	const sheet = element('dialog', 'mobile-sheet');
	sheet.tabIndex = -1;
	sheet.setAttribute('aria-labelledby', 'mobile-sheet-title');
	const handle = element('button', 'sheet-handle');
	handle.type = 'button';
	handle.setAttribute('aria-label', '展开或收起面板');
	handle.append(element('span'));
	handle.onclick = () => sheet.classList.toggle('expanded');
	const sheetHeader = element('div', 'mobile-sheet-header');
	const sheetTitle = element('h2');
	sheetTitle.id = 'mobile-sheet-title';
	const closeSheetBtn = iconButton('close', '关闭底部面板', () => closeSheetAnimated());
	sheetHeader.append(sheetTitle, closeSheetBtn);
	const sheetBody = element('div', 'mobile-sheet-body');
	sheet.append(handle, sheetHeader, sheetBody);

	let sheetCloseTimer: ReturnType<typeof setTimeout> | undefined;
	function finishSheetClose(): void {
		clearTimeout(sheetCloseTimer);
		sheetCloseTimer = undefined;
		sheet.classList.remove('is-open', 'is-closing', 'is-dragging');
		sheet.style.transform = '';
		if (sheet.open) sheet.close();
	}
	function closeSheetAnimated(immediate = false): void {
		closeIndicatorColorPopover();
		clearTimeout(sheetCloseTimer);
		sheetCloseTimer = undefined;
		if (!sheet.open) return;
		if (immediate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			finishSheetClose();
			return;
		}
		sheet.classList.remove('is-open', 'is-dragging');
		sheet.classList.add('is-closing');
		sheet.style.transform = '';
		sheetCloseTimer = setTimeout(finishSheetClose, 240);
	}
	sheet.addEventListener('cancel', () => {
		clearTimeout(sheetCloseTimer);
		sheetCloseTimer = undefined;
		sheet.classList.remove('is-open', 'is-closing', 'is-dragging');
		sheet.style.transform = '';
	});
	sheet.addEventListener('click', event => {
		if (event.target === sheet) {
			const rect = sheet.getBoundingClientRect();
			if (event.clientY < rect.top || event.clientX < rect.left || event.clientX > rect.right) closeSheetAnimated();
		}
	});
	let dragStart: number | undefined;
	let dragDelta = 0;
	let handleDragged = false;
	handle.addEventListener('pointerdown', event => {
		if (!event.isPrimary) return;
		dragStart = event.clientY;
		dragDelta = 0;
		handleDragged = false;
		sheet.classList.add('is-dragging');
		try { handle.setPointerCapture(event.pointerId); } catch { /* ignore */ }
	});
	handle.addEventListener('pointermove', event => {
		if (dragStart === undefined) return;
		dragDelta = event.clientY - dragStart;
		if (Math.abs(dragDelta) >= 10) handleDragged = true;
		if (dragDelta > 0) {
			sheet.style.transform = `translate3d(0, ${dragDelta}px, 0)`;
		} else {
			sheet.style.transform = `translate3d(0, ${Math.max(-28, dragDelta * 0.25)}px, 0)`;
		}
	});
	const endSheetDrag = (): void => {
		if (dragStart === undefined) return;
		const delta = dragDelta;
		dragStart = undefined;
		dragDelta = 0;
		sheet.classList.remove('is-dragging');
		if (delta > 85) {
			closeSheetAnimated();
			return;
		}
		sheet.style.transform = '';
		if (delta < -38) sheet.classList.add('expanded');
		else if (delta > 32 && sheet.classList.contains('expanded')) sheet.classList.remove('expanded');
	};
	handle.addEventListener('pointerup', endSheetDrag);
	handle.addEventListener('pointercancel', endSheetDrag);
	handle.addEventListener('click', event => {
		if (handleDragged) { event.preventDefault(); event.stopImmediatePropagation(); handleDragged = false; }
	}, { capture: true });

	// Smooth 3D cylinder symbol wheel matching TradingView's compact proportion and size falloff.
	const wheel = element('div', 'mobile-symbol-wheel');
	wheel.id = 'mobile-symbol-wheel';
	wheel.hidden = true;
	wheel.setAttribute('role', 'listbox');
	wheel.setAttribute('aria-label', '滑动选择交易对');
	const wheelViewport = element('div', 'symbol-wheel-viewport');
	const wheelTrack = element('div', 'symbol-wheel-track');
	wheelViewport.append(wheelTrack);
	wheel.append(wheelViewport);
	app.append(watchPage, chartBar, navigation, sheet, wheel);

	let previewIndex = 0;
	let targetPos = 0;
	let displayPos = 0;
	let wheelOpen = false;
	let wheelFrame: number | undefined;
	let wheelCloseTimer: ReturnType<typeof setTimeout> | undefined;
	let keyboardWheel = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let pointerId: number | undefined;
	let suppressClick = false;
	const gesture = new HoldSwitcher();
	const wrapIndex = (idx: number, len: number): number => len > 0 ? ((idx % len) + len) % len : 0;
	const activeIndex = (): number => Math.max(0, instruments.findIndex(item => active && instrumentKey(item) === instrumentKey(active)));

	// Fixed pool of 9 virtual slots for seamless infinite circular cylinder scrolling.
	const WHEEL_OFFSETS = [-4, -3, -2, -1, 0, 1, 2, 3, 4] as const;
	const wheelSlots = WHEEL_OFFSETS.map(() => {
		const row = element('div', 'symbol-wheel-row');
		row.setAttribute('role', 'option');
		row.setAttribute('aria-selected', 'false');
		wheelTrack.append(row);
		return { row, key: '' };
	});
	// Fixed pool of 3 virtual slots for the bottom-left circular symbol drum.
	const DRUM_OFFSETS = [-1, 0, 1] as const;
	const drumSlots = DRUM_OFFSETS.map(() => {
		const item = element('span', 'symbol-drum-item');
		symbolDrumTrack.append(item);
		return { item, text: '' };
	});

	function wheelCylinderRadius(): number {
		return window.matchMedia('(max-width: 1100px) and (max-height: 600px) and (orientation: landscape)').matches ? 78 : 96;
	}

	function positionSymbolDrum(pos: number, animate = false): void {
		const count = instruments.length;
		const activeInWatchlist = Boolean(active && instruments.some(item => instrumentKey(item) === instrumentKey(active!)));
		if ((!active && !wheelOpen) || count === 0 || (!wheelOpen && active && !activeInWatchlist)) {
			symbolDrumTrack.classList.remove('is-animated');
			drumSlots[0].item.textContent = '';
			drumSlots[1].item.textContent = active ? symbolLabel(active) : '搜索交易对';
			drumSlots[1].item.classList.add('is-current');
			drumSlots[1].item.style.transform = 'translate3d(0, 0, 0)';
			drumSlots[2].item.textContent = '';
			drumSlots[0].text = drumSlots[1].text = drumSlots[2].text = '';
			return;
		}
		const rowHeight = symbol.clientHeight > 0 && symbol.clientHeight <= 44 ? 19 : 21;
		const center = Math.round(pos);
		const frac = pos - center;
		symbolDrumTrack.classList.toggle('is-animated', animate);
		for (let i = 0; i < DRUM_OFFSETS.length; i++) {
			const offset = DRUM_OFFSETS[i];
			const slot = drumSlots[i];
			const item = instruments[wrapIndex(center + offset, count)];
			const label = symbolLabel(item);
			if (slot.text !== label) {
				slot.text = label;
				slot.item.textContent = label;
			}
			const y = (offset - frac) * rowHeight;
			slot.item.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`;
			slot.item.classList.toggle('is-current', offset === 0);
		}
	}

	function renderWheelFrame(): void {
		wheelFrame = undefined;
		if (!wheelOpen && wheel.hidden) return;
		const count = instruments.length;
		if (count === 0) return;
		const diff = targetPos - displayPos;
		if (Math.abs(diff) < 0.002) {
			displayPos = targetPos;
		} else {
			displayPos += diff * 0.34;
			wheelFrame = requestAnimationFrame(renderWheelFrame);
		}
		const radius = wheelCylinderRadius();
		const angleStep = 0.34;
		const center = Math.round(displayPos);
		for (let i = 0; i < WHEEL_OFFSETS.length; i++) {
			const offset = WHEEL_OFFSETS[i];
			const virtualIdx = center + offset;
			const itemIdx = wrapIndex(virtualIdx, count);
			const item = instruments[itemIdx];
			const key = instrumentKey(item);
			const slot = wheelSlots[i];
			if (slot.key !== key) {
				slot.key = key;
				slot.row.id = `wheel-option-${itemIdx}`;
				slot.row.replaceChildren(coinBadge(item), element('span', '', symbolLabel(item)));
			}
			const delta = virtualIdx - displayPos;
			const abs = Math.abs(delta);
			const angle = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, delta * angleStep));
			const y = Math.sin(angle) * radius;
			const scale = Math.pow(0.77, abs);
			const opacity = Math.pow(0.56, abs);
			slot.row.style.visibility = 'visible';
			slot.row.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0) scale(${scale.toFixed(3)})`;
			slot.row.style.opacity = opacity.toFixed(3);
			slot.row.classList.toggle('is-center', offset === 0);
			slot.row.setAttribute('aria-selected', String(offset === 0));
		}
		positionSymbolDrum(displayPos, false);
	}

	function scheduleWheelFrame(): void {
		if (wheelFrame === undefined) wheelFrame = requestAnimationFrame(renderWheelFrame);
	}

	function preview(index: number, continuousPos = index): void {
		previewIndex = wrapIndex(index, instruments.length);
		targetPos = continuousPos;
		if (!wheelOpen) {
			clearTimeout(wheelCloseTimer);
			wheelCloseTimer = undefined;
			wheelOpen = true;
			displayPos = continuousPos;
			wheel.hidden = false;
			symbol.setAttribute('aria-expanded', 'true');
			renderWheelFrame();
			requestAnimationFrame(() => {
				if (wheelOpen) wheel.classList.add('is-open');
			});
		} else {
			scheduleWheelFrame();
		}
		wheel.setAttribute('aria-activedescendant', `wheel-option-${previewIndex}`);
	}

	function clearGesture(): void {
		clearTimeout(timer);
		timer = undefined;
		gesture.cancel();
		const captured = pointerId;
		pointerId = undefined;
		if (captured !== undefined) {
			try {
				if (symbol.hasPointerCapture(captured)) symbol.releasePointerCapture(captured);
			} catch {
				// Ignore capture release errors on Safari.
			}
		}
		keyboardWheel = false;
		if (wheelFrame !== undefined) {
			cancelAnimationFrame(wheelFrame);
			wheelFrame = undefined;
		}
		if (wheelOpen) {
			wheelOpen = false;
			wheel.classList.remove('is-open');
			clearTimeout(wheelCloseTimer);
			wheelCloseTimer = setTimeout(() => {
				wheelCloseTimer = undefined;
				if (!wheelOpen) wheel.hidden = true;
			}, 180);
		} else {
			wheel.hidden = true;
		}
		symbol.setAttribute('aria-expanded', 'false');
		wheel.removeAttribute('aria-activedescendant');
		positionSymbolDrum(activeIndex(), true);
	}

	symbol.addEventListener('pointerdown', event => {
		if (!event.isPrimary || event.button !== 0) return;
		clearGesture();
		suppressClick = false;
		if (!gesture.begin(event.pointerId, event.clientX, event.clientY, activeIndex(), instruments.length)) return;
		pointerId = event.pointerId;
		try { symbol.setPointerCapture(event.pointerId); } catch { /* Safari touch fallback uses window listeners. */ }
		timer = setTimeout(() => {
			const selected = gesture.activate(event.pointerId);
			if (selected !== null) {
				suppressClick = true;
				preview(selected, gesture.position());
			}
		}, 260);
	});
	const onSymbolPointerMove = (event: PointerEvent): void => {
		if (pointerId !== event.pointerId) return;
		const selected = gesture.move(event.pointerId, event.clientX, event.clientY);
		if (!gesture.isTracking(event.pointerId)) {
			suppressClick = true;
			clearTimeout(timer);
		}
		if (selected !== null) {
			suppressClick = true;
			clearTimeout(timer);
			preview(selected, gesture.position());
		}
	};
	const onSymbolPointerUp = (event: PointerEvent): void => {
		if (pointerId !== event.pointerId) return;
		const selected = gesture.end(event.pointerId);
		clearGesture();
		if (selected !== null) select(instruments[selected]);
	};
	const cancelPointer = (event: PointerEvent): void => {
		if (pointerId !== event.pointerId) return;
		suppressClick = true;
		clearGesture();
	};
	window.addEventListener('pointermove', onSymbolPointerMove);
	window.addEventListener('pointerup', onSymbolPointerUp);
	window.addEventListener('pointercancel', cancelPointer);
	cleanups.push(() => {
		window.removeEventListener('pointermove', onSymbolPointerMove);
		window.removeEventListener('pointerup', onSymbolPointerUp);
		window.removeEventListener('pointercancel', cancelPointer);
	});
	symbol.addEventListener('contextmenu', event => event.preventDefault());
	symbol.onclick = () => {
		if (suppressClick || keyboardWheel) { suppressClick = false; return; }
		options.openSearch();
	};
	symbol.addEventListener('keydown', event => {
		if (![' ', 'Enter', 'ArrowUp', 'ArrowDown', 'Escape'].includes(event.key)) return;
		event.preventDefault();
		if (event.key === 'Escape') { clearGesture(); return; }
		if (!keyboardWheel) {
			keyboardWheel = true;
			preview(activeIndex());
			return;
		}
		if (event.key === 'Enter' || event.key === ' ') {
			const selected = instruments[previewIndex];
			clearGesture();
			select(selected);
		} else {
			const nextPos = targetPos + (event.key === 'ArrowDown' ? 1 : -1);
			preview(wrapIndex(Math.round(nextPos), instruments.length), nextPos);
		}
	});
	symbol.addEventListener('blur', () => { if (keyboardWheel) clearGesture(); });

	function select(instrument: Instrument): void {
		showPage('chart');
		if (!active || instrumentKey(instrument) !== instrumentKey(active)) options.openInstrument(instrument);
	}

	function showPage(next: typeof page): void {
		clearGesture();
		closeSheetAnimated(true);
		if (next === 'chart' && watchEditMode) {
			watchEditMode = false;
			watchEditBtn.textContent = '编辑';
			watchEditBtn.setAttribute('aria-pressed', 'false');
			renderedSymbols = '';
		}
		if (next === 'watchlist' && fullscreen) setFullscreen(false);
		page = next;
		app.dataset.mobilePage = page;
		watchTab.setAttribute('aria-current', page === 'watchlist' ? 'page' : 'false');
		chartTab.setAttribute('aria-current', page === 'chart' ? 'page' : 'false');
		if (next === 'watchlist') renderQuotes();
	}

	function openSheet(title: string): void {
		clearGesture();
		clearTimeout(sheetCloseTimer);
		sheetCloseTimer = undefined;
		sheet.classList.remove('is-closing', 'is-dragging', 'expanded');
		sheet.style.transform = '';
		sheetTitle.textContent = title;
		sheetBody.replaceChildren();
		if (!sheet.open) sheet.showModal();
		// Focus the dialog container rather than the top drag handle so Safari does not draw a blue focus ring around the handle bar.
		sheet.focus({ preventScroll: true });
		requestAnimationFrame(() => {
			if (sheet.open && !sheet.classList.contains('is-closing')) sheet.classList.add('is-open');
		});
	}

	function openPeriodSheet(): void {
		openSheet('日期范围');
		const dateRanges = element('div', 'sheet-chips date-chips');
		for (const [label, seconds] of [['1天', 86400], ['5天', 432000], ['1个月', 2592000], ['3个月', 7776000], ['6个月', 15552000], ['全部', 0]] as const) {
			const button = element('button', 'sheet-chip', label);
			button.type = 'button';
			button.setAttribute('aria-label', `日期范围 ${label}`);
			button.onclick = () => { options.setRange(seconds); closeSheetAnimated(); };
			dateRanges.append(button);
		}
		sheetBody.append(dateRanges, element('h3', 'sheet-section-title', '周期'));
		for (const group of TIMEFRAME_GROUPS) {
			const section = element('section', 'period-section');
			section.append(element('h4', '', group.label));
			const chips = element('div', 'sheet-chips');
			for (const value of group.timeframes) {
				const button = element('button', 'sheet-chip', timeframeLabels[value]);
				button.type = 'button';
				button.setAttribute('aria-pressed', String(value === timeframe));
				button.setAttribute('aria-label', `手机周期 ${value}`);
				button.onclick = () => { options.setTimeframe(value); closeSheetAnimated(); };
				chips.append(button);
			}
			section.append(chips);
			sheetBody.append(section);
		}
	}

	function openIndicators(focusId?: string): void {
		openSheet('指标');
		renderIndicatorPanel(sheetBody, options.settings, () => options.setIndicators(), focusId ? { initialFocusId: focusId } : {});
	}

	function openChartOptions(): void {
		openSheet('图表选项');
		const history = options.drawingHistory();
		const objects = element('button', 'sheet-action', '绘图对象与备份');
		objects.type = 'button';
		objects.disabled = !active;
		objects.onclick = () => { closeSheetAnimated(true); options.openDrawingObjects(); };
		const undo = element('button', 'sheet-action', '撤销画线');
		undo.type = 'button';
		undo.disabled = !history.canUndo; undo.onclick = () => { history.undo(); closeSheetAnimated(); };
		const redo = element('button', 'sheet-action', '重做画线');
		redo.type = 'button';
		redo.disabled = !history.canRedo; redo.onclick = () => { history.redo(); closeSheetAnimated(); };
		const fit = element('button', 'sheet-action', '适应全部数据');
		fit.type = 'button';
		fit.onclick = () => { options.fitChart(); closeSheetAnimated(); };
		const search = element('button', 'sheet-action', '搜索交易对');
		search.type = 'button';
		search.onclick = () => { closeSheetAnimated(true); options.openSearch(); };
		const syncBtn = element('button', 'sheet-action', `云同步与数据迁移（${syncLabel}）`);
		syncBtn.type = 'button';
		syncBtn.onclick = () => { closeSheetAnimated(true); options.openSync(); };
		sheetBody.append(syncBtn, objects, undo, redo, fit, search, element('p', 'mobile-sheet-note', `Binance 现货 / USDT 永续 · 本机保存 · ${syncLabel}`));
	}

	const rowPrices = new Map<string, { price: HTMLElement; change: HTMLElement }>();
	let renderedSymbols = '';
	let connectionText = '连接中';
	let syncLabel = '云同步未启用';
	function renderQuotes(): void {
		const signature = `${watchEditMode ? 'edit' : 'view'}:${instruments.map(instrumentKey).join(',')}`;
		if (signature !== renderedSymbols || (instruments.length === 0 && watchRows.childElementCount === 0)) {
			renderedSymbols = signature;
			watchRows.replaceChildren();
			rowPrices.clear();
			if (instruments.length === 0) {
				watchRows.append(element('p', 'mobile-watch-empty', '自选表为空，点右上角搜索图标添加交易对'));
			}
			instruments.forEach((instrument, index) => {
				if (watchEditMode) {
					const row = element('div', 'mobile-watch-row is-editing');
					row.dataset.index = String(index);
					const copy = element('span', 'mobile-market-name');
					copy.append(element('strong', '', symbolLabel(instrument)), element('small', '', `${marketFor(instrument).name} · ${marketLabel(instrument)}`));
					const actions = element('div', 'mobile-watch-edit-actions');
					const remove = iconButton('trash', `从自选移除 ${symbolLabel(instrument)}`, () => options.removeWatchlist(instrument));
					remove.className = 'mobile-watch-delete';
					const drag = element('button', 'mobile-watch-drag', '≡');
					drag.type = 'button';
					drag.setAttribute('aria-label', `拖动调整 ${symbolLabel(instrument)} 顺序`);
					let pointerId: number | undefined;
					let targetIndex = index;
					let dropRow: HTMLElement | undefined;
					const clearDrop = (): void => {
						dropRow?.classList.remove('drop-before', 'drop-after');
						dropRow = undefined;
					};
					drag.onpointerdown = event => {
						if (!event.isPrimary || event.button !== 0) return;
						event.preventDefault();
						pointerId = event.pointerId;
						targetIndex = index;
						row.classList.add('is-dragging');
						try { drag.setPointerCapture(event.pointerId); } catch { /* ignore */ }
					};
					drag.onpointermove = event => {
						if (pointerId !== event.pointerId) return;
						const rows = [...watchRows.querySelectorAll<HTMLElement>('.mobile-watch-row.is-editing')];
						let matched: HTMLElement | undefined;
						let after = false;
						for (const candidate of rows) {
							const rect = candidate.getBoundingClientRect();
							if (event.clientY >= rect.top && event.clientY <= rect.bottom) {
								matched = candidate;
								after = event.clientY >= rect.top + rect.height / 2;
								break;
							}
						}
						if (!matched && rows.length) {
							const firstRect = rows[0].getBoundingClientRect();
							matched = event.clientY < firstRect.top ? rows[0] : rows[rows.length - 1];
							after = event.clientY >= firstRect.top;
						}
						clearDrop();
						if (matched) {
							matched.classList.add(after ? 'drop-after' : 'drop-before');
							dropRow = matched;
							const idx = Number(matched.dataset.index ?? index);
							let nextTarget = after ? idx + 1 : idx;
							if (index < nextTarget) nextTarget -= 1;
							targetIndex = Math.max(0, Math.min(instruments.length - 1, nextTarget));
						}
					};
					const finishDrag = (commit: boolean): void => {
						if (pointerId === undefined) return;
						const captured = pointerId;
						pointerId = undefined;
						try { if (drag.hasPointerCapture(captured)) drag.releasePointerCapture(captured); } catch { /* ignore */ }
						row.classList.remove('is-dragging');
						clearDrop();
						if (commit && targetIndex !== index) options.reorderWatchlist(index, targetIndex);
					};
					drag.onpointerup = () => finishDrag(true);
					drag.onpointercancel = () => finishDrag(false);
					actions.append(remove, drag);
					row.append(coinBadge(instrument), copy, actions);
					watchRows.append(row);
					return;
				}
				const row = element('button', 'mobile-watch-row');
				row.type = 'button';
				row.setAttribute('aria-label', `查看 ${instrument.symbol} ${marketLabel(instrument)} 图表`);
				const copy = element('span', 'mobile-market-name');
				copy.append(element('strong', '', symbolLabel(instrument)), element('small', '', `${marketFor(instrument).name} · ${marketLabel(instrument)}`));
				const values = element('span', 'mobile-market-price');
				const price = element('strong', '', '—');
				const change = element('small', '', '—');
				values.append(price, change);
				row.append(coinBadge(instrument), copy, values);
				row.onclick = () => select(instrument);
				watchRows.append(row);
				rowPrices.set(instrumentKey(instrument), { price, change });
			});
		}
		for (const [key, cells] of rowPrices) {
			const quote = quoteMap.get(key);
			if (!quote) continue;
			const sign = quote.change >= 0 ? '+' : '';
			cells.price.textContent = formatPrice(quote.price);
			cells.change.textContent = `${sign}${formatPrice(quote.change)}  ${sign}${quote.percent.toFixed(2)}%`;
			cells.change.className = quote.change >= 0 ? 'positive' : 'negative';
		}
		quoteLine.replaceChildren();
		const quote = active ? quoteMap.get(instrumentKey(active)) : undefined;
		if (quote) {
			const sign = quote.change >= 0 ? '+' : '';
			quoteLine.append(element('span', quote.change >= 0 ? 'positive' : 'negative', `${formatPrice(quote.price)}  ${sign}${formatPrice(quote.change)} (${sign}${quote.percent.toFixed(2)}%)`));
		}
		const connection = element('span', 'mobile-chart-demo', connectionText);
		connection.title = connectionText;
		quoteLine.append(connection);
	}

	function syncLayout(): void {
		clearGesture();
		closeSheetAnimated(true);
		app.classList.toggle('mobile-layout', media.matches);
		if (media.matches) {
			app.classList.remove('focus-mode', 'sidebar-open');
		} else if (fullscreen) {
			setFullscreen(false);
		}
		options.setLayout(media.matches);
		if (!wheelOpen) positionSymbolDrum(activeIndex(), false);
	}
	const onVisibility = (): void => { if (document.hidden) clearGesture(); };
	window.addEventListener('blur', clearGesture);
	window.addEventListener('pagehide', clearGesture);
	window.addEventListener('resize', syncLayout);
	document.addEventListener('visibilitychange', onVisibility);
	cleanups.push(() => {
		window.removeEventListener('blur', clearGesture);
		window.removeEventListener('pagehide', clearGesture);
		window.removeEventListener('resize', syncLayout);
		document.removeEventListener('visibilitychange', onVisibility);
	});
	showPage(page);
	syncLayout();

	return {
		isMobile: () => media.matches,
		setConnection(state: ConnectionState, message: string) {
			connectionText = state === 'live' ? 'Binance 实时' : message;
			renderQuotes();
		},
		setQuoteStatus(message: string) { quoteStatus.textContent = message; },
		setSyncStatus(message: string) { syncLabel = message; },
		refreshWatchlist() {
			if (!wheelOpen) positionSymbolDrum(activeIndex(), false);
			renderQuotes();
		},
		updateQuotes(quotes: Map<string, MarketQuote>) { quoteMap = quotes; renderQuotes(); },
		showChart: () => showPage('chart'),
		openIndicators,
		setDrawingActive(enabled: boolean) { drawButton.setAttribute('aria-pressed', String(enabled)); },
		setUndoEnabled(enabled: boolean) { quickUndo.disabled = !enabled; },
		update(instrument: Instrument | undefined, nextTimeframe: Timeframe, quotes: Map<string, MarketQuote>) {
			active = instrument;
			timeframe = nextTimeframe;
			quoteMap = quotes;
			period.textContent = TIMEFRAME_SHORT_LABELS[timeframe];
			period.title = timeframeLabels[timeframe];
			period.disabled = !active;
			drawButton.disabled = !active;
			objectsButton.disabled = !active;
			fullscreenButton.disabled = !active;
			if (!wheelOpen) positionSymbolDrum(activeIndex(), true);
			renderQuotes();
		},
		destroy() {
			clearGesture();
			clearTimeout(wheelCloseTimer);
			closeSheetAnimated(true);
			setFullscreen(false);
			for (const cleanup of cleanups) cleanup();
			for (const node of [watchPage, chartBar, navigation, sheet, wheel, quoteLine]) node.remove();
			app.classList.remove('mobile-layout');
		},
	};
}
