import { TIMEFRAME_SECONDS, closeTab, emptyWorkspace, instrumentKey, openInstrument, parseWorkspace, setTimeframe, type Candle, type ConnectionState, type Instrument, type MarketQuote, type Workspace } from '@terminal/domain';
import { CrosshairMode } from 'lightweight-charts';
import { createTerminalChart, type ChartLayout, type IndicatorSettings, type TerminalChart } from './chart';
import { INDICATOR_CATALOG, getCatalogIndicator } from './data/indicator-catalog';
import {
	INDICATOR_STORAGE_KEY, activePaneOrder, defaultIndicatorSettings, isIndicatorEnabled, isIndicatorVisible, setIndicatorVisible,
	moveVisiblePane, parseIndicatorSettings, setIndicatorEnabled, type PaneId,
} from './data/indicators';
import { TIMEFRAME_LONG_LABELS } from './data/timeframes';
import { renderIndicatorPanel } from './indicator-ui';
import { indicatorLegendRow, updateIndicatorLegendValues } from './indicator-legend';
import { createTimeframeUI } from './timeframe-ui';
import { catalogue, coinBadge, formatPrice, instruments, marketFor, marketLabel, priceTick, registerInstruments, symbolLabel } from './markets';
import { BinanceProvider, defaultEndpoints } from './data/binance';
import { startCandleFeed } from './data/candle-feed';
import { startQuoteFeed } from './data/quote-feed';
import { migrateDemoWorkspace } from './data/workspace-migration';
import { createMobileUI } from './mobile';
import { element, icon, iconButton, unavailableButton } from './ui';
import { createDrawingSession, type DrawingSession } from './drawings/session';
import { createPriceAxisShortcut } from './drawings/price-axis-shortcut';
import { createDrawingUI } from './drawings/ui';
import './style.css';
import './mobile.css';
import './indicator-legend.css';

const STORAGE_KEY = 'crypto-terminal.workspace.v1';
const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing application root');
app.replaceChildren();

let storageNotice = '设置保存在本机';
let state: Workspace;
try {
	const stored = localStorage.getItem(STORAGE_KEY);
	state = stored ? migrateDemoWorkspace(parseWorkspace(JSON.parse(stored))) : openInstrument(openInstrument(emptyWorkspace(), instruments[0]), instruments[1]);
} catch {
	state = openInstrument(emptyWorkspace(), instruments[0]);
	storageNotice = '本机记录不可用，当前为临时工作区';
}
let chart: TerminalChart | undefined;
let drawingSession: DrawingSession | undefined;
let priceAxisShortcut: ReturnType<typeof createPriceAxisShortcut> | undefined;
const provider = new BinanceProvider({
	spotRest: import.meta.env.VITE_BINANCE_SPOT_REST || defaultEndpoints.spotRest,
	perpetualRest: import.meta.env.VITE_BINANCE_PERPETUAL_REST || defaultEndpoints.perpetualRest,
	spotWs: import.meta.env.VITE_BINANCE_SPOT_WS || defaultEndpoints.spotWs,
	perpetualWs: import.meta.env.VITE_BINANCE_PERPETUAL_WS || defaultEndpoints.perpetualWs,
});
let feed: ReturnType<typeof startCandleFeed> | undefined;
let stopQuotes: (() => void) | undefined;
let catalogueRequest: AbortController | undefined;
let quoteFlush: ReturnType<typeof setTimeout> | undefined;
let quoteSubscription = '';
const quoteStates = { spot: '连接中', perpetual: '连接中' };
let catalogueNotice = '正在加载 Binance 交易对…';
let searchMarket: 'all' | Instrument['market'] = 'all';
let renderVersion = 0;
let candleCount = 0;
let crosshairVisible = true;
let settings: IndicatorSettings;
try {
	const rawIndicators = localStorage.getItem(INDICATOR_STORAGE_KEY);
	settings = rawIndicators ? parseIndicatorSettings(JSON.parse(rawIndicators)) : defaultIndicatorSettings();
} catch {
	settings = defaultIndicatorSettings();
}

// Compact tab strip and shared chart controls.
const tabstrip = element('header', 'tabstrip');
const brand = element('div', 'brand');
brand.title = 'Crypto Terminal · 看盘工作台';
brand.append(icon('logo'));
const tabs = element('nav', 'tabs');
tabs.setAttribute('aria-label', '交易对标签页');
const addTab = iconButton('plus', '打开交易对', () => openPicker());
addTab.classList.add('add-tab');
const appName = element('span', 'app-name', 'CRYPTO TERMINAL');
tabstrip.append(brand, tabs, addTab, appName);

const toolbar = element('div', 'toolbar');
const symbolButton = element('button', 'symbol-button');
symbolButton.onclick = () => openPicker();
symbolButton.title = '搜索交易对';
const periods = element('div', 'periods');
periods.setAttribute('aria-label', '图表周期');
const timeframeUI = createTimeframeUI(app, periods, timeframe => {
	if (state.activeTabId) commit(setTimeframe(state, state.activeTabId, timeframe));
});
const separator = (): HTMLSpanElement => element('span', 'separator');
const chartType = iconButton('candles', '蜡烛图');
chartType.disabled = true;
const indicatorButton = element('button', 'tool-label indicator-trigger');
indicatorButton.type = 'button';
indicatorButton.setAttribute('aria-label', '打开指标下拉菜单');
indicatorButton.setAttribute('aria-haspopup', 'true');
indicatorButton.setAttribute('aria-expanded', 'false');
indicatorButton.append(icon('indicator'), element('span', '', '指标'), icon('chevron'));
indicatorButton.onclick = () => toggleIndicatorDropdown();
const alertButton = unavailableButton('clock', '价格提醒');
alertButton.classList.add('secondary-tool');
const replayButton = unavailableButton('replay', '行情回放');
replayButton.classList.add('secondary-tool');
const spacer = element('span', 'spacer');
const demoBadge = element('span', 'demo-badge', 'Binance');
const focusButton = iconButton('fit', '专注模式', () => {
	const enabled = app.classList.toggle('focus-mode');
	focusButton.setAttribute('aria-pressed', String(enabled));
	updateSidebarAccessibility();
});
focusButton.setAttribute('aria-pressed', 'false');
const watchButton = iconButton('list', '切换自选列表', () => toggleWatchlist());
watchButton.setAttribute('aria-controls', 'watchlist');
toolbar.append(symbolButton, separator(), periods, separator(), chartType, indicatorButton, alertButton, replayButton, spacer, demoBadge, focusButton, watchButton);

