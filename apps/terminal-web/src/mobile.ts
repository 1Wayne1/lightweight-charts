import { instrumentKey, type ConnectionState, type Instrument, type MarketQuote, type Timeframe } from '@terminal/domain';
import type { IndicatorSettings } from './chart';
import { TIMEFRAME_GROUPS, TIMEFRAME_LONG_LABELS } from './data/timeframes';
import { HoldSwitcher } from './hold-switcher';
import { renderIndicatorPanel } from './indicator-ui';
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
	openSearch(): void;
	openDrawings(): void;
	openDrawingObjects(): void;
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
	let quoteMap = new Map<string, MarketQuote>();
	const cleanups: (() => void)[] = [];
	const watchPage = element('section', 'mobile-watch-page');
	watchPage.id = 'mobile-watch-page';
	watchPage.setAttribute('aria-label', '手机自选表');
	const watchHeader = element('header', 'mobile-watch-header');
	const watchBrand = element('span', 'mobile-brand');
	watchBrand.append(icon('logo'), document.createTextNode('Crypto Terminal'));
	watchHeader.append(watchBrand, iconButton('search', '搜索自选交易对', () => options.openSearch()));
	const watchTitle = element('div', 'mobile-watch-title');
	const heading = element('h1');
	heading.append(element('span', 'flag'), document.createTextNode('自选表'));
	const quoteStatus = element('span', 'mobile-demo-tag', 'Binance · 连接中');
	watchTitle.append(heading, quoteStatus);
	const watchRows = element('div', 'mobile-watch-rows');
	watchPage.append(watchHeader, watchTitle, watchRows);

	const chartBar = element('div', 'mobile-chartbar');
	const symbol = element('button', 'mobile-symbol');
	symbol.type = 'button';
	symbol.setAttribute('aria-label', '切换交易对，长按并上下滑动');
	symbol.setAttribute('aria-expanded', 'false');
	symbol.setAttribute('aria-controls', 'mobile-symbol-wheel');
	symbol.title = '轻点搜索；长按后上下滑动，松手切换';
	const period = element('button', 'mobile-period');
	period.setAttribute('aria-label', '选择日期范围和周期');
	period.onclick = () => openPeriodSheet();
	const drawButton = iconButton('brush', '绘图工具', () => options.openDrawings());
	drawButton.setAttribute('aria-pressed', 'false');
	const indicatorButton = iconButton('indicator', '手机图表指标', () => openIndicators());
	const moreButton = iconButton('more', '图表选项', () => openChartOptions());
	const fitButton = iconButton('fit', '适应图表', () => options.fitChart());
	chartBar.append(symbol, period, drawButton, indicatorButton, moreButton, fitButton);
	const navigation = element('nav', 'mobile-navigation');
	navigation.setAttribute('aria-label', '手机主导航');
	const watchTab = element('button', 'mobile-nav-item');
	watchTab.append(icon('list'), element('span', '', '自选表'));
	watchTab.setAttribute('aria-controls', watchPage.id);
	watchTab.onclick = () => showPage('watchlist');
	const chartTab = element('button', 'mobile-nav-item');
	chartTab.append(icon('candles'), element('span', '', '图表'));
	chartTab.onclick = () => showPage('chart');
	navigation.append(watchTab, chartTab);
	const quoteLine = element('div', 'mobile-chart-quote');
	options.priceOverlay.insertBefore(quoteLine, options.priceOverlay.children[1] ?? null);

	// Shared light bottom sheet: period, indicators, and chart actions.
	const sheet = element('dialog', 'mobile-sheet');
	sheet.setAttribute('aria-labelledby', 'mobile-sheet-title');
	const handle = element('button', 'sheet-handle');
	handle.setAttribute('aria-label', '展开或收起面板');
	handle.append(element('span'));
	handle.onclick = () => sheet.classList.toggle('expanded');
	const sheetHeader = element('div', 'mobile-sheet-header');
	const sheetTitle = element('h2');
	sheetTitle.id = 'mobile-sheet-title';
	sheetHeader.append(sheetTitle, iconButton('close', '关闭底部面板', () => sheet.close()));
	const sheetBody = element('div', 'mobile-sheet-body');
	sheet.append(handle, sheetHeader, sheetBody);
	sheet.addEventListener('click', event => {
		if (event.target === sheet) {
			const rect = sheet.getBoundingClientRect();
			if (event.clientY < rect.top || event.clientX < rect.left || event.clientX > rect.right) sheet.close();
		}
	});
	let dragStart: number | undefined;
	let handleDragged = false;
	handle.addEventListener('pointerdown', event => {
		if (!event.isPrimary) return;
		dragStart = event.clientY;
		handleDragged = false;
		handle.setPointerCapture(event.pointerId);
	});
	handle.addEventListener('pointermove', event => {
		if (dragStart === undefined || !handle.hasPointerCapture(event.pointerId)) return;
		const delta = event.clientY - dragStart;
		if (Math.abs(delta) < 24) return;
		handleDragged = true;
		if (delta < 0) sheet.classList.add('expanded');
		else if (delta > 90) sheet.close();
		else sheet.classList.remove('expanded');
	});
	handle.addEventListener('pointerup', () => { dragStart = undefined; });
	handle.addEventListener('pointercancel', () => { dragStart = undefined; });
	handle.addEventListener('click', event => {
		if (handleDragged) { event.preventDefault(); event.stopImmediatePropagation(); handleDragged = false; }
	}, { capture: true });

	const wheel = element('div', 'mobile-symbol-wheel');
	wheel.id = 'mobile-symbol-wheel';
	wheel.hidden = true;
	wheel.setAttribute('role', 'listbox');
	wheel.setAttribute('aria-label', '滑动选择交易对');
	const wheelRows = element('div', 'symbol-wheel-rows');
	const wheelHint = element('div', 'symbol-wheel-hint', '上下滑动 · 松手切换');
	wheel.append(wheelRows, wheelHint);
	app.append(watchPage, chartBar, navigation, sheet, wheel);

	let previewIndex = 0;
	let keyboardWheel = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let pointerId: number | undefined;
	let suppressClick = false;
	const gesture = new HoldSwitcher();
	const activeIndex = (): number => Math.max(0, instruments.findIndex(item => active && instrumentKey(item) === instrumentKey(active)));

	function renderSymbol(index = activeIndex()): void {
		symbol.replaceChildren();
		if (!active && wheel.hidden) {
			symbol.append(element('span', 'symbol-current', '搜索交易对'));
			return;
		}
		for (const offset of [-1, 0, 1]) {
			const item = instruments[index + offset];
			symbol.append(element('span', offset === 0 ? 'symbol-current' : 'symbol-neighbor', item ? symbolLabel(item) : ''));
		}
	}

	function preview(index: number): void {
		previewIndex = index;
		wheelHint.textContent = keyboardWheel ? '↑ ↓ 选择 · Enter 确认 · Esc 取消' : '上下滑动 · 松手切换';
		wheelRows.replaceChildren();
		for (let offset = -3; offset <= 3; offset++) {
			const item = instruments[index + offset];
			const row = element('div', `symbol-wheel-row distance-${Math.abs(offset)}`);
			row.setAttribute('role', 'option');
			row.id = `wheel-option-${index + offset}`;
			row.setAttribute('aria-selected', String(offset === 0));
			if (item) row.append(coinBadge(item), element('span', '', symbolLabel(item)));
			else row.setAttribute('aria-hidden', 'true');
			wheelRows.append(row);
		}
		wheel.hidden = false;
		symbol.setAttribute('aria-expanded', 'true');
		wheel.setAttribute('aria-activedescendant', `wheel-option-${index}`);
		renderSymbol(index);
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
		wheel.hidden = true;
		symbol.setAttribute('aria-expanded', 'false');
		wheel.removeAttribute('aria-activedescendant');
		renderSymbol();
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
				preview(selected);
			}
		}, 320);
	});
	const onSymbolPointerMove = (event: PointerEvent): void => {
		if (pointerId !== event.pointerId) return;
		const selected = gesture.move(event.pointerId, event.clientX, event.clientY);
		if (!gesture.isTracking(event.pointerId)) {
			suppressClick = true;
			clearTimeout(timer);
		}
		if (selected !== null && (wheel.hidden || selected !== previewIndex)) preview(selected);
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
		} else preview(Math.max(0, Math.min(instruments.length - 1, previewIndex + (event.key === 'ArrowDown' ? 1 : -1))));
	});
	symbol.addEventListener('blur', () => { if (keyboardWheel) clearGesture(); });

	function select(instrument: Instrument): void {
		showPage('chart');
		if (!active || instrumentKey(instrument) !== instrumentKey(active)) options.openInstrument(instrument);
	}

	function showPage(next: typeof page): void {
		clearGesture();
		sheet.close();
		page = next;
		app.dataset.mobilePage = page;
		watchTab.setAttribute('aria-current', page === 'watchlist' ? 'page' : 'false');
		chartTab.setAttribute('aria-current', page === 'chart' ? 'page' : 'false');
	}

	function openSheet(title: string): void {
		clearGesture();
		sheetTitle.textContent = title;
		sheetBody.replaceChildren();
		sheet.classList.remove('expanded');
		if (!sheet.open) sheet.showModal();
	}

	function openPeriodSheet(): void {
		openSheet('日期范围');
		const dateRanges = element('div', 'sheet-chips date-chips');
		for (const [label, seconds] of [['1天', 86400], ['5天', 432000], ['1个月', 2592000], ['3个月', 7776000], ['6个月', 15552000], ['全部', 0]] as const) {
			const button = element('button', 'sheet-chip', label);
			button.setAttribute('aria-label', `日期范围 ${label}`);
			button.onclick = () => { options.setRange(seconds); sheet.close(); };
			dateRanges.append(button);
		}
		sheetBody.append(dateRanges, element('h3', 'sheet-section-title', '周期'));
		for (const group of TIMEFRAME_GROUPS) {
			const section = element('section', 'period-section');
			section.append(element('h4', '', group.label));
			const chips = element('div', 'sheet-chips');
			for (const value of group.timeframes) {
				const button = element('button', 'sheet-chip', timeframeLabels[value]);
				button.setAttribute('aria-pressed', String(value === timeframe));
				button.setAttribute('aria-label', `手机周期 ${value}`);
				button.onclick = () => { options.setTimeframe(value); sheet.close(); };
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
		const undo = element('button', 'sheet-action', '撤销画线');
		undo.disabled = !history.canUndo; undo.onclick = () => { history.undo(); sheet.close(); };
		const redo = element('button', 'sheet-action', '重做画线');
		redo.disabled = !history.canRedo; redo.onclick = () => { history.redo(); sheet.close(); };
		const objects = element('button', 'sheet-action', '绘图对象与备份');
		objects.disabled = !active;
		objects.onclick = () => { sheet.close(); options.openDrawingObjects(); };
		const fit = element('button', 'sheet-action', '适应全部数据');
		fit.onclick = () => { options.fitChart(); sheet.close(); };
		const search = element('button', 'sheet-action', '搜索交易对');
		search.onclick = () => { sheet.close(); options.openSearch(); };
		sheetBody.append(objects, undo, redo, fit, search, element('p', 'mobile-sheet-note', 'Binance 现货 / USDT 永续 · 周期与画线保存在本机 · 云同步未接入'));
	}

	const rowPrices = new Map<string, { price: HTMLElement; change: HTMLElement }>();
	let renderedSymbols = '';
	let connectionText = '连接中';
	function renderQuotes(): void {
		const signature = instruments.map(instrumentKey).join(',');
		if (signature !== renderedSymbols) {
			renderedSymbols = signature;
			watchRows.replaceChildren();
			rowPrices.clear();
			for (const instrument of instruments) {
				const row = element('button', 'mobile-watch-row');
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
			}
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
		sheet.close();
		app.classList.toggle('mobile-layout', media.matches);
		if (media.matches) app.classList.remove('focus-mode', 'sidebar-open');
		options.setLayout(media.matches);
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
		updateQuotes(quotes: Map<string, MarketQuote>) { quoteMap = quotes; renderQuotes(); },
		showChart: () => showPage('chart'),
		openIndicators,
		setDrawingActive(enabled: boolean) { drawButton.setAttribute('aria-pressed', String(enabled)); },
		update(instrument: Instrument | undefined, nextTimeframe: Timeframe, quotes: Map<string, MarketQuote>) {
			active = instrument;
			timeframe = nextTimeframe;
			quoteMap = quotes;
			period.textContent = timeframeLabels[timeframe];
			period.disabled = !active;
			drawButton.disabled = !active;
			if (wheel.hidden) renderSymbol();
			renderQuotes();
		},
		destroy() {
			clearGesture();
			sheet.close();
			for (const cleanup of cleanups) cleanup();
			for (const node of [watchPage, chartBar, navigation, sheet, wheel, quoteLine]) node.remove();
			app.classList.remove('mobile-layout');
		},
	};
}
