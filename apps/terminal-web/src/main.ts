import { TIMEFRAME_SECONDS, closeTab, emptyWorkspace, instrumentKey, moveTab, openInstrument, parseInstrumentKey, parseWorkspace, parseWorkspaceTabsSnapshot, setTimeframe, type Candle, type ConnectionState, type Instrument, type MarketQuote, type SyncSnapshot, type SyncedDrawingRecord, type SyncedInstrumentState, type SyncedSettingRecord, type Timeframe, type Workspace } from '@terminal/domain';
import { CrosshairMode } from 'lightweight-charts';
import { createTerminalChart, type ChartLayout, type IndicatorSettings, type TerminalChart } from './chart';
import { attachChartPinch, installViewportZoomGuard } from './chart-pinch';
import { INDICATOR_CATALOG, getCatalogIndicator } from './data/indicator-catalog';
import {
	INDICATOR_STORAGE_KEY, activePaneOrder, defaultIndicatorSettings, isIndicatorEnabled, isIndicatorVisible, setIndicatorVisible,
	moveVisiblePane, parseIndicatorSettings, setIndicatorEnabled, type PaneId,
} from './data/indicators';
import { MOBILE_TIMEFRAME_STORAGE_KEY, TIMEFRAME_LONG_LABELS, parseMobileTimeframe, parseTimeframePreferences, resolveActiveTimeframe, serializeMobileTimeframe } from './data/timeframes';
import { WATCHLIST_STORAGE_KEY, hasInWatchlist, moveWatchlistItemToEdge, parseWatchlistStore, removeFromWatchlist, reorderWatchlist, toggleWatchlistItem } from './data/watchlist';
import { closeIndicatorColorPopover, renderIndicatorPanel } from './indicator-ui';
import { indicatorLegendRow, updateIndicatorLegendValues } from './indicator-legend';
import { createTimeframeUI } from './timeframe-ui';
import { catalogue, coinBadge, defaultInstruments, formatPrice, instruments, marketFor, marketLabel, priceTick, replaceCatalogue, setWatchlistInstruments, symbolLabel } from './markets';
import { createProviderRegistry, loadDataSourceSettings, saveDataSourceSettings, type DataSourceSettings } from './data/data-source';
import { startCandleFeed } from './data/candle-feed';
import { startQuoteFeed } from './data/quote-feed';
import { migrateDemoWorkspace } from './data/workspace-migration';
import { createMobileUI } from './mobile';
import { attachTabReorder } from './tab-reorder';
import { element, icon, iconButton, unavailableButton } from './ui';
import { createDrawingSession, exportSharedStyleDefaults, reloadSharedStyleDefaults, type DrawingSession } from './drawings/session';
import { createPriceAxisShortcut } from './drawings/price-axis-shortcut';
import { drawingStorageKey, parseDrawingStore, type DrawingStore } from './drawings/storage';
import { DRAWING_DEFAULTS_STORAGE_KEY, parseDrawingStyleDefaultsStore } from './drawings/style-defaults';
import { CUSTOM_COLORS_STORAGE_KEY, parseCustomColorsStore } from './drawings/color-palette';
import { exportSharedCustomColors, reloadSharedCustomColors, setCustomColorsChangeListener } from './drawings/color-picker';
import { createDrawingUI } from './drawings/ui';
import { SyncEngine, type MarketRelayTarget } from './sync/engine';
import { IndexedDbSyncStorage } from './sync/storage';
import { createSettingsModal } from './settings/settings-ui';
import './style.css';
import './mobile.css';
import './indicator-legend.css';

const STORAGE_KEY = 'crypto-terminal.workspace.v1';
const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing application root');
app.replaceChildren();

try {
	const rawWatchlist = localStorage.getItem(WATCHLIST_STORAGE_KEY);
	if (rawWatchlist) {
		setWatchlistInstruments(parseWatchlistStore(JSON.parse(rawWatchlist)).items);
	}
} catch {
	setWatchlistInstruments(defaultInstruments);
}

let storageNotice = '设置保存在本机';
let state: Workspace;
try {
	const stored = localStorage.getItem(STORAGE_KEY);
	state = stored ? migrateDemoWorkspace(parseWorkspace(JSON.parse(stored))) : openInstrument(openInstrument(emptyWorkspace(), defaultInstruments[0]), defaultInstruments[1]);
} catch {
	state = openInstrument(emptyWorkspace(), defaultInstruments[0]);
	storageNotice = '本机记录不可用，当前为临时工作区';
}
let chart: TerminalChart | undefined;
let drawingSession: DrawingSession | undefined;
let priceAxisShortcut: ReturnType<typeof createPriceAxisShortcut> | undefined;
const loadedDataSource = loadDataSourceSettings({
	spotRest: import.meta.env.VITE_BINANCE_SPOT_REST,
	perpetualRest: import.meta.env.VITE_BINANCE_PERPETUAL_REST,
	spotWs: import.meta.env.VITE_BINANCE_SPOT_WS,
	perpetualWs: import.meta.env.VITE_BINANCE_PERPETUAL_WS,
});
let dataSourceSettings: DataSourceSettings = loadedDataSource.settings;
let currentRelayTarget: MarketRelayTarget = {
	ready: false,
	checking: true,
	baseUrl: window.location.origin,
	auth: { mode: 'local' },
	source: 'local',
	reason: '正在连接当前服务的行情中继…',
};
let lastRelayFingerprint = '';
let providerRegistry = createProviderRegistry(dataSourceSettings, undefined, undefined, currentRelayTarget);
if (loadedDataSource.corrupted && storageNotice === '设置保存在本机') {
	storageNotice = '数据源配置损坏，已保留原记录并回退默认 Binance';
}
let feed: ReturnType<typeof startCandleFeed> | undefined;
let stopQuotes: (() => void) | undefined;
let catalogueRequest: AbortController | undefined;
let quoteFlush: ReturnType<typeof setTimeout> | undefined;
let quoteSubscription = '';
const quoteStates = { spot: '连接中', perpetual: '连接中' };
let catalogueNotice = `正在加载 ${providerRegistry.active.label} 交易对…`;
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
let mobileTimeframe: Timeframe | undefined;
let renderedTimeframe: Timeframe | undefined;
try {
	const rawMobileTf = localStorage.getItem(MOBILE_TIMEFRAME_STORAGE_KEY);
	if (rawMobileTf) mobileTimeframe = parseMobileTimeframe(JSON.parse(rawMobileTf));
} catch {
	mobileTimeframe = undefined;
}
function saveMobileTimeframe(timeframe: Timeframe): void {
	mobileTimeframe = timeframe;
	try { localStorage.setItem(MOBILE_TIMEFRAME_STORAGE_KEY, serializeMobileTimeframe(timeframe)); } catch { /* ignore */ }
}
function preserveMobileTimeframe(): void {
	if (mobileTimeframe !== undefined) return;
	const currentTab = state.tabs.find(tab => tab.id === state.activeTabId);
	if (currentTab) saveMobileTimeframe(state.preferences[currentTab.instrumentKey].timeframe);
}