const workspace = element('main', 'workspace');
const drawingRail = element('aside', 'drawing-rail');
drawingRail.setAttribute('aria-label', '图表与绘图工具');
const chartPanel = element('section', 'chart-panel');
chartPanel.setAttribute('aria-label', '行情图表');
const priceOverlay = element('div', 'price-overlay');
const chartHeading = element('div', 'chart-heading');
const title = element('h1', 'chart-title');
const marketStatus = element('span', 'market-status');
marketStatus.append(element('i', 'market-status-dot'), element('span', '', '连接中'));
chartHeading.append(title, marketStatus);
const ohlc = element('div', 'ohlc');
const stageWrap = element('div', 'stage-wrap');
const stage = element('div', 'chart-stage');
stage.setAttribute('aria-label', 'K 线图');
const indicatorLegend = element('div', 'indicator-legend');
priceOverlay.append(chartHeading, ohlc, indicatorLegend);
const subPaneLabels = new Map<string, HTMLDivElement>();
const paneCornerActions = new Map<PaneId, HTMLDivElement>();
const emptyState = element('div', 'chart-empty');
stageWrap.append(stage, priceOverlay, emptyState);
const rangebar = element('div', 'rangebar');
const ranges = element('div', 'ranges');
for (const [label, seconds] of [['1天', 86400], ['5天', 432000], ['1个月', 2592000], ['3个月', 7776000], ['全部', 0]] as const) {
	const button = element('button', '', label);
	button.onclick = () => {
		setDateRange(seconds);
		for (const item of ranges.querySelectorAll('button')) item.classList.toggle('selected', item === button);
	};
	ranges.append(button);
}
const resetChart = iconButton('fit', '适应全部数据', () => chart?.chart.timeScale().fitContent());
const timeLabel = element('span', 'time-label');
rangebar.append(ranges, resetChart, element('span', 'spacer'), timeLabel);
chartPanel.append(stageWrap, rangebar);

// Quotes and charts share market-qualified instrument identities.
const watchlist = element('aside', 'watchlist');
watchlist.id = 'watchlist';
watchlist.setAttribute('aria-label', '自选列表');
const watchHeading = element('div', 'watch-heading');
const watchTitle = element('h2');
watchTitle.append(element('span', 'flag'), document.createTextNode('自选列表'));
watchHeading.append(watchTitle, element('span', 'spacer'), iconButton('plus', '添加交易对', () => openPicker()));
const closeWatchlist = iconButton('close', '关闭自选列表', () => toggleWatchlist(false));
closeWatchlist.classList.add('close-watchlist');
watchHeading.append(closeWatchlist);
const table = element('table', 'watch-table');
const tableHead = element('thead');
const headings = element('tr');
for (const name of ['交易对', '最新价', '24h 涨跌']) headings.append(element('th', '', name));
tableHead.append(headings);
const tableBody = element('tbody');
table.append(tableHead, tableBody);
const quoteRows = new Map<string, { row: HTMLTableRowElement; price: HTMLTableCellElement; change: HTMLTableCellElement }>();
const quotes = new Map<string, MarketQuote>();
function renderWatchRows(): void {
	tableBody.replaceChildren();
	quoteRows.clear();
	for (const instrument of instruments) {
		const key = instrumentKey(instrument);
		const row = element('tr');
		const symbolCell = element('td');
		const open = element('button', 'watch-symbol');
		open.setAttribute('aria-label', `打开 ${instrument.symbol} ${marketLabel(instrument)}`);
		open.append(coinBadge(instrument), element('span', '', symbolLabel(instrument)));
		open.onclick = () => commit(openInstrument(state, instrument));
		symbolCell.append(open);
		const quote = quotes.get(key);
		const price = element('td', 'quote-price', quote ? formatPrice(quote.price) : '—');
		const change = element('td', `quote-change ${quote ? quote.percent >= 0 ? 'positive' : 'negative' : ''}`, quote ? `${quote.percent >= 0 ? '+' : ''}${quote.percent.toFixed(2)}%` : '—');
		row.append(symbolCell, price, change);
		tableBody.append(row);
		quoteRows.set(key, { row, price, change });
	}
}
renderWatchRows();
const watchNote = element('div', 'watch-note', 'Binance · USDT 现货 / 永续');
const detail = element('section', 'market-detail');
detail.setAttribute('aria-label', '交易对详情');
watchlist.append(watchHeading, table, watchNote, element('div', 'watch-spacer'), detail);
const sidebarScrim = element('button', 'sidebar-scrim');
sidebarScrim.setAttribute('aria-label', '收起自选列表');
sidebarScrim.onclick = () => toggleWatchlist(false);
const rightRail = element('aside', 'right-rail');
rightRail.setAttribute('aria-label', '侧边面板');
const railWatch = iconButton('list', '自选列表面板', () => toggleWatchlist());
rightRail.append(railWatch, unavailableButton('clock', '提醒'), iconButton('layers', '绘图对象树', () => drawingUI.openObjects()), unavailableButton('calendar', '财经日历'));
const rightBottom = element('div', 'rail-bottom');
rightBottom.append(unavailableButton('bell', '通知'), iconButton('help', '使用说明', () => about.showModal()));
rightRail.append(rightBottom);
workspace.append(drawingRail, chartPanel, sidebarScrim, watchlist, rightRail);

const footer = element('footer', 'statusbar');
const status = element('span', 'save-status');
status.setAttribute('role', 'status');
const sourceStatus = element('span', 'source-status');
sourceStatus.append(element('i', 'status-dot'), document.createTextNode('Binance · 连接中'));
footer.append(sourceStatus, element('span', 'footer-divider'), status, element('span', 'spacer'), element('span', 'sync-status', '云同步未连接'));

// Native dialogs keep search and information available on narrow screens, too.
const picker = element('dialog', 'symbol-dialog');
const dialogHead = element('div', 'dialog-heading');
dialogHead.append(element('h2', '', '搜索交易对'), iconButton('close', '关闭交易对搜索', () => picker.close()));
const searchWrap = element('div', 'search-field');
const search = element('input');
search.type = 'search';
search.placeholder = '搜索名称或交易对';
search.setAttribute('aria-label', '搜索名称或交易对');
searchWrap.append(icon('search'), search);
const searchResults = element('div', 'search-results');
const searchFilters = element('div', 'search-filters');
for (const [value, label] of [['all', '全部'], ['spot', '现货'], ['perpetual', 'USDT 永续']] as const) {
	const button = element('button', '', label);
	button.dataset.market = value;
	button.onclick = () => { searchMarket = value; renderSearch(); };
	searchFilters.append(button);
}
const searchNotice = element('div', 'search-category');
picker.append(dialogHead, searchWrap, searchFilters, searchNotice, searchResults);
search.oninput = renderSearch;
const about = element('dialog', 'about-dialog');
const aboutHead = element('div', 'dialog-heading');
aboutHead.append(element('h2', '', 'Crypto Terminal'), iconButton('close', '关闭说明', () => about.close()));
const attribution = element('a', '', 'TradingView Lightweight Charts™');
attribution.href = 'https://www.tradingview.com/';
attribution.target = '_blank';
attribution.rel = 'noopener noreferrer';
about.append(aboutHead, element('p', '', '为你的市场观察，留一个专注的空间。'),
	element('p', '', '从顶部或自选列表打开交易对，各标签独立保存周期。使用“指标”切换均线、成交量与 MACD。'),
	element('p', '', '行情来自 Binance USDT 现货和永续公开接口，无需 API Key。设置和画线自动保存在本机。云同步尚未连接。'),
	attribution, element('small', '', 'Copyright (с) 2025 TradingView, Inc.'));
const indicatorDropdown = element('div', 'indicator-dropdown');
indicatorDropdown.hidden = true;
indicatorDropdown.setAttribute('role', 'dialog');
indicatorDropdown.setAttribute('aria-label', '指标选择与设置');
const indicatorHead = element('div', 'indicator-dropdown-head');
const indicatorHeadTitle = element('div', 'indicator-dropdown-title');
indicatorHeadTitle.append(element('h2', '', '指标'), element('span', 'tv-engine-tag', 'trading-signals'));
indicatorHead.append(indicatorHeadTitle, iconButton('close', '关闭指标菜单', () => closeIndicatorDropdown()));
const indicatorDropdownBody = element('div', 'indicator-dropdown-body');
indicatorDropdown.append(indicatorHead, indicatorDropdownBody);
app.append(tabstrip, toolbar, workspace, footer, picker, about, indicatorDropdown);

let lastChartLayout: ChartLayout = { panes: {}, rightScaleWidth: 78, maximizedPane: null };
let hoveredPane: PaneId | null = null;

function syncHoveredPaneVisual(): void {
	for (const [id, bar] of paneCornerActions) {
		bar.classList.toggle('is-hovered', hoveredPane === id);
	}
}

function updateHoveredPaneFromY(clientY: number): void {
	const rect = stageWrap.getBoundingClientRect();
	const y = clientY - rect.top;
	let hit: PaneId | null = null;
	for (const [id, bounds] of Object.entries(lastChartLayout.panes)) {
		if (!bounds.visible || bounds.height <= 0) continue;
		if (y >= bounds.top && y <= bounds.top + bounds.height) {
			hit = id;
			break;
		}
	}
	if (hit !== hoveredPane) {
		hoveredPane = hit;
		syncHoveredPaneVisual();
	}
}

stageWrap.addEventListener('pointermove', event => {
	if (event.pointerType === 'touch') return;
	updateHoveredPaneFromY(event.clientY);
});
stageWrap.addEventListener('pointerleave', () => {
	if (hoveredPane !== null) {
		hoveredPane = null;
		syncHoveredPaneVisual();
	}
});

function positionIndicatorDropdown(): void {
	const rect = indicatorButton.getBoundingClientRect();
	const width = Math.min(680, window.innerWidth - 20);
	const left = Math.max(10, Math.min(rect.left, window.innerWidth - width - 10));
	indicatorDropdown.style.left = `${left}px`;
	indicatorDropdown.style.top = `${Math.round(rect.bottom + 6)}px`;
	indicatorDropdown.style.width = `${width}px`;
}

function openIndicatorDropdown(focusId?: string): void {
	timeframeUI.close();
	if (mobile.isMobile()) {
		mobile.openIndicators(focusId);
		return;
	}
	renderIndicatorPanel(indicatorDropdownBody, settings, applyIndicators, focusId ? { initialFocusId: focusId } : {});
	positionIndicatorDropdown();
	indicatorDropdown.hidden = false;
	indicatorButton.setAttribute('aria-expanded', 'true');
	const input = indicatorDropdownBody.querySelector<HTMLInputElement>('input[type="search"]');
	if (!focusId) input?.focus();
}