// Compact tab strip and shared chart controls.
const tabstrip = element('header', 'tabstrip');
const brand = element('div', 'brand');
brand.title = 'Crypto Terminal · 看盘工作台';
brand.append(icon('logo'));
const tabs = element('nav', 'tabs');
tabs.setAttribute('aria-label', '交易对标签页');
const tabOrderStatus = element('span', 'tab-order-status');
tabOrderStatus.setAttribute('role', 'status');
const tabReorder = attachTabReorder(tabs, (id, index) => {
	const next = moveTab(state, id, index);
	if (next === state) return;
	commit(next, { tabsOnly: true });
	const tab = state.tabs[index];
	tabOrderStatus.textContent = `${symbolLabel(state.preferences[tab.instrumentKey].instrument)} 已移至第 ${index + 1} 个标签，共 ${state.tabs.length} 个`;
	const moved = Array.from(tabs.querySelectorAll<HTMLElement>('.tab')).find(item => item.dataset.tabId === id);
	moved?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
});
const addTab = iconButton('plus', '打开交易对', () => openPicker());
addTab.classList.add('add-tab');
tabstrip.append(brand, tabs, addTab, tabOrderStatus);

const toolbar = element('div', 'toolbar');
const symbolButton = element('button', 'symbol-button');
symbolButton.onclick = () => openPicker();
symbolButton.title = '搜索交易对';
const periods = element('div', 'periods');
periods.setAttribute('aria-label', '图表周期');
const timeframeUI = createTimeframeUI(app, periods, timeframe => {
	if (!state.activeTabId) return;
	const activeTab = state.tabs.find(tab => tab.id === state.activeTabId);
	commit(setTimeframe(state, state.activeTabId, timeframe));
	if (activeTab) void syncEngine.enqueuePreference(activeTab.instrumentKey, timeframe);
}, prefs => {
	void syncEngine.enqueueSetting('timeframes', prefs as unknown as Record<string, unknown>);
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
const demoBadge = element('span', 'demo-badge', providerRegistry.active.label);
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
const stopViewportZoomGuard = installViewportZoomGuard();
const stopChartPinch = attachChartPinch(stageWrap, () => chart);
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
let watchEditMode = false;
const watchEditButton = element('button', 'watch-edit-toggle', '管理');
watchEditButton.type = 'button';
watchEditButton.setAttribute('aria-pressed', 'false');
watchEditButton.title = '批量排序或移除自选交易对';
watchEditButton.onclick = () => {
	watchEditMode = !watchEditMode;
	watchEditButton.textContent = watchEditMode ? '完成' : '管理';
	watchEditButton.setAttribute('aria-pressed', String(watchEditMode));
	watchlist.classList.toggle('is-editing', watchEditMode);
	closeWatchContextMenu();
	renderWatchRows();
};
watchHeading.append(watchTitle, element('span', 'spacer'), watchEditButton, iconButton('plus', '添加交易对', () => openPicker()));
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
let watchDragFromIndex: number | null = null;
let watchDropTarget: { row: HTMLTableRowElement; position: 'before' | 'after' } | null = null;
let watchContextMenu: HTMLDivElement | undefined;

function clearWatchDragIndicator(): void {
	if (watchDropTarget) {
		watchDropTarget.row.classList.remove('drop-before', 'drop-after');
		watchDropTarget = null;
	}
}

function closeWatchContextMenu(): void {
	watchContextMenu?.remove();
	watchContextMenu = undefined;
}

function openWatchContextMenu(instrument: Instrument, index: number, clientX: number, clientY: number): void {
	closeWatchContextMenu();
	const menu = element('div', 'watch-context-menu');
	menu.setAttribute('role', 'menu');
	menu.setAttribute('aria-label', `${symbolLabel(instrument)} 操作`);
	const addItem = (label: string, action: () => void, opts?: { disabled?: boolean; danger?: boolean; iconName?: 'arrowUp' | 'arrowDown' | 'trash' }) => {
		const btn = element('button', `watch-context-item${opts?.danger ? ' danger' : ''}`);
		btn.type = 'button';
		btn.setAttribute('role', 'menuitem');
		btn.disabled = Boolean(opts?.disabled);
		if (opts?.iconName) btn.append(icon(opts.iconName));
		btn.append(element('span', '', label));
		btn.onclick = () => {
			closeWatchContextMenu();
			action();
		};
		menu.append(btn);
	};
	addItem('移至顶部', () => saveWatchlist(moveWatchlistItemToEdge(instruments, instrument, 'top')), { disabled: index === 0, iconName: 'arrowUp' });
	addItem('移至底部', () => saveWatchlist(moveWatchlistItemToEdge(instruments, instrument, 'bottom')), { disabled: index === instruments.length - 1, iconName: 'arrowDown' });
	menu.append(element('div', 'watch-context-divider'));
	addItem(`从自选移除 ${symbolLabel(instrument)}`, () => saveWatchlist(removeFromWatchlist(instruments, instrument)), { danger: true, iconName: 'trash' });
	app?.append(menu);
	const rect = menu.getBoundingClientRect();
	const left = Math.max(8, Math.min(clientX, window.innerWidth - rect.width - 8));
	const top = Math.max(8, Math.min(clientY, window.innerHeight - rect.height - 8));
	menu.style.left = `${left}px`;
	menu.style.top = `${top}px`;
	watchContextMenu = menu;
}

function renderWatchRows(): void {
	closeWatchContextMenu();
	clearWatchDragIndicator();
	tableBody.replaceChildren();
	quoteRows.clear();
	const active = state.tabs.find(tab => tab.id === state.activeTabId);
	if (instruments.length === 0) {
		const row = element('tr', 'watch-empty-row');
		const cell = element('td', 'watch-empty', '自选列表为空，点击上方 ＋ 添加交易对');
		cell.colSpan = 3;
		row.append(cell);
		tableBody.append(row);
		return;
	}
	instruments.forEach((instrument, index) => {
		const key = instrumentKey(instrument);
		const row = element('tr');
		row.draggable = true;
		row.dataset.index = String(index);
		row.classList.toggle('selected', key === active?.instrumentKey);
		row.ondragstart = event => {
			closeWatchContextMenu();
			watchDragFromIndex = index;
			row.classList.add('is-dragging');
			if (event.dataTransfer) {
				event.dataTransfer.effectAllowed = 'move';
				event.dataTransfer.setData('text/plain', key);
			}
		};
		row.ondragover = event => {
			if (watchDragFromIndex === null) return;
			event.preventDefault();
			if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
			const rect = row.getBoundingClientRect();
			const position: 'before' | 'after' = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
			if (watchDropTarget?.row !== row || watchDropTarget.position !== position) {
				clearWatchDragIndicator();
				row.classList.add(position === 'before' ? 'drop-before' : 'drop-after');
				watchDropTarget = { row, position };
			}
		};
		row.ondrop = event => {
			if (watchDragFromIndex === null) return;
			event.preventDefault();
			const from = watchDragFromIndex;
			const rect = row.getBoundingClientRect();
			const dropAfter = event.clientY >= rect.top + rect.height / 2;
			let target = dropAfter ? index + 1 : index;
			if (from < target) target -= 1;
			watchDragFromIndex = null;
			clearWatchDragIndicator();
			if (from !== target) saveWatchlist(reorderWatchlist(instruments, from, target));
		};
		row.ondragend = () => {
			watchDragFromIndex = null;
			row.classList.remove('is-dragging');
			clearWatchDragIndicator();
		};
		row.oncontextmenu = event => {
			event.preventDefault();
			openWatchContextMenu(instrument, index, event.clientX, event.clientY);
		};

		const symbolCell = element('td');
		const open = element('button', 'watch-symbol');
		open.type = 'button';
		open.title = `${symbolLabel(instrument)} · 可上下拖动排序，右键移除`;
		open.setAttribute('aria-label', `打开 ${instrument.symbol} ${marketLabel(instrument)}`);
		const grip = element('span', 'watch-drag-grip', '⋮⋮');
		grip.setAttribute('aria-hidden', 'true');
		open.append(grip, coinBadge(instrument), element('span', '', symbolLabel(instrument)));
		open.onclick = () => commit(openInstrument(state, instrument));
		symbolCell.append(open);

		if (watchEditMode) {
			const actionsCell = element('td', 'watch-edit-cell');
			actionsCell.colSpan = 2;
			const actionsWrap = element('div', 'watch-edit-actions');
			const moveUp = iconButton('arrowUp', `上移 ${symbolLabel(instrument)}`, () => saveWatchlist(reorderWatchlist(instruments, index, index - 1)));
			moveUp.className = 'watch-manage-btn';
			moveUp.disabled = index === 0;
			const moveDown = iconButton('arrowDown', `下移 ${symbolLabel(instrument)}`, () => saveWatchlist(reorderWatchlist(instruments, index, index + 1)));
			moveDown.className = 'watch-manage-btn';
			moveDown.disabled = index === instruments.length - 1;
			const remove = iconButton('trash', `从自选列表移除 ${symbolLabel(instrument)}`, () => saveWatchlist(removeFromWatchlist(instruments, instrument)));
			remove.className = 'watch-manage-btn danger';
			actionsWrap.append(moveUp, moveDown, remove);
			actionsCell.append(actionsWrap);
			row.append(symbolCell, actionsCell);
			tableBody.append(row);
			return;
		}

		const quote = quotes.get(key);
		const price = element('td', 'quote-price', quote ? formatPrice(quote.price) : '—');
		const change = element('td', `quote-change ${quote ? quote.percent >= 0 ? 'positive' : 'negative' : ''}`, quote ? `${quote.percent >= 0 ? '+' : ''}${quote.percent.toFixed(2)}%` : '—');
		row.append(symbolCell, price, change);
		tableBody.append(row);
		quoteRows.set(key, { row, price, change });
	});
}
function saveWatchlist(next: readonly Instrument[], sync = true): void {
	setWatchlistInstruments(next);
	const payload = { schemaVersion: 1 as const, items: instruments.map(item => ({ ...item })) };
	try {
		localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(payload));
	} catch {
		// Ignore localStorage quota errors.
	}
	renderWatchRows();
	ensureWatchlist();
	mobile.refreshWatchlist();
	if (sync) void syncEngine.enqueueSetting('watchlist', payload as unknown as Record<string, unknown>);
}
renderWatchRows();
const detail = element('section', 'market-detail');
detail.setAttribute('aria-label', '交易对详情');
watchlist.append(watchHeading, table, element('div', 'watch-spacer'), detail);
const sidebarScrim = element('button', 'sidebar-scrim');
sidebarScrim.setAttribute('aria-label', '收起自选列表');
sidebarScrim.onclick = () => toggleWatchlist(false);
const rightRail = element('aside', 'right-rail');
rightRail.setAttribute('aria-label', '侧边面板');
const railWatch = iconButton('list', '自选列表面板', () => toggleWatchlist());
rightRail.append(railWatch, unavailableButton('clock', '提醒'), iconButton('layers', '绘图对象树', () => drawingUI.openObjects()), unavailableButton('calendar', '财经日历'));
const rightBottom = element('div', 'rail-bottom');
rightBottom.append(iconButton('settings', '设置（数据源 · 存储 · 导入导出）', () => settingsModal.open('data-source')), unavailableButton('bell', '通知'), iconButton('help', '使用说明', () => about.showModal()));
rightRail.append(rightBottom);
workspace.append(drawingRail, chartPanel, sidebarScrim, watchlist, rightRail);

const footer = element('footer', 'statusbar');
const status = element('span', 'save-status');
status.setAttribute('role', 'status');
const sourceStatus = element('button', 'source-status source-status-btn');
sourceStatus.type = 'button';
sourceStatus.setAttribute('aria-label', '打开数据源设置');
sourceStatus.append(element('i', 'status-dot'), document.createTextNode(`${providerRegistry.active.label} · 连接中`));
sourceStatus.onclick = () => settingsModal.open('data-source');
const syncStatusBtn = element('button', 'sync-status-btn');
syncStatusBtn.type = 'button';
syncStatusBtn.dataset.state = 'disabled';
syncStatusBtn.setAttribute('aria-label', '打开存储服务设置');
const syncStatusDot = element('i', 'sync-status-dot');
const syncStatusText = element('span', '', '正在检测本机存储…');
syncStatusBtn.append(syncStatusDot, syncStatusText);
syncStatusBtn.onclick = () => settingsModal.open('storage');
footer.append(sourceStatus, element('span', 'footer-divider'), status, element('span', 'spacer'), syncStatusBtn);

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
	element('p', '', '默认内置 Binance USDT 现货和永续公开行情，并可在「设置」中配置 Binance 代理地址或通用自定义协议数据源。单服务启动时默认连接本机内置 SQLite 存储，同时支持自定义远程同步服务及 SQLite / JSON 导入导出。'),
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
	closeIndicatorColorPopover();
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
	void syncEngine.enqueueSetting('indicators', settings as unknown as Record<string, unknown>);
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

const drawingUI = createDrawingUI(
	app,
	drawingRail,
	stageWrap,
	active => mobile?.setDrawingActive(active),
	mode => {
		crosshairVisible = mode === 'cross';
		chart?.chart.applyOptions({ crosshair: { mode: crosshairVisible ? drawingSession?.manager.magnetMode() === 'strong' ? CrosshairMode.MagnetOHLC : CrosshairMode.Normal : CrosshairMode.Hidden } });
	},
	canUndo => mobile?.setUndoEnabled(canUndo),
);
const railBottom = element('div', 'rail-bottom');
railBottom.append(iconButton('help', '关于看盘工作台', () => about.showModal()));
drawingRail.append(railBottom);

const mobile = createMobileUI({
	openDrawings: () => drawingUI.openTools(),
	openDrawingObjects: () => drawingUI.openObjects(),
	openSettings: tab => settingsModal.open(tab ?? 'data-source'),
	drawingHistory: () => ({
		canUndo: drawingSession?.manager.canUndo() ?? false,
		canRedo: drawingSession?.manager.canRedo() ?? false,
		undo: () => drawingSession?.manager.undo(),
		redo: () => drawingSession?.manager.redo(),
	}),
	app, priceOverlay, settings,
	openInstrument: instrument => {
		preserveMobileTimeframe();
		commit(openInstrument(state, instrument));
	},
	reorderWatchlist: (fromIndex, toIndex) => saveWatchlist(reorderWatchlist(instruments, fromIndex, toIndex)),
	removeWatchlist: instrument => saveWatchlist(removeFromWatchlist(instruments, instrument)),
	openSearch: openPicker,
	setTimeframe: timeframe => {
		saveMobileTimeframe(timeframe);
		render();
	},
	setRange: setDateRange,
	setIndicators: applyIndicators,
	fitChart: () => chart?.chart.timeScale().fitContent(),
	setLayout: enabled => {
		chart?.setMobileLayout(enabled);
		const currentTab = state.tabs.find(tab => tab.id === state.activeTabId);
		if (chart && currentTab) {
			const expected = resolveActiveTimeframe(enabled, state.preferences[currentTab.instrumentKey].timeframe, mobileTimeframe);
			if (renderedTimeframe && expected !== renderedTimeframe) render();
		}
	},
});

function setDateRange(seconds: number): void {
	if (!chart || !state.activeTabId || candleCount === 0) return;
	const tab = state.tabs.find(item => item.id === state.activeTabId);
	if (!tab) return;
	const timeframe = resolveActiveTimeframe(mobile.isMobile(), state.preferences[tab.instrumentKey].timeframe, mobileTimeframe);
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
		const row = element('div', 'search-result');
		const open = element('button', 'search-result-main');
		open.type = 'button';
		const copy = element('span', 'search-copy');
		const sub = element('span', 'search-sub');
		sub.append(
			element('small', '', `${marketFor(instrument).name} / TetherUS`),
			element('span', `search-market-tag ${instrument.market}`, instrument.market === 'perpetual' ? '永续合约' : '现货'),
		);
		copy.append(element('strong', '', symbolLabel(instrument)), sub);
		open.append(coinBadge(instrument), copy, element('span', 'search-venue', providerRegistry.labelForVenue(instrument.venue).toUpperCase()));
		open.onclick = () => {
			if (mobile.isMobile()) {
				preserveMobileTimeframe();
				mobile.showChart();
			}
			commit(openInstrument(state, instrument));
			picker.close();
		};

		const watchToggle = element('button', 'search-watch-toggle');
		watchToggle.type = 'button';
		const syncToggleState = (watched: boolean): void => {
			watchToggle.classList.toggle('is-watched', watched);
			watchToggle.setAttribute('aria-pressed', String(watched));
			watchToggle.setAttribute('aria-label', `${watched ? '从自选列表移除' : '添加到自选列表'} ${symbolLabel(instrument)}`);
			watchToggle.title = watched ? '已在自选列表，点击移除' : '添加到自选列表';
			watchToggle.replaceChildren(icon(watched ? 'check' : 'plus'));
		};
		syncToggleState(hasInWatchlist(instruments, instrument));
		watchToggle.onclick = event => {
			event.stopPropagation();
			const toggled = toggleWatchlistItem(instruments, instrument);
			saveWatchlist(toggled.items);
			syncToggleState(toggled.added);
		};

		row.append(open, watchToggle);
		searchResults.append(row);
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

function commit(next: Workspace, options: { tabsOnly?: boolean } = {}): void {
	const tabsChanged = next.activeTabId !== state.activeTabId ||
		next.tabs.length !== state.tabs.length ||
		next.tabs.some((tab, i) => tab.id !== state.tabs[i]?.id || tab.instrumentKey !== state.tabs[i]?.instrumentKey);
	state = next;
	ensureWatchlist();
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
		storageNotice = '已保存到本机';
	} catch {
		storageNotice = '保存失败，修改仅在当前会话中有效';
	}
	if (tabsChanged) {
		void syncEngine.enqueueSetting('workspace-tabs', {
			schemaVersion: 1,
			tabs: state.tabs.map(tab => ({ ...tab })),
			activeTabId: state.activeTabId,
		});
	}
	if (options.tabsOnly) {
		renderTabs(false);
		status.textContent = storageNotice;
	} else render();
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
		const closeBtn = iconButton('close', `移除 ${def?.shortName ?? paneId}`, () => {
			if (isMaximized) chart?.setMaximizedPane(null);
			setIndicatorEnabled(settings, paneId, false);
			applyIndicators();
		});
		closeBtn.className = 'pane-corner-btn';
		bar.append(closeBtn);
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
	const venueLabel = providerRegistry.labelForVenue(instrument.venue);
	const heading = element('h2', 'detail-title');
	heading.append(coinBadge(instrument), document.createTextNode(symbolLabel(instrument)));
	detail.append(heading, element('p', 'detail-subtitle', `${marketFor(instrument).name} / TetherUS`), element('p', 'detail-market', `${marketLabel(instrument)} · USDT · ${venueLabel.toUpperCase()}`));
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
	detail.append(dailyRange, element('div', 'detail-note', `${venueLabel} · 24h 滚动统计 · ${new Date(quote.updatedAt).toLocaleTimeString('zh-CN')}`));
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

function renderTabs(scrollActive = true): void {
	tabReorder.cancel();
	const focusedId = document.activeElement?.closest<HTMLElement>('.tab')?.dataset.tabId;
	tabs.replaceChildren();
	for (const tab of state.tabs) {
		const preference = state.preferences[tab.instrumentKey];
		const group = element('div', `tab ${tab.id === state.activeTabId ? 'active' : ''}`);
		group.dataset.tabId = tab.id;
		const focus = element('button', 'tab-focus');
		focus.append(coinBadge(preference.instrument), element('span', 'tab-symbol', symbolLabel(preference.instrument)), element('small', 'tab-period', preference.timeframe));
		focus.setAttribute('aria-label', `${preference.instrument.symbol} ${marketLabel(preference.instrument)} · ${preference.timeframe}`);
		focus.setAttribute('aria-pressed', String(tab.id === state.activeTabId));
		focus.title = '左右拖动调整顺序；Alt + ← / → 移动标签';
		focus.setAttribute('aria-keyshortcuts', 'Alt+ArrowLeft Alt+ArrowRight');
		focus.onclick = () => { if (state.activeTabId !== tab.id) commit({ ...state, activeTabId: tab.id }); };
		const close = iconButton('close', `关闭 ${preference.instrument.symbol} ${marketLabel(preference.instrument)}`, () => commit(closeTab(state, tab.id)));
		close.classList.add('tab-close');
		group.append(focus, close);
		tabs.append(group);
	}
	if (scrollActive) tabs.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	if (focusedId) {
		const focused = Array.from(tabs.querySelectorAll<HTMLElement>('.tab')).find(tab => tab.dataset.tabId === focusedId);
		focused?.querySelector<HTMLButtonElement>('.tab-focus')?.focus({ preventScroll: true });
	}
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
	stage.replaceChildren();
	ohlc.replaceChildren();
	status.textContent = storageNotice;
	for (const item of ranges.querySelectorAll('button')) item.classList.remove('selected');
	renderTabs();
	const active = state.tabs.find(tab => tab.id === state.activeTabId);
	for (const [key, entry] of quoteRows) entry.row.classList.toggle('selected', key === active?.instrumentKey);
	updateIndicatorLabels();
	marketStatus.hidden = !active;
	const preference = active ? state.preferences[active.instrumentKey] : undefined;
	const activeTimeframe = preference ? resolveActiveTimeframe(mobile.isMobile(), preference.timeframe, mobileTimeframe) : undefined;
	renderedTimeframe = activeTimeframe;
	timeframeUI.update(activeTimeframe);
	mobile.update(preference?.instrument, activeTimeframe ?? '1h', quotes);
	renderDetail(preference?.instrument);
	symbolButton.replaceChildren(icon('search'), element('span', '', preference ? symbolLabel(preference.instrument) : '搜索交易对'));
	if (!active || !preference || !activeTimeframe) {
		title.textContent = '你的下一个机会，从这里开始';
		emptyState.hidden = false;
		emptyState.replaceChildren(icon('candles'), element('h2', '', '打开一个交易对'), element('p', '', '已关闭交易对的周期设置会保留。'));
		const open = element('button', 'primary-button', '搜索交易对');
		open.onclick = () => openPicker();
		emptyState.append(open);
		return;
	}
	const venueLabel = providerRegistry.labelForVenue(preference.instrument.venue);
	const activeProvider = providerRegistry.resolve(preference.instrument.venue);
	title.replaceChildren(coinBadge(preference.instrument), element('span', '', `${marketFor(preference.instrument).name} / USDT · ${marketLabel(preference.instrument)}`), element('span', 'chart-meta', `· ${TIMEFRAME_LONG_LABELS[activeTimeframe]} · ${venueLabel.toUpperCase()}`));
	if (!activeProvider) {
		setConnectionState('error', '未配置数据源', venueLabel);
		const configBtn = element('button', 'primary-button', '打开数据源设置');
		configBtn.onclick = () => settingsModal.open('data-source');
		emptyState.hidden = false;
		emptyState.replaceChildren(
			element('p', '', `当前未配置数据源 "${preference.instrument.venue}"，原有标签与画线已保留。请在设置中配置该数据源后再加载行情。`),
			configBtn,
		);
		return;
	}
	emptyState.hidden = false;
	emptyState.replaceChildren(element('p', '', `正在加载 ${venueLabel} 行情…`));
	const currentChart = createTerminalChart(stage, settings, renderOhlc, applyPaneLayout);
	chart = currentChart;
	updateIndicatorLabels();
	drawingSession = createDrawingSession(
		currentChart,
		active.instrumentKey,
		TIMEFRAME_SECONDS[activeTimeframe],
		(message, error) => drawingUI.setStatus(message, error),
		() => { if (current()) drawingUI.setReady(true); },
		{
			onSaved: changed => {
				for (const doc of changed) void syncEngine.enqueueDrawing(doc);
			},
			onStyleDefaultChanged: () => {
				void syncEngine.enqueueSetting('drawing-defaults', exportSharedStyleDefaults());
			},
		},
	);
	const currentDrawings = drawingSession;
	drawingUI.attach(currentDrawings);
	priceAxisShortcut = createPriceAxisShortcut(stageWrap, currentChart, currentDrawings);
	currentChart.setMobileLayout(mobile.isMobile());
	currentChart.chart.applyOptions({ crosshair: { mode: crosshairVisible ? CrosshairMode.Normal : CrosshairMode.Hidden } });
	currentChart.setPriceFormat(priceTick(preference.instrument));
	const current = (): boolean => version === renderVersion && chart === currentChart;
	feed = startCandleFeed(activeProvider, preference.instrument, activeTimeframe, {
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
			setConnectionState(connection, message, venueLabel);
			if (connection === 'error' && candleCount === 0) {
				const retry = element('button', 'primary-button', '重新连接');
				retry.onclick = () => feed?.retry();
				emptyState.hidden = false;
				if (dataSourceSettings.binance.transport === 'relay' && preference.instrument.venue === 'binance' && !currentRelayTarget.ready) {
					const actionBtn = element('button', 'primary-button', currentRelayTarget.needsToken ? '填写访问口令' : '打开数据源设置');
					actionBtn.onclick = () => settingsModal.open(currentRelayTarget.needsToken ? 'storage' : 'data-source');
					emptyState.replaceChildren(element('p', '', message), actionBtn);
				} else {
					emptyState.replaceChildren(element('p', '', message), retry);
				}
			}
		},
	});
	currentChart.chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
		if (range && range.from < 20 && current()) void feed?.loadOlder();
	});
}