function closeIndicatorDropdown(): void {
	if (indicatorDropdown.hidden) return;
	indicatorDropdown.hidden = true;
	indicatorButton.setAttribute('aria-expanded', 'false');
}

function toggleIndicatorDropdown(): void {
	if (indicatorDropdown.hidden) openIndicatorDropdown();
	else closeIndicatorDropdown();
}

function visiblePaneSet(): Set<PaneId> {
	return new Set<PaneId>(activePaneOrder(settings));
}

function applyIndicators(): void {
	try {
		localStorage.setItem(INDICATOR_STORAGE_KEY, JSON.stringify(settings));
	} catch {
		// Ignore localStorage quota/availability errors for indicator preferences.
	}
	chart?.setIndicators(settings);
	updateIndicatorLabels();
}

function syncPriceOverlayHeight(): void {
	const h = priceOverlay.hidden ? 0 : priceOverlay.offsetHeight;
	stageWrap.style.setProperty('--price-overlay-h', `${h}px`);
}

function applyPaneLayout(layout: ChartLayout): void {
	const prevMax = lastChartLayout.maximizedPane;
	lastChartLayout = layout;
	const priceBounds = layout.panes.price;
	const priceVisible = !priceBounds || priceBounds.visible;
	const priceTop = priceBounds?.top ?? 0;
	const rightWidth = Math.round(layout.rightScaleWidth);

	stageWrap.style.setProperty('--main-pane-top', `${priceTop}px`);
	stageWrap.style.setProperty('--price-scale-width', `${rightWidth}px`);
	stageWrap.classList.toggle('price-pane-hidden', !priceVisible);

	priceOverlay.style.top = `${priceTop + 8}px`;
	priceOverlay.hidden = !state.activeTabId || !priceVisible;

	for (const [id, el] of subPaneLabels) {
		const bounds = layout.panes[id];
		const visible = Boolean(state.activeTabId && (!bounds || bounds.visible));
		el.hidden = !visible || (settings.legendCollapsed && layout.maximizedPane !== id);
		if (bounds) el.style.top = `${bounds.top + 8}px`;
	}

	for (const [id, bar] of paneCornerActions) {
		const bounds = layout.panes[id];
		const visible = Boolean(state.activeTabId && (!bounds || bounds.visible));
		bar.hidden = !visible;
		if (bounds) bar.style.top = `${bounds.top + 8}px`;
		bar.style.right = `${rightWidth + 10}px`;
	}

	if (prevMax !== layout.maximizedPane) updateIndicatorLabels();
	syncPriceOverlayHeight();
	syncHoveredPaneVisual();
}

const drawingUI = createDrawingUI(app, drawingRail, stageWrap, active => mobile?.setDrawingActive(active), mode => {
	crosshairVisible = mode === 'cross';
	chart?.chart.applyOptions({ crosshair: { mode: crosshairVisible ? drawingSession?.manager.magnetMode() === 'strong' ? CrosshairMode.MagnetOHLC : CrosshairMode.Normal : CrosshairMode.Hidden } });
});
const railBottom = element('div', 'rail-bottom');
railBottom.append(iconButton('help', '关于看盘工作台', () => about.showModal()));
drawingRail.append(railBottom);

const mobile = createMobileUI({
	openDrawings: () => drawingUI.openTools(),
	openDrawingObjects: () => drawingUI.openObjects(),
	drawingHistory: () => ({
		canUndo: drawingSession?.manager.canUndo() ?? false,
		canRedo: drawingSession?.manager.canRedo() ?? false,
		undo: () => drawingSession?.manager.undo(),
		redo: () => drawingSession?.manager.redo(),
	}),
	app, priceOverlay, settings,
	openInstrument: instrument => commit(openInstrument(state, instrument)),
	openSearch: openPicker,
	setTimeframe: timeframe => {
		if (state.activeTabId) commit(setTimeframe(state, state.activeTabId, timeframe));
	},
	setRange: setDateRange,
	setIndicators: applyIndicators,
	fitChart: () => chart?.chart.timeScale().fitContent(),
	setLayout: enabled => chart?.setMobileLayout(enabled),
});

function setDateRange(seconds: number): void {
	if (!chart || !state.activeTabId || candleCount === 0) return;
	const tab = state.tabs.find(item => item.id === state.activeTabId);
	if (!tab) return;
	const timeframe = state.preferences[tab.instrumentKey].timeframe;
	const bars = seconds === 0 ? candleCount : Math.min(candleCount, Math.ceil(seconds / TIMEFRAME_SECONDS[timeframe]));
	chart.chart.timeScale().setVisibleLogicalRange({ from: candleCount - bars, to: candleCount + 3 });
}

function openPicker(): void {
	if (catalogueNotice.includes('失败')) void loadCatalogue();
	search.value = '';
	renderSearch();
	picker.showModal();
	search.focus();
}

function renderSearch(): void {
	searchResults.replaceChildren();
	const query = search.value.trim().toLowerCase();
	searchFilters.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.market === searchMarket)));
	searchNotice.textContent = catalogueNotice;
	const results = catalogue.filter(instrument => (searchMarket === 'all' || instrument.market === searchMarket) && `${instrument.symbol} ${symbolLabel(instrument)} ${marketFor(instrument).name}`.toLowerCase().includes(query)).slice(0, 100);
	for (const instrument of results) {
		const button = element('button', 'search-result');
		const copy = element('span', 'search-copy');
		copy.append(element('strong', '', instrument.symbol.replace('-', ' / ')), element('small', '', marketFor(instrument).name));
		button.append(coinBadge(instrument), copy, element('span', 'search-venue', `BINANCE · ${marketLabel(instrument)}`), icon('plus'));
		button.onclick = () => {
			if (mobile.isMobile()) mobile.showChart();
			commit(openInstrument(state, instrument));
			picker.close();
		};
		searchResults.append(button);
	}
	if (results.length === 0) searchResults.append(element('p', 'search-empty', '没有找到匹配的交易对'));
}

function toggleWatchlist(force?: boolean): void {
	app?.classList.remove('focus-mode');
	focusButton.setAttribute('aria-pressed', 'false');
	const narrow = window.matchMedia('(max-width: 1050px)').matches;
	const open = force ?? !(narrow ? app?.classList.contains('sidebar-open') : !app?.classList.contains('watchlist-hidden'));
	app?.classList.toggle('sidebar-open', open);
	app?.classList.toggle('watchlist-hidden', !open);
	watchButton.setAttribute('aria-expanded', String(open));
	railWatch.setAttribute('aria-pressed', String(open));
}

function commit(next: Workspace): void {
	state = next;
	ensureWatchlist();
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
		storageNotice = '已保存到本机';
	} catch {
		storageNotice = '保存失败，修改仅在当前会话中有效';
	}
	render();
}

function renderPaneCornerActions(paneId: PaneId, label: string, activeOrder: PaneId[]): void {
	const maximized = chart?.getMaximizedPane() ?? lastChartLayout.maximizedPane;
	const isMaximized = maximized === paneId;
	const index = activeOrder.indexOf(paneId);
	const isSubPane = paneId !== 'price';

	let bar = paneCornerActions.get(paneId);
	if (!bar) {
		bar = element('div', 'pane-corner-actions');
		bar.dataset.pane = paneId;
		stageWrap.append(bar);
		paneCornerActions.set(paneId, bar);
	}
	bar.replaceChildren();
	bar.classList.toggle('is-maximized', isMaximized);

	if (!isMaximized && activeOrder.length >= 2 && index >= 0) {
		const visible = visiblePaneSet();
		if (index > 0) {
			const up = iconButton('arrowUp', `上移${label}`, () => {
				settings.paneOrder = moveVisiblePane(activeOrder, visible, paneId, -1);
				applyIndicators();
			});
			up.className = 'pane-corner-btn';
			bar.append(up);
		}
		if (index < activeOrder.length - 1) {
			const down = iconButton('arrowDown', `下移${label}`, () => {
				settings.paneOrder = moveVisiblePane(activeOrder, visible, paneId, 1);
				applyIndicators();
			});
			down.className = 'pane-corner-btn';
			bar.append(down);
		}
	}

	if (activeOrder.length >= 2 || isMaximized) {
		const maxBtn = iconButton(
			isMaximized ? 'minimize' : 'maximize',
			isMaximized ? `还原${label}` : `最大化${label}`,
			() => {
				chart?.setMaximizedPane(isMaximized ? null : paneId);
				updateIndicatorLabels();
			},
		);
		maxBtn.className = `pane-corner-btn${isMaximized ? ' active' : ''}`;
		maxBtn.setAttribute('aria-pressed', String(isMaximized));
		bar.append(maxBtn);
	}

	if (isSubPane) {
		const def = getCatalogIndicator(paneId);
		const cfgBtn = iconButton('settings', `设置 ${def?.shortName ?? paneId}`, () => openIndicatorDropdown(paneId));
		cfgBtn.className = 'pane-corner-btn';
		const closeBtn = iconButton('close', `移除 ${def?.shortName ?? paneId}`, () => {
			if (isMaximized) chart?.setMaximizedPane(null);
			setIndicatorEnabled(settings, paneId, false);
			applyIndicators();
		});
		closeBtn.className = 'pane-corner-btn';
		bar.append(cfgBtn, closeBtn);
	}

	const bounds = lastChartLayout.panes[paneId];
	bar.hidden = !state.activeTabId || bar.childElementCount === 0 || Boolean(bounds && !bounds.visible);
	if (bounds) bar.style.top = `${bounds.top + 8}px`;
	bar.style.right = `${Math.round(lastChartLayout.rightScaleWidth) + 10}px`;
}