let lastConnectionState: ConnectionState = 'connecting';
function setConnectionState(connection: ConnectionState, message: string, sourceLabel = providerRegistry.active.label): void {
	lastConnectionState = connection;
	const fullLabel = `${sourceLabel} · ${message}`;
	if (sourceStatus.textContent === fullLabel) return;
	sourceStatus.replaceChildren(element('i', 'status-dot'), document.createTextNode(fullLabel));
	sourceStatus.dataset.state = connection;
	marketStatus.dataset.state = connection;
	marketStatus.replaceChildren(element('i', 'market-status-dot'), element('span', '', message));
	demoBadge.textContent = connection === 'live' ? `${sourceLabel} ${message}` : `${sourceLabel} 连接中`;
	mobile.setConnection(connection, message, sourceLabel);
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

function relayTargetFingerprint(target: MarketRelayTarget): string {
	return [
		target.ready ? '1' : '0',
		target.checking ? '1' : '0',
		target.source,
		target.baseUrl,
		target.auth.mode,
		target.auth.mode === 'token' ? target.auth.token : '',
		target.needsToken ? '1' : '0',
		target.reason ?? '',
	].join('|');
}

function providerFingerprint(): string {
	const { binance, generic } = dataSourceSettings;
	return [
		binance.transport,
		binance.transport === 'relay' ? relayTargetFingerprint(currentRelayTarget) : '',
		binance.spotRest,
		binance.perpetualRest,
		binance.spotWs,
		binance.perpetualWs,
		generic.venue,
		generic.restBaseUrl,
		generic.wsUrl,
		generic.pollIntervalMs,
		generic.markets.join(','),
	].join('|');
}

function ensureWatchlist(): void {
	const subscribed: Instrument[] = [];
	const seen = new Set<string>();
	for (const instrument of instruments) {
		const key = instrumentKey(instrument);
		if (!seen.has(key) && providerRegistry.resolve(instrument.venue)) {
			seen.add(key);
			subscribed.push(instrument);
		}
	}
	for (const tab of state.tabs) {
		const instrument = state.preferences[tab.instrumentKey].instrument;
		if (providerRegistry.resolve(instrument.venue) && !seen.has(tab.instrumentKey)) {
			seen.add(tab.instrumentKey);
			subscribed.push(instrument);
		}
	}
	const signature = `${providerFingerprint()}::${subscribed.map(instrumentKey).join(',')}`;
	if (signature === quoteSubscription) return;
	stopQuotes?.();
	quoteSubscription = signature;
	if (subscribed.length === 0) return;
	stopQuotes = startQuoteFeed(venue => providerRegistry.resolve(venue), subscribed, (instrument, quote) => {
		quotes.set(instrumentKey(instrument), quote);
		if (!quoteFlush) quoteFlush = setTimeout(flushQuotes, 400);
	}, (market, message) => {
		quoteStates[market] = message;
		mobile.setQuoteStatus(`现货：${quoteStates.spot} · 永续：${quoteStates.perpetual}`);
	});
}

async function loadCatalogue(): Promise<void> {
	catalogueRequest?.abort();
	const controller = new AbortController();
	catalogueRequest = controller;
	const activeProvider = providerRegistry.active;
	catalogueNotice = `正在加载 ${activeProvider.label} 交易对…`;
	if (picker.open) renderSearch();
	const failed: string[] = [];
	const loaded: { instrument: Instrument; tickSize: number }[] = [];
	await Promise.all((['spot', 'perpetual'] as const).map(async market => {
		try {
			const items = await activeProvider.getInstruments(market, controller.signal);
			loaded.push(...items);
		} catch {
			failed.push(market === 'spot' ? '现货' : '永续');
		}
	}));
	if (controller.signal.aborted) return;
	if (loaded.length > 0) {
		replaceCatalogue(loaded);
	} else if (activeProvider.venue === 'binance') {
		replaceCatalogue(defaultInstruments.map(instrument => ({ instrument, tickSize: priceTick(instrument) })));
	} else {
		replaceCatalogue([]);
	}
	catalogueNotice = failed.length
		? `${activeProvider.label} ${failed.join(' / ')}目录加载失败；重新打开搜索可重试`
		: `${activeProvider.label.toUpperCase()} · ${catalogue.length} 个交易对 · 最多显示 100 项，请输入搜索`;
	const active = state.tabs.find(tab => tab.id === state.activeTabId);
	if (active) chart?.setPriceFormat(priceTick(state.preferences[active.instrumentKey].instrument));
	if (picker.open) renderSearch();
}

function rebuildProvidersAndRefresh(): void {
	providerRegistry = createProviderRegistry(dataSourceSettings, undefined, undefined, currentRelayTarget);
	mobile.setDataSourceLabel(providerRegistry.active.label);
	quoteSubscription = '';
	ensureWatchlist();
	void loadCatalogue();
	render();
}

function applyDataSourceSettings(next: DataSourceSettings): void {
	saveDataSourceSettings(next);
	dataSourceSettings = next;
	currentRelayTarget = syncEngine.getMarketRelayTarget();
	lastRelayFingerprint = relayTargetFingerprint(currentRelayTarget);
	rebuildProvidersAndRefresh();
}

function updateClock(): void {
	timeLabel.textContent = `${new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' }).format(new Date())} UTC+8`;
}
function onDocumentPointerDown(event: PointerEvent): void {
	if (watchContextMenu && event.target instanceof Node && !watchContextMenu.contains(event.target)) {
		closeWatchContextMenu();
	}
	if (indicatorDropdown.hidden) return;
	if (event.target instanceof Element && event.target.closest('.tv-color-popover')) return;
	if (event.target instanceof Node && !indicatorDropdown.contains(event.target) && !indicatorButton.contains(event.target)) {
		closeIndicatorDropdown();
	}
}
function onKeyDown(event: KeyboardEvent): void {
	if (event.key === 'Escape') {
		if (watchContextMenu) { closeWatchContextMenu(); return; }
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
let remoteWorkspaceDirty = false;
const DRAWING_KEY_PREFIX = 'crypto-terminal.drawings.v1.';

function readAllLocalDrawingStores(): Map<string, DrawingStore> {
	const stores = new Map<string, DrawingStore>();
	try {
		for (let i = 0; i < localStorage.length; i++) {
			const storageKey = localStorage.key(i);
			if (!storageKey || !storageKey.startsWith(DRAWING_KEY_PREFIX)) continue;
			const key = storageKey.slice(DRAWING_KEY_PREFIX.length);
			const raw = localStorage.getItem(storageKey);
			if (!raw) continue;
			try {
				stores.set(key, parseDrawingStore(JSON.parse(raw), key));
			} catch {
				// Skip malformed drawing records rather than throwing during export.
			}
		}
	} catch {
		// Ignore localStorage enumeration errors.
	}
	if (drawingSession) {
		const activeStore = drawingSession.exportStore();
		stores.set(activeStore.instrumentKey, activeStore);
	}
	return stores;
}

function writeDrawingStoreToStorage(key: string, records: readonly SyncedDrawingRecord[], replace: boolean): void {
	if (!replace && drawingSession && drawingSession.instrumentKey === key) {
		drawingSession.applySyncedDocuments(records);
		return;
	}
	const storageKey = drawingStorageKey(key);
	const merged = new Map<string, DrawingStore['documents'][number]>();
	if (!replace) {
		try {
			const raw = localStorage.getItem(storageKey);
			if (raw) {
				const existing = parseDrawingStore(JSON.parse(raw), key);
				for (const doc of existing.documents) merged.set(doc.id, doc);
			}
		} catch {
			// Fall through with incoming validated records.
		}
	}
	for (const rec of records) {
		merged.set(rec.id, {
			schemaVersion: 1,
			id: rec.id,
			instrumentKey: key,
			kind: rec.kind,
			anchors: structuredClone(rec.anchors),
			style: structuredClone(rec.style),
			revision: rec.revision,
			deleted: rec.deleted,
		});
	}
	const store: DrawingStore = { schemaVersion: 1, instrumentKey: key, documents: [...merged.values()] };
	try {
		parseDrawingStore(store, key);
		localStorage.setItem(storageKey, JSON.stringify(store));
	} catch {
		// Ignore invalid drawing records or storage quota issues.
	}
}

function applyRemoteSettingRecord(record: SyncedSettingRecord): void {
	try {
		if (record.key === 'indicators') {
			const parsed = parseIndicatorSettings(record.value);
			// Mutate in place so mobile sheet and desktop panel always share the live settings reference.
			Object.assign(settings, parsed);
			localStorage.setItem(INDICATOR_STORAGE_KEY, JSON.stringify(settings));
			chart?.setIndicators(settings);
			updateIndicatorLabels();
		} else if (record.key === 'timeframes') {
			timeframeUI.setPrefs(parseTimeframePreferences(record.value));
		} else if (record.key === 'drawing-defaults') {
			const parsed = parseDrawingStyleDefaultsStore(record.value);
			localStorage.setItem(DRAWING_DEFAULTS_STORAGE_KEY, JSON.stringify(parsed));
			reloadSharedStyleDefaults();
		} else if (record.key === 'custom-colors') {
			const parsed = parseCustomColorsStore(record.value);
			localStorage.setItem(CUSTOM_COLORS_STORAGE_KEY, JSON.stringify(parsed));
			reloadSharedCustomColors();
		} else if (record.key === 'watchlist') {
			const parsed = parseWatchlistStore(record.value);
			saveWatchlist(parsed.items, false);
			if (picker.open) renderSearch();
		} else if (record.key === 'workspace-tabs') {
			const parsed = parseWorkspaceTabsSnapshot(record.value);
			const preferences: Workspace['preferences'] = { ...state.preferences };
			for (const tab of parsed.tabs) {
				if (!preferences[tab.instrumentKey]) {
					preferences[tab.instrumentKey] = {
						instrument: parseInstrumentKey(tab.instrumentKey),
						timeframe: '1h',
					};
				}
			}
			const nextWorkspace: Workspace = {
				schemaVersion: 1,
				tabs: parsed.tabs.map(tab => ({ ...tab })),
				activeTabId: parsed.activeTabId,
				preferences,
			};
			if (JSON.stringify({ tabs: state.tabs, activeTabId: state.activeTabId }) !== JSON.stringify({ tabs: nextWorkspace.tabs, activeTabId: nextWorkspace.activeTabId })) {
				state = nextWorkspace;
				try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
				remoteWorkspaceDirty = true;
			}
		}
	} catch {
		// Ignore incompatible remote setting payload.
	}
}

const syncEngine = new SyncEngine(
	new IndexedDbSyncStorage(),
	{
		exportLocalSnapshot(): SyncSnapshot {
			const now = new Date().toISOString();
			const syncedInstruments: SyncedInstrumentState[] = Object.entries(state.preferences).map(([key, pref]) => ({
				instrumentKey: key,
				instrument: { ...pref.instrument },
				timeframe: pref.timeframe,
				revision: 1,
				updatedAt: now,
			}));
			const stores = readAllLocalDrawingStores();
			const syncedDrawings: SyncedDrawingRecord[] = [];
			for (const store of stores.values()) {
				for (const doc of store.documents) {
					syncedDrawings.push({ ...structuredClone(doc), updatedAt: now });
				}
			}
			return {
				schemaVersion: 1,
				storeId: syncEngine.getViewState().config.lastStoreId ?? 'local-snapshot',
				exportedAt: now,
				instruments: syncedInstruments,
				drawings: syncedDrawings,
				settings: {
					indicators: {
						key: 'indicators',
						value: structuredClone(settings) as unknown as Record<string, unknown>,
						revision: 1,
						updatedAt: now,
					},
					timeframes: {
						key: 'timeframes',
						value: timeframeUI.getPrefs() as unknown as Record<string, unknown>,
						revision: 1,
						updatedAt: now,
					},
					'drawing-defaults': {
						key: 'drawing-defaults',
						value: exportSharedStyleDefaults(),
						revision: 1,
						updatedAt: now,
					},
					'custom-colors': {
						key: 'custom-colors',
						value: exportSharedCustomColors(),
						revision: 1,
						updatedAt: now,
					},
					watchlist: {
						key: 'watchlist',
						value: { schemaVersion: 1, items: instruments.map(item => ({ ...item })) },
						revision: 1,
						updatedAt: now,
					},
					'workspace-tabs': {
						key: 'workspace-tabs',
						value: {
							schemaVersion: 1,
							tabs: state.tabs.map(tab => ({ ...tab })),
							activeTabId: state.activeTabId,
						},
						revision: 1,
						updatedAt: now,
					},
				},
			};
		},
		applyRemotePreference(item: SyncedInstrumentState): void {
			const existing = state.preferences[item.instrumentKey];
			if (existing && existing.timeframe === item.timeframe) return;
			state = {
				...state,
				preferences: {
					...state.preferences,
					[item.instrumentKey]: { instrument: { ...item.instrument }, timeframe: item.timeframe },
				},
			};
			try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
			remoteWorkspaceDirty = true;
		},
		applyRemoteDrawings(key: string, records: SyncedDrawingRecord[]): void {
			writeDrawingStoreToStorage(key, records, false);
		},
		confirmDrawingRevision(key: string, drawingId: string, revision: number): void {
			if (drawingSession && drawingSession.instrumentKey === key) {
				drawingSession.confirmSyncedRevision(drawingId, revision);
				return;
			}
			const storageKey = drawingStorageKey(key);
			try {
				const raw = localStorage.getItem(storageKey);
				if (!raw) return;
				const store = parseDrawingStore(JSON.parse(raw), key);
				const next: DrawingStore = {
					...store,
					documents: store.documents.map(doc => doc.id === drawingId ? { ...doc, revision } : doc),
				};
				localStorage.setItem(storageKey, JSON.stringify(next));
			} catch {
				// Ignore storage errors.
			}
		},
		applyRemoteSetting(record: SyncedSettingRecord): void {
			applyRemoteSettingRecord(record);
		},
		replaceLocalFromSnapshot(snapshot: SyncSnapshot): void {
			const nextPreferences: Workspace['preferences'] = {};
			for (const item of snapshot.instruments) {
				nextPreferences[item.instrumentKey] = { instrument: { ...item.instrument }, timeframe: item.timeframe };
			}
			// Preserve open tabs whose preferences exist, or keep default preference for currently open tabs.
			for (const tab of state.tabs) {
				if (!nextPreferences[tab.instrumentKey] && state.preferences[tab.instrumentKey]) {
					nextPreferences[tab.instrumentKey] = state.preferences[tab.instrumentKey];
				}
			}
			state = { ...state, preferences: nextPreferences };
			try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }

			// Replace local drawings cleanly by instrument.
			try {
				const keysToClear: string[] = [];
				for (let i = 0; i < localStorage.length; i++) {
					const k = localStorage.key(i);
					if (k?.startsWith(DRAWING_KEY_PREFIX)) keysToClear.push(k);
				}
				for (const k of keysToClear) localStorage.removeItem(k);
			} catch {
				// Ignore storage errors.
			}
			const grouped = new Map<string, SyncedDrawingRecord[]>();
			for (const rec of snapshot.drawings) {
				const list = grouped.get(rec.instrumentKey) ?? [];
				list.push(rec);
				grouped.set(rec.instrumentKey, list);
			}
			for (const [key, list] of grouped) writeDrawingStoreToStorage(key, list, true);
			for (const record of Object.values(snapshot.settings)) applyRemoteSettingRecord(record);
			remoteWorkspaceDirty = true;
		},
		onRemoteApplied(): void {
			if (!remoteWorkspaceDirty) return;
			remoteWorkspaceDirty = false;
			ensureWatchlist();
			render();
		},
	},
	{ fallbackOrigin: window.location.origin },
);

const settingsModal = createSettingsModal(app, {
	syncEngine,
	dataSource: {
		getSettings: () => dataSourceSettings,
		applySettings: applyDataSourceSettings,
	},
});
mobile.setDataSourceLabel(providerRegistry.active.label);
setCustomColorsChangeListener(() => {
	void syncEngine.enqueueSetting('custom-colors', exportSharedCustomColors());
});
let appBootstrapped = false;
const unsubscribeSync = syncEngine.subscribe(view => {
	syncStatusBtn.dataset.state = view.status;
	syncStatusText.textContent = view.message;
	mobile.setSyncStatus(view.message);
	const nextRelay = syncEngine.getMarketRelayTarget();
	const nextFingerprint = relayTargetFingerprint(nextRelay);
	if (nextFingerprint !== lastRelayFingerprint) {
		currentRelayTarget = nextRelay;
		lastRelayFingerprint = nextFingerprint;
		if (appBootstrapped && dataSourceSettings.binance.transport === 'relay') {
			rebuildProvidersAndRefresh();
		} else if (dataSourceSettings.binance.transport === 'relay') {
			providerRegistry = createProviderRegistry(dataSourceSettings, undefined, undefined, currentRelayTarget);
			mobile.setDataSourceLabel(providerRegistry.active.label);
		}
	}
});

let hiddenSince = 0;
const onOnline = (): void => { feed?.retry(); void syncEngine.syncNow(); };
const onVisibility = (): void => {
	if (document.hidden) {
		hiddenSince = Date.now();
		drawingSession?.flush();
		return;
	}
	const awayMs = hiddenSince ? Date.now() - hiddenSince : 0;
	hiddenSince = 0;
	if (lastConnectionState !== 'live' || awayMs >= 30000) {
		feed?.retry();
	}
	void syncEngine.syncNow();
};
const onBeforeUnload = (): void => { drawingSession?.flush(); };
window.addEventListener('online', onOnline);
document.addEventListener('visibilitychange', onVisibility);
document.addEventListener('pointerdown', onDocumentPointerDown);
document.addEventListener('keydown', onKeyDown);
window.addEventListener('resize', onWindowResize);
window.addEventListener('beforeunload', onBeforeUnload);
window.addEventListener('pagehide', onPageHide);
window.addEventListener('pageshow', onPageShow);
const clockTimer = window.setInterval(updateClock, 30000);
if (import.meta.hot) import.meta.hot.dispose(() => {
	tabReorder.destroy();
	stopChartPinch();
	stopViewportZoomGuard();
	closeWatchContextMenu();
	closeIndicatorColorPopover();
	setCustomColorsChangeListener(undefined);
	unsubscribeSync();
	syncEngine.stopPolling();
	settingsModal.destroy();
	timeframeUI.destroy();
	mobile.destroy();
	onPageHide();
	drawingUI.destroy();
	window.clearInterval(clockTimer);
	document.removeEventListener('pointerdown', onDocumentPointerDown);
	document.removeEventListener('keydown', onKeyDown);
	window.removeEventListener('resize', onWindowResize);
	window.removeEventListener('beforeunload', onBeforeUnload);
	window.removeEventListener('pagehide', onPageHide);
	window.removeEventListener('pageshow', onPageShow);
	window.removeEventListener('online', onOnline);
	document.removeEventListener('visibilitychange', onVisibility);
});
appBootstrapped = true;
updateClock();
updateSidebarAccessibility();
ensureWatchlist();
render();
void loadCatalogue();
void syncEngine.init().then(() => syncEngine.startPolling(30000));