function updateIndicatorLabels(): void {
	const hasTab = Boolean(state.activeTabId);
	const activeOrder = hasTab ? activePaneOrder(settings) : [];
	const activeOrderSet = new Set(activeOrder);

	const collapsed = settings.legendCollapsed;
	const makeToggle = (count: number): HTMLButtonElement => {
		const button = iconButton('chevron', collapsed ? '展开指标信息' : '收起指标信息', () => {
			settings.legendCollapsed = !settings.legendCollapsed;
			applyIndicators();
			[...stageWrap.querySelectorAll<HTMLButtonElement>('.legend-collapse')].find(toggle => toggle.getClientRects().length)?.focus({ preventScroll: true });
		});
		button.className = 'legend-collapse'; button.setAttribute('aria-expanded', String(!collapsed));
		if (collapsed) button.append(element('span', '', String(count)));
		return button;
	};
	const makeRow = (id: string): HTMLDivElement => indicatorLegendRow(settings, id, () => {
		const focused = document.activeElement instanceof HTMLElement && document.activeElement.closest('.indicator-legend-row')?.getAttribute('data-indicator') === id;
		setIndicatorVisible(settings, id, !isIndicatorVisible(settings, id));
		applyIndicators();
		if (focused) stageWrap.querySelector<HTMLButtonElement>(`.indicator-legend-row[data-indicator="${id}"] [data-action=visibility]`)?.focus({ preventScroll: true });
	}, () => openIndicatorDropdown(id));
	const mainIndicators = hasTab ? INDICATOR_CATALOG.filter(def => def.placement === 'overlay' && isIndicatorEnabled(settings, def.id)) : [];
	indicatorLegend.replaceChildren();
	if (!collapsed) for (const def of mainIndicators) indicatorLegend.append(makeRow(def.id));
	const indicatorCount = hasTab ? INDICATOR_CATALOG.filter(def => isIndicatorEnabled(settings, def.id)).length : 0;
	if (indicatorCount) indicatorLegend.append(makeToggle(mainIndicators.length || indicatorCount));
	indicatorLegend.hidden = !indicatorCount;

	const activeSubPanes = activeOrder.filter(id => id !== 'price');
	const activeSubSet = new Set(activeSubPanes);
	for (const [id, el] of subPaneLabels) {
		if (!activeSubSet.has(id)) {
			el.remove();
			subPaneLabels.delete(id);
		}
	}
	for (const [id, bar] of paneCornerActions) {
		if (!activeOrderSet.has(id)) {
			bar.remove();
			paneCornerActions.delete(id);
		}
	}

	if (hasTab) {
		renderPaneCornerActions('price', 'K 线主图', activeOrder);
	}

	for (const id of activeSubPanes) {
		const def = getCatalogIndicator(id);
		if (!def) continue;
		let labelEl = subPaneLabels.get(id);
		if (!labelEl) {
			labelEl = element('div', `pane-label pane-${id}`);
			labelEl.dataset.pane = id;
			stageWrap.append(labelEl);
			subPaneLabels.set(id, labelEl);
		}
		labelEl.replaceChildren();
		if (!collapsed) labelEl.append(makeRow(id));
		// A maximized subpane keeps its own toggle so it can always be expanded.
		if (lastChartLayout.maximizedPane === id) labelEl.append(makeToggle(1));
		const bounds = lastChartLayout.panes[id];
		labelEl.hidden = Boolean(bounds && !bounds.visible) || (collapsed && lastChartLayout.maximizedPane !== id);
		if (bounds) labelEl.style.top = `${bounds.top + 8}px`;

		renderPaneCornerActions(id, `${def.shortName} 面板`, activeOrder);
	}

	updateIndicatorLegendValues(stageWrap, chart?.indicatorValues() ?? {});
	const priceBounds = lastChartLayout.panes.price;
	priceOverlay.hidden = !hasTab || Boolean(priceBounds && !priceBounds.visible);
	syncPriceOverlayHeight();
	syncHoveredPaneVisual();
}

function renderDetail(instrument?: Instrument): void {
	detail.replaceChildren();
	if (!instrument) {
		detail.append(element('p', 'detail-empty', '选择交易对，查看市场概览'));
		return;
	}
	const heading = element('h2', 'detail-title');
	heading.append(coinBadge(instrument), document.createTextNode(symbolLabel(instrument)));
	detail.append(heading, element('p', 'detail-subtitle', `${marketFor(instrument).name} / TetherUS`), element('p', 'detail-market', `${marketLabel(instrument)} · USDT · BINANCE`));
	const quote = quotes.get(instrumentKey(instrument));
	if (!quote) return;
	const price = element('div', 'detail-price');
	price.append(element('strong', '', formatPrice(quote.price)), element('span', '', 'USDT'));
	const sign = quote.change >= 0 ? '+' : '';
	detail.append(price, element('div', `detail-change ${quote.change >= 0 ? 'positive' : 'negative'}`, `${sign}${formatPrice(quote.change)}  (${sign}${quote.percent.toFixed(2)}%)`));
	const dailyRange = element('div', 'daily-range');
	const values = element('div', 'range-values');
	values.append(element('span', '', formatPrice(quote.low)), element('span', '', formatPrice(quote.high)));
	const bar = element('div', 'range-track');
	const marker = element('i');
	marker.style.left = `${Math.max(0, Math.min(100, (quote.price - quote.low) / (quote.high - quote.low || 1) * 100))}%`;
	bar.append(marker);
	const captions = element('div', 'range-captions');
	captions.append(element('span', '', '24h 最低'), element('span', '', '24h 最高'));
	dailyRange.append(values, bar, captions);
	detail.append(dailyRange, element('div', 'detail-note', `Binance · 24h 滚动统计 · ${new Date(quote.updatedAt).toLocaleTimeString('zh-CN')}`));
}

function renderOhlc(candle: Candle): void {
	updateIndicatorLegendValues(stageWrap, chart?.indicatorValues() ?? {});
	ohlc.replaceChildren();
	const direction = candle.close >= candle.open ? 'positive' : 'negative';
	for (const [label, value] of [['开', candle.open], ['高', candle.high], ['低', candle.low], ['收', candle.close]] as const) {
		const item = element('span', 'ohlc-item');
		item.append(element('span', 'ohlc-label', `${label}=`), element('span', direction, formatPrice(value)));
		ohlc.append(item);
	}
	const change = candle.close - candle.open;
	const sign = change >= 0 ? '+' : '';
	ohlc.append(element('span', `ohlc-change ${direction}`, `${sign}${formatPrice(change)} (${sign}${(change / candle.open * 100).toFixed(2)}%)`));
	syncPriceOverlayHeight();
}

function render(): void {
	const version = ++renderVersion;
	feed?.stop();
	feed = undefined;
	priceAxisShortcut?.destroy(); priceAxisShortcut = undefined;
	drawingUI.attach();
	drawingSession?.destroy(); drawingSession = undefined;
	chart?.destroy();
	chart = undefined;
	hoveredPane = null;
	lastChartLayout = { panes: {}, rightScaleWidth: mobile.isMobile() ? 64 : 78, maximizedPane: null };
	candleCount = 0;
	tabs.replaceChildren();
	stage.replaceChildren();
	ohlc.replaceChildren();
	status.textContent = storageNotice;
	for (const item of ranges.querySelectorAll('button')) item.classList.remove('selected');
	for (const tab of state.tabs) {
		const preference = state.preferences[tab.instrumentKey];
		const group = element('div', `tab ${tab.id === state.activeTabId ? 'active' : ''}`);
		const focus = element('button', 'tab-focus');
		focus.append(coinBadge(preference.instrument), element('span', 'tab-symbol', symbolLabel(preference.instrument)), element('small', 'tab-period', preference.timeframe));
		focus.setAttribute('aria-label', `${preference.instrument.symbol} ${marketLabel(preference.instrument)} · ${preference.timeframe}`);
		focus.setAttribute('aria-pressed', String(tab.id === state.activeTabId));
		focus.onclick = () => commit({ ...state, activeTabId: tab.id });
		const close = iconButton('close', `关闭 ${preference.instrument.symbol} ${marketLabel(preference.instrument)}`, () => commit(closeTab(state, tab.id)));
		close.classList.add('tab-close');
		group.append(focus, close);
		tabs.append(group);
	}
	tabs.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	const active = state.tabs.find(tab => tab.id === state.activeTabId);
	for (const [key, entry] of quoteRows) entry.row.classList.toggle('selected', key === active?.instrumentKey);
	updateIndicatorLabels();
	marketStatus.hidden = !active;
	const preference = active ? state.preferences[active.instrumentKey] : undefined;
	timeframeUI.update(preference?.timeframe);
	mobile.update(preference?.instrument, preference?.timeframe ?? '1h', quotes);
	renderDetail(preference?.instrument);
	symbolButton.replaceChildren(icon('search'), element('span', '', preference ? symbolLabel(preference.instrument) : '搜索交易对'));
	if (!active || !preference) {
		title.textContent = '你的下一个机会，从这里开始';
		emptyState.hidden = false;
		emptyState.replaceChildren(icon('candles'), element('h2', '', '打开一个交易对'), element('p', '', '已关闭交易对的周期设置会保留。'));
		const open = element('button', 'primary-button', '搜索交易对');
		open.onclick = () => openPicker();
		emptyState.append(open);
		return;
	}
	title.replaceChildren(coinBadge(preference.instrument), element('span', '', `${marketFor(preference.instrument).name} / USDT · ${marketLabel(preference.instrument)}`), element('span', 'chart-meta', `· ${TIMEFRAME_LONG_LABELS[preference.timeframe]} · BINANCE`));
	emptyState.hidden = false;
	emptyState.replaceChildren(element('p', '', '正在加载行情…'));
	const currentChart = createTerminalChart(stage, settings, renderOhlc, applyPaneLayout);
	chart = currentChart;
	updateIndicatorLabels();
	drawingSession = createDrawingSession(
		currentChart,
		active.instrumentKey,
		TIMEFRAME_SECONDS[preference.timeframe],
		(message, error) => drawingUI.setStatus(message, error),
		() => { if (current()) drawingUI.setReady(true); }
	);
	const currentDrawings = drawingSession;
	drawingUI.attach(currentDrawings);
	priceAxisShortcut = createPriceAxisShortcut(stageWrap, currentChart, currentDrawings);
	currentChart.setMobileLayout(mobile.isMobile());
	currentChart.chart.applyOptions({ crosshair: { mode: crosshairVisible ? CrosshairMode.Normal : CrosshairMode.Hidden } });
	currentChart.setPriceFormat(priceTick(preference.instrument));
	const current = (): boolean => version === renderVersion && chart === currentChart;
	feed = startCandleFeed(provider, preference.instrument, preference.timeframe, {
		onSnapshot: (candles, initial) => {
			if (!current()) return;
			candleCount = candles.length;
			currentDrawings.beforeDataChange();
			currentChart.setData(candles, initial);
			currentDrawings.setData(candles);
			emptyState.hidden = candles.length > 0;
			if (!candles.length) emptyState.replaceChildren(element('p', '', '暂无行情数据'));
		},
		onCandle: (candle, count) => { if (current()) { if (count > candleCount) currentDrawings.beforeDataChange(); candleCount = count; currentChart.update(candle); currentDrawings.update(candle); } },
		onState: (connection, message) => {
			if (!current()) return;
			setConnectionState(connection, message);
			if (connection === 'error' && candleCount === 0) {
				const retry = element('button', 'primary-button', '重新连接');
				retry.onclick = () => feed?.retry();
				emptyState.hidden = false;
				emptyState.replaceChildren(element('p', '', message), retry);
			}
		},
	});
	currentChart.chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
		if (range && range.from < 20 && current()) void feed?.loadOlder();
	});
}

function setConnectionState(connection: ConnectionState, message: string): void {
	if (sourceStatus.textContent === `Binance · ${message}`) return;
	sourceStatus.replaceChildren(element('i', 'status-dot'), document.createTextNode(`Binance · ${message}`));
	sourceStatus.dataset.state = connection;
	marketStatus.dataset.state = connection;
	marketStatus.replaceChildren(element('i', 'market-status-dot'), element('span', '', connection === 'live' ? '实时' : message));
	demoBadge.textContent = connection === 'live' ? 'Binance 实时' : 'Binance 连接中';
	mobile.setConnection(connection, message);
}

function flushQuotes(): void {
	quoteFlush = undefined;
	for (const [key, quote] of quotes) {
		const entry = quoteRows.get(key);
		if (!entry) continue;
		entry.price.textContent = formatPrice(quote.price);
		entry.change.textContent = `${quote.percent >= 0 ? '+' : ''}${quote.percent.toFixed(2)}%`;
		entry.change.classList.toggle('positive', quote.percent >= 0);
		entry.change.classList.toggle('negative', quote.percent < 0);
	}
	const active = state.tabs.find(tab => tab.id === state.activeTabId);
	renderDetail(active ? state.preferences[active.instrumentKey].instrument : undefined);
	mobile.updateQuotes(quotes);
}

function ensureWatchlist(): void {
	let changed = false;
	for (const tab of state.tabs) {
		const instrument = state.preferences[tab.instrumentKey].instrument;
		if (instrument.venue === 'binance' && !instruments.some(i => instrumentKey(i) === tab.instrumentKey)) { instruments.push(instrument); changed = true; }
	}
	if (changed) renderWatchRows();
	const signature = instruments.map(instrumentKey).join(',');
	if (signature === quoteSubscription) return;
	stopQuotes?.();
	quoteSubscription = signature;
	stopQuotes = startQuoteFeed(provider, instruments, (instrument, quote) => {
		quotes.set(instrumentKey(instrument), quote);
		if (!quoteFlush) quoteFlush = setTimeout(flushQuotes, 400);
	}, (market, message) => {
		quoteStates[market] = message;
		watchNote.textContent = `现货：${quoteStates.spot} · 永续：${quoteStates.perpetual}`;
		mobile.setQuoteStatus(`现货：${quoteStates.spot} · 永续：${quoteStates.perpetual}`);
	});
}

async function loadCatalogue(): Promise<void> {
	catalogueRequest?.abort();
	const controller = new AbortController();
	catalogueRequest = controller;
	const failed: string[] = [];
	await Promise.all((['spot', 'perpetual'] as const).map(async market => {
		try { registerInstruments(await provider.getInstruments(market, controller.signal)); }
		catch { failed.push(market === 'spot' ? '现货' : '永续'); }
	}));
	if (controller.signal.aborted) return;
	catalogueNotice = failed.length ? `${failed.join(' / ')}目录加载失败，暂显示常用交易对；重新打开搜索可重试` : `BINANCE · ${catalogue.length} 个 USDT 交易对 · 最多显示 100 项，请输入搜索`;
	const active = state.tabs.find(tab => tab.id === state.activeTabId);
	if (active) chart?.setPriceFormat(priceTick(state.preferences[active.instrumentKey].instrument));
	if (picker.open) renderSearch();
}

function updateClock(): void {
	timeLabel.textContent = `${new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' }).format(new Date())} UTC+8`;
}
function onDocumentPointerDown(event: PointerEvent): void {
	if (indicatorDropdown.hidden) return;
	if (event.target instanceof Node && !indicatorDropdown.contains(event.target) && !indicatorButton.contains(event.target)) {
		closeIndicatorDropdown();
	}
}
function onKeyDown(event: KeyboardEvent): void {
	if (event.key === 'Escape') {
		if (!indicatorDropdown.hidden) { closeIndicatorDropdown(); return; }
		if (chart?.getMaximizedPane()) {
			chart.setMaximizedPane(null);
			updateIndicatorLabels();
			return;
		}
		if (window.matchMedia('(max-width: 1050px)').matches && app?.classList.contains('sidebar-open')) toggleWatchlist(false);
	}
}
const onWindowResize = (): void => {
	updateSidebarAccessibility();
	if (!indicatorDropdown.hidden) positionIndicatorDropdown();
};
const updateSidebarAccessibility = (): void => {
	const shown = !app?.classList.contains('focus-mode') && (window.matchMedia('(max-width: 1050px)').matches ? app?.classList.contains('sidebar-open') : !app?.classList.contains('watchlist-hidden'));
	watchButton.setAttribute('aria-expanded', String(Boolean(shown)));
	railWatch.setAttribute('aria-pressed', String(Boolean(shown)));
};
const onPageHide = (): void => {
	++renderVersion;
	feed?.stop(); feed = undefined;
	stopQuotes?.(); stopQuotes = undefined; quoteSubscription = '';
	catalogueRequest?.abort();
	clearTimeout(quoteFlush); quoteFlush = undefined;
	priceAxisShortcut?.destroy(); priceAxisShortcut = undefined;
	drawingUI.attach();
	drawingSession?.destroy(); drawingSession = undefined;
	chart?.destroy(); chart = undefined;
};
const onPageShow = (event: PageTransitionEvent): void => { if (event.persisted) { ensureWatchlist(); render(); updateClock(); void loadCatalogue(); } };
const onOnline = (): void => { feed?.retry(); };
const onVisibility = (): void => { if (!document.hidden) feed?.retry(); else drawingSession?.flush(); };
window.addEventListener('online', onOnline);
document.addEventListener('visibilitychange', onVisibility);
document.addEventListener('pointerdown', onDocumentPointerDown);
document.addEventListener('keydown', onKeyDown);
window.addEventListener('resize', onWindowResize);
window.addEventListener('pagehide', onPageHide);
window.addEventListener('pageshow', onPageShow);
const clockTimer = window.setInterval(updateClock, 30000);
if (import.meta.hot) import.meta.hot.dispose(() => {
	timeframeUI.destroy();
	mobile.destroy();
	onPageHide();
	drawingUI.destroy();
	window.clearInterval(clockTimer);
	document.removeEventListener('pointerdown', onDocumentPointerDown);
	document.removeEventListener('keydown', onKeyDown);
	window.removeEventListener('resize', onWindowResize);
	window.removeEventListener('pagehide', onPageHide);
	window.removeEventListener('pageshow', onPageShow);
	window.removeEventListener('online', onOnline);
	document.removeEventListener('visibilitychange', onVisibility);
});
updateClock();
updateSidebarAccessibility();
ensureWatchlist();
render();
void loadCatalogue();
