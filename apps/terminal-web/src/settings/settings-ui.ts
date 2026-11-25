import { defaultEndpoints } from '../data/binance';
import {
	parseDataSourceSettings,
	parseDefaultSymbolList,
	testDataSourceConnection,
	type BinanceTransportMode,
	type DataSourceSettings,
	type DataSourceType,
} from '../data/data-source';
import type { SyncEngine, SyncViewState } from '../sync/engine';
import { element, icon, iconButton } from '../ui';
import './settings.css';

export type SettingsTab = 'data-source' | 'storage' | 'backup';

export interface DataSourceController {
	getSettings(): DataSourceSettings;
	applySettings(next: DataSourceSettings): void;
}

function triggerDownload(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	document.body.append(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const GENERIC_PROTOCOL_SPEC = `# 1. 历史与最新 K 线（必填）
GET {REST根地址}/klines?symbol=BTC-USDT&market=spot&interval=1h&limit=500&before={UTC秒}&after={UTC秒}
响应（数组，或 { "candles": [...] } / { "data": [...] }）：
[
  { "time": 1700000000, "open": 67000, "high": 67500, "low": 66800, "close": 67300, "volume": 12.5 }
]
* time 支持 UTC 秒或毫秒；亦支持简写数组 [time, open, high, low, close, volume]

# 2. 交易对目录（可选，未实现返回 404 时自动使用下方备用交易对列表）
GET {REST根地址}/instruments?market=spot
响应：[{ "symbol": "BTC-USDT", "market": "spot", "tickSize": 0.01 }]

# 3. 24h 报价（可选，未实现返回 404 时自动从最新 K 线推算）
GET {REST根地址}/ticker?symbol=BTC-USDT&market=spot
响应：{ "price": 67300, "change": 320, "percent": 0.48, "high": 67800, "low": 66500, "updatedAt": 1700000000000 }

# 4. 实时 WebSocket（可选，留空则自动按轮询间隔拉取）
连接后客户端发送：{ "type": "subscribe", "channel": "kline", "symbol": "BTC-USDT", "market": "spot", "interval": "1h" }
服务端推送：{ "type": "kline", "symbol": "BTC-USDT", "market": "spot", "interval": "1h", "candle": { "time": 1700000000, "open": 67000, "high": 67500, "low": 66800, "close": 67350, "volume": 15.2 } }`;

export function createSettingsModal(
	app: HTMLElement,
	options: {
		syncEngine: SyncEngine;
		dataSource: DataSourceController;
	},
) {
	const { syncEngine, dataSource } = options;
	const dialog = element('dialog', 'settings-dialog');
	dialog.setAttribute('aria-label', '应用设置');

	const head = element('div', 'settings-head');
	const headTitle = element('div', 'settings-head-title');
	headTitle.append(icon('settings'), element('h2', '', '设置'));
	head.append(headTitle, iconButton('close', '关闭设置', () => dialog.close()));

	const shell = element('div', 'settings-shell');
	const nav = element('nav', 'settings-nav');
	nav.setAttribute('role', 'tablist');
	nav.setAttribute('aria-label', '设置分类');
	const content = element('div', 'settings-content');
	shell.append(nav, content);
	dialog.append(head, shell);
	app.append(dialog);

	let activeTab: SettingsTab = 'data-source';
	let latestSync: SyncViewState = syncEngine.getViewState();
	let busy = false;
	let feedbackText = '';
	let feedbackError = false;

	// Draft state for Data Source tab
	let draftSourceType: DataSourceType = 'binance';
	let draftBinance: { spotRest: string; perpetualRest: string; spotWs: string; perpetualWs: string; transport: BinanceTransportMode } = {
		...defaultEndpoints,
		transport: 'relay',
	};
	let draftGeneric = {
		venue: 'custom',
		label: '自定义行情源',
		restBaseUrl: '',
		wsUrl: '',
		pollIntervalMs: '5000',
		spot: true,
		perpetual: true,
		defaultSymbolsText: 'BTC-USDT, ETH-USDT, SOL-USDT, BNB-USDT',
	};
	let sourceDraftLoaded = false;

	// Draft state for Storage tab
	let draftStorageMode: 'local' | 'remote' = 'local';
	let draftServerUrl = '';
	let draftToken = '';
	let storageDraftLoaded = false;

	// Draft state for Backup tab
	let importMode: 'merge' | 'replace' = 'merge';

	const fileInput = document.createElement('input');
	fileInput.type = 'file';
	fileInput.accept = '.json,application/json';
	fileInput.hidden = true;
	dialog.append(fileInput);

	fileInput.onchange = async () => {
		const file = fileInput.files?.[0];
		fileInput.value = '';
		if (!file) return;
		setFeedback('正在校验并导入 JSON 快照…', false);
		busy = true;
		render();
		try {
			const text = await file.text();
			await syncEngine.importPortableJson(JSON.parse(text), importMode);
			setFeedback(importMode === 'replace' ? '已替换并恢复快照数据' : '已合并导入快照数据', false);
		} catch (error) {
			setFeedback(`导入失败：${error instanceof Error ? error.message : '文件格式无效'}`, true);
		} finally {
			busy = false;
			render();
		}
	};

	function setFeedback(text: string, isError: boolean): void {
		feedbackText = text;
		feedbackError = isError;
	}

	function syncSourceDraftFromCurrent(): void {
		const current = dataSource.getSettings();
		draftSourceType = current.activeType;
		draftBinance = { ...current.binance };
		draftGeneric = {
			venue: current.generic.venue,
			label: current.generic.label,
			restBaseUrl: current.generic.restBaseUrl,
			wsUrl: current.generic.wsUrl,
			pollIntervalMs: String(current.generic.pollIntervalMs),
			spot: current.generic.markets.includes('spot'),
			perpetual: current.generic.markets.includes('perpetual'),
			defaultSymbolsText: current.generic.defaultSymbols.join(', '),
		};
		sourceDraftLoaded = true;
	}

	function syncStorageDraftFromCurrent(): void {
		const cfg = latestSync.config;
		if (cfg.mode === 'remote') {
			draftStorageMode = 'remote';
		} else if (cfg.mode === 'local') {
			draftStorageMode = 'local';
		} else {
			draftStorageMode = latestSync.localService.available && latestSync.localService.authMode === 'local' ? 'local' : 'remote';
		}
		draftServerUrl = cfg.serverUrl;
		draftToken = cfg.token;
		storageDraftLoaded = true;
	}

	function buildCandidateDataSourceSettings(): DataSourceSettings {
		const markets: ('spot' | 'perpetual')[] = [];
		if (draftGeneric.spot) markets.push('spot');
		if (draftGeneric.perpetual) markets.push('perpetual');
		return parseDataSourceSettings({
			schemaVersion: 1,
			activeType: draftSourceType,
			binance: { ...draftBinance },
			generic: {
				venue: draftGeneric.venue,
				label: draftGeneric.label,
				restBaseUrl: draftGeneric.restBaseUrl,
				wsUrl: draftGeneric.wsUrl,
				pollIntervalMs: Number(draftGeneric.pollIntervalMs),
				markets,
				defaultSymbols: parseDefaultSymbolList(draftGeneric.defaultSymbolsText),
			},
		});
	}

	function renderNav(): void {
		nav.replaceChildren();
		const currentSource = dataSource.getSettings();
		const sourceBadge = currentSource.activeType === 'binance' ? 'Binance' : currentSource.generic.label;
		const storageAlert = latestSync.conflictCount > 0 || Boolean(latestSync.storeMismatch) || latestSync.status === 'auth_error';
		const storageBadge = storageAlert
			? '需处理'
			: latestSync.config.mode === 'local' && latestSync.config.enabled
				? '本机'
				: latestSync.config.mode === 'remote' && latestSync.config.enabled
					? '远程'
					: '离线';

		const tabs: { id: SettingsTab; label: string; badge?: string; alert?: boolean }[] = [
			{ id: 'data-source', label: '数据源', badge: sourceBadge.slice(0, 10) },
			{ id: 'storage', label: '存储服务', badge: storageBadge, alert: storageAlert },
			{ id: 'backup', label: '数据导入导出' },
		];

		for (const item of tabs) {
			const btn = element('button', 'settings-nav-btn');
			btn.type = 'button';
			btn.setAttribute('role', 'tab');
			btn.setAttribute('aria-selected', String(activeTab === item.id));
			btn.append(element('span', '', item.label));
			if (item.badge) {
				btn.append(element('span', `settings-nav-badge${item.alert ? ' alert' : ''}`, item.badge));
			}
			btn.onclick = () => {
				if (activeTab === item.id) return;
				activeTab = item.id;
				setFeedback('', false);
				render();
			};
			nav.append(btn);
		}
	}

	function renderDataSourceTab(): void {
		if (!sourceDraftLoaded) syncSourceDraftFromCurrent();

		// 1. Supported Data Sources Guide
		const guideCard = element('section', 'settings-card info');
		guideCard.append(element('h3', '', '支持的数据源类型'));
		const list = document.createElement('ul');
		list.className = 'settings-guide-list';
		const items = [
			['内置 Binance 公开行情（默认）', '支持两种获取方式：①「通过当前服务转发」（默认，K 线与实时流全部由你连接的电脑/服务器发出，手机免开代理）；②「浏览器直连」（可配置自定义镜像或代理地址）。两者沿用同一 binance 标识，画线完全复用。'],
			['通用自定义协议源（HTTP JSON + 可选 WebSocket）', '支持接入自建行情服务、第三方转发网关或本地历史 K 线服务；只需提供标准 /klines 接口（/instruments、/ticker 和 WebSocket 均可选，无 WS 时自动按设定间隔轮询）。需服务端允许浏览器 CORS，不接受私钥或交易 API Key。'],
		];
		for (const [lead, detail] of items) {
			const li = document.createElement('li');
			li.append(element('strong', '', `${lead}：`), document.createTextNode(detail));
			list.append(li);
		}
		guideCard.append(
			list,
			element('p', 'settings-desc', '隔离规则：画线和周期与「数据源标识 + 市场 + 交易对」强绑定。切换默认数据源时，已打开的旧标签页和画线保持不变，仅新搜索和打开的交易对使用新数据源。'),
		);
		content.append(guideCard);

		// 2. Source Type Selector
		const selectorCard = element('section', 'settings-card');
		selectorCard.append(element('h3', '', '选择默认数据源'));
		const grid = element('div', 'settings-mode-grid');

		const binanceOption = element('button', 'settings-mode-card');
		binanceOption.type = 'button';
		binanceOption.setAttribute('aria-pressed', String(draftSourceType === 'binance'));
		binanceOption.append(
			element('strong', '', 'Binance（内置）'),
			element('small', '', 'USDT 现货 / 永续实时行情，可自定义代理或镜像地址'),
		);
		binanceOption.onclick = () => {
			draftSourceType = 'binance';
			setFeedback('', false);
			render();
		};

		const genericOption = element('button', 'settings-mode-card');
		genericOption.type = 'button';
		genericOption.setAttribute('aria-pressed', String(draftSourceType === 'generic'));
		genericOption.append(
			element('strong', '', '通用自定义协议源'),
			element('small', '', '标准 HTTP JSON K 线接口 + 可选 WebSocket / 轮询更新'),
		);
		genericOption.onclick = () => {
			draftSourceType = 'generic';
			setFeedback('', false);
			render();
		};

		grid.append(binanceOption, genericOption);
		selectorCard.append(grid);
		content.append(selectorCard);

		// 3. Detailed Configuration Form
		const formCard = element('section', 'settings-card');
		if (draftSourceType === 'binance') {
			formCard.append(element('h3', '', 'Binance 行情获取方式'));
			const transportGrid = element('div', 'settings-mode-grid');

			const relayBtn = element('button', 'settings-mode-card');
			relayBtn.type = 'button';
			relayBtn.setAttribute('aria-pressed', String(draftBinance.transport === 'relay'));
			relayBtn.append(
				element('strong', '', '通过当前服务转发（推荐）'),
				element('small', '', 'K 线、目录与实时流统一由电脑 / 服务器中继，手机免开代理'),
			);
			relayBtn.onclick = () => {
				draftBinance.transport = 'relay';
				setFeedback('', false);
				render();
			};

			const directBtn = element('button', 'settings-mode-card');
			directBtn.type = 'button';
			directBtn.setAttribute('aria-pressed', String(draftBinance.transport === 'direct'));
			directBtn.append(
				element('strong', '', '浏览器直连 Binance'),
				element('small', '', '由当前设备浏览器直接访问 Binance 或自定义镜像地址'),
			);
			directBtn.onclick = () => {
				draftBinance.transport = 'direct';
				setFeedback('', false);
				render();
			};
			transportGrid.append(relayBtn, directBtn);
			formCard.append(transportGrid);

			if (draftBinance.transport === 'relay') {
				const target = syncEngine.getMarketRelayTarget();
				const pillClass = target.ready ? 'settings-pill ok' : 'settings-pill warn';
				const pillText = target.ready
					? `中继就绪 · 通过${target.source === 'local' ? '本机内置服务' : '远程同步服务'} (${target.baseUrl}) 转发行情`
					: (target.reason ?? '等待连接中继服务…');
				formCard.append(element('div', pillClass, pillText));
				if (target.needsToken) {
					const tokenHintRow = element('div', 'settings-actions');
					const goStorage = element('button', 'settings-link-btn', '前往「存储服务」填写访问口令 →');
					goStorage.type = 'button';
					goStorage.onclick = () => {
						activeTab = 'storage';
						setFeedback('', false);
						render();
					};
					tokenHintRow.append(goStorage);
					formCard.append(tokenHintRow);
				}
				formCard.append(element('p', 'settings-desc', '说明：在海外 Docker 服务器上部署时服务端自动直连 Binance；若在家里电脑启动并供手机局域网看盘，可在电脑端 .env 设置 MARKET_PROXY_URL=http://127.0.0.1:7890 让服务端走电脑代理，手机即可免代理直接看盘。'));
			} else {
				const formHead = element('div', 'settings-card-head');
				formHead.append(element('h3', '', '自定义 Binance 直连 / 镜像地址'));
				const resetBtn = element('button', 'settings-link-btn', '恢复官方默认地址');
				resetBtn.type = 'button';
				resetBtn.onclick = () => {
					draftBinance = { ...defaultEndpoints, transport: 'direct' };
					setFeedback('已填充官方默认地址，点击「保存并应用」生效', false);
					render();
				};
				formHead.append(resetBtn);
				formCard.append(formHead);
				formCard.append(element('p', 'settings-desc', 'REST 填写根地址（自动拼接 /api/v3 或 /fapi/v1），永续 WebSocket 保留 /market 路径（自动拼接 /stream）。自定义代理需支持浏览器 CORS 与 WebSocket。'));

				const fields = element('div', 'settings-field-grid');
				const addBinanceField = (id: string, label: string, key: 'spotRest' | 'perpetualRest' | 'spotWs' | 'perpetualWs', placeholder: string) => {
					const wrap = element('div', 'settings-field full');
					const lbl = element('label');
					lbl.htmlFor = id;
					lbl.textContent = label;
					const input = element('input');
					input.id = id;
					input.type = 'url';
					input.placeholder = placeholder;
					input.value = draftBinance[key];
					input.oninput = () => { draftBinance[key] = input.value; };
					wrap.append(lbl, input);
					fields.append(wrap);
				};
				addBinanceField('ds-binance-spot-rest', '现货 REST 地址', 'spotRest', defaultEndpoints.spotRest);
				addBinanceField('ds-binance-spot-ws', '现货 WebSocket 地址', 'spotWs', defaultEndpoints.spotWs);
				addBinanceField('ds-binance-perp-rest', 'USDT 永续 REST 地址', 'perpetualRest', defaultEndpoints.perpetualRest);
				addBinanceField('ds-binance-perp-ws', 'USDT 永续 WebSocket 地址', 'perpetualWs', defaultEndpoints.perpetualWs);
				formCard.append(fields);
			}
		} else {
			formCard.append(element('h3', '', '通用自定义协议源配置'));
			formCard.append(element('p', 'settings-desc', '填写符合通用 JSON 协议的公开行情服务地址。数据源标识会写入交易对键（如 custom:spot:BTC-USDT），用于严格隔离该数据源的画线与周期。'));

			const fields = element('div', 'settings-field-grid');

			const labelWrap = element('div', 'settings-field');
			const labelLbl = element('label');
			labelLbl.htmlFor = 'ds-generic-label';
			labelLbl.textContent = '显示名称';
			const labelInput = element('input');
			labelInput.id = 'ds-generic-label';
			labelInput.type = 'text';
			labelInput.placeholder = '例如 自建行情网关';
			labelInput.value = draftGeneric.label;
			labelInput.oninput = () => { draftGeneric.label = labelInput.value; };
			labelWrap.append(labelLbl, labelInput);

			const venueWrap = element('div', 'settings-field');
			const venueLbl = element('label');
			venueLbl.htmlFor = 'ds-generic-venue';
			venueLbl.textContent = '数据源标识（venue）';
			const venueInput = element('input');
			venueInput.id = 'ds-generic-venue';
			venueInput.type = 'text';
			venueInput.placeholder = '例如 custom 或 my-feed';
			venueInput.value = draftGeneric.venue;
			venueInput.oninput = () => { draftGeneric.venue = venueInput.value; };
			venueWrap.append(venueLbl, venueInput, element('span', 'settings-field-hint', '仅小写字母、数字和连字符，不能为 binance'));

			const restWrap = element('div', 'settings-field full');
			const restLbl = element('label');
			restLbl.htmlFor = 'ds-generic-rest';
			restLbl.textContent = 'REST 根地址（必填，需实现 /klines）';
			const restInput = element('input');
			restInput.id = 'ds-generic-rest';
			restInput.type = 'url';
			restInput.placeholder = '例如 http://127.0.0.1:9000 或 https://market.example.com/api';
			restInput.value = draftGeneric.restBaseUrl;
			restInput.oninput = () => { draftGeneric.restBaseUrl = restInput.value; };
			restWrap.append(restLbl, restInput);

			const wsWrap = element('div', 'settings-field');
			const wsLbl = element('label');
			wsLbl.htmlFor = 'ds-generic-ws';
			wsLbl.textContent = 'WebSocket 地址（可选）';
			const wsInput = element('input');
			wsInput.id = 'ds-generic-ws';
			wsInput.type = 'url';
			wsInput.placeholder = '留空则自动使用 REST 轮询';
			wsInput.value = draftGeneric.wsUrl;
			wsInput.oninput = () => { draftGeneric.wsUrl = wsInput.value; };
			wsWrap.append(wsLbl, wsInput);

			const pollWrap = element('div', 'settings-field');
			const pollLbl = element('label');
			pollLbl.htmlFor = 'ds-generic-poll';
			pollLbl.textContent = '轮询间隔（毫秒，无 WS 时生效）';
			const pollInput = element('input');
			pollInput.id = 'ds-generic-poll';
			pollInput.type = 'number';
			pollInput.min = '2000';
			pollInput.max = '60000';
			pollInput.step = '1000';
			pollInput.value = draftGeneric.pollIntervalMs;
			pollInput.oninput = () => { draftGeneric.pollIntervalMs = pollInput.value; };
			pollWrap.append(pollLbl, pollInput);

			const marketsWrap = element('div', 'settings-field full');
			const marketsTitle = element('label');
			marketsTitle.textContent = '支持市场类型';
			const checks = element('div', 'settings-checks');
			const makeCheck = (text: string, checked: boolean, onChange: (value: boolean) => void) => {
				const lbl = element('label', 'settings-check');
				const box = document.createElement('input');
				box.type = 'checkbox';
				box.checked = checked;
				box.onchange = () => onChange(box.checked);
				lbl.append(box, document.createTextNode(text));
				return lbl;
			};
			checks.append(
				makeCheck('现货 (spot)', draftGeneric.spot, v => { draftGeneric.spot = v; }),
				makeCheck('USDT 永续 (perpetual)', draftGeneric.perpetual, v => { draftGeneric.perpetual = v; }),
			);
			marketsWrap.append(marketsTitle, checks);

			const symbolsWrap = element('div', 'settings-field full');
			const symbolsLbl = element('label');
			symbolsLbl.htmlFor = 'ds-generic-symbols';
			symbolsLbl.textContent = '备用交易对列表（服务端未实现 /instruments 时使用）';
			const symbolsInput = element('input');
			symbolsInput.id = 'ds-generic-symbols';
			symbolsInput.type = 'text';
			symbolsInput.placeholder = 'BTC-USDT, ETH-USDT, SOL-USDT';
			symbolsInput.value = draftGeneric.defaultSymbolsText;
			symbolsInput.oninput = () => { draftGeneric.defaultSymbolsText = symbolsInput.value; };
			symbolsWrap.append(symbolsLbl, symbolsInput);

			fields.append(labelWrap, venueWrap, restWrap, wsWrap, pollWrap, marketsWrap, symbolsWrap);
			formCard.append(fields);

			const details = document.createElement('details');
			details.className = 'settings-protocol-details';
			details.append(
				element('summary', '', '查看通用协议接口规范与 JSON 示例'),
				element('pre', 'settings-protocol-pre', GENERIC_PROTOCOL_SPEC),
			);
			formCard.append(details);
		}

		const actions = element('div', 'settings-actions');
		const testBtn = element('button', 'settings-btn', '测试连接');
		testBtn.type = 'button';
		testBtn.disabled = busy;
		testBtn.onclick = async () => {
			busy = true;
			setFeedback('正在测试数据源连接与返回格式…', false);
			render();
			try {
				const candidate = buildCandidateDataSourceSettings();
				const result = await testDataSourceConnection(candidate, draftSourceType, undefined, syncEngine.getMarketRelayTarget());
				setFeedback(result.summary, false);
			} catch (error) {
				setFeedback(`测试失败：${error instanceof Error ? error.message : '连接异常'}`, true);
			} finally {
				busy = false;
				render();
			}
		};

		const saveBtn = element('button', 'settings-btn primary', '保存并应用');
		saveBtn.type = 'button';
		saveBtn.disabled = busy;
		saveBtn.onclick = () => {
			try {
				const validated = buildCandidateDataSourceSettings();
				dataSource.applySettings(validated);
				const activeName = validated.activeType === 'binance' ? 'Binance' : `${validated.generic.label} (${validated.generic.venue})`;
				setFeedback(`已切换默认数据源为 ${activeName}；原有标签页与画线保持不变`, false);
			} catch (error) {
				setFeedback(`保存失败：${error instanceof Error ? error.message : '配置无效'}`, true);
			}
			render();
		};

		actions.append(testBtn, saveBtn);
		formCard.append(actions);
		content.append(formCard);
	}

	function renderStorageTab(): void {
		if (!storageDraftLoaded) syncStorageDraftFromCurrent();
		const view = latestSync;

		// 1. Status Card
		const statusCard = element('section', 'settings-card');
		const statusHead = element('div', 'settings-card-head');
		statusHead.append(element('h3', '', `当前状态：${view.message}`));
		const syncNowBtn = element('button', 'settings-btn', '立即同步');
		syncNowBtn.type = 'button';
		syncNowBtn.disabled = busy || !view.config.enabled || view.status === 'syncing';
		syncNowBtn.onclick = () => {
			setFeedback('', false);
			void syncEngine.syncNow();
		};
		statusHead.append(syncNowBtn);
		statusCard.append(
			statusHead,
			element('p', 'settings-desc', '单服务启动时默认自动连接本机内置 SQLite 存储（deploy/terminal/data/terminal.db），也可随时切换到自定义远程存储服务。同步内容覆盖自选列表、标签页、各交易对周期、画线（含删除墓碑）、指标、常用周期及画线默认样式。'),
		);
		if (view.config.lastStoreId) {
			statusCard.append(element('div', 'settings-meta', `Store ID: ${view.config.lastStoreId.slice(0, 12)} · 待同步: ${view.pendingCount} · 冲突: ${view.conflictCount}`));
		}
		content.append(statusCard);

		// 2. Store Mismatch Guard Card
		if (view.storeMismatch) {
			const mismatchCard = element('section', 'settings-card warning');
			mismatchCard.append(element('h3', '', view.storeMismatch.reason === 'store_changed'
				? '检测到存储库已变化'
				: '首次连接：本机与服务端均有数据'));
			mismatchCard.append(element('p', 'settings-desc', view.storeMismatch.reason === 'store_changed'
				? '可能在本机存储与远程存储之间进行了切换，或目标库已重置。为防止覆盖画线，请选择处理方式：'
				: '为避免覆盖已有画线和周期设置，请选择首次同步方式：'));
			const actions = element('div', 'settings-actions');
			const runChoice = (choice: 'merge' | 'push_replace' | 'pull_replace', label: string) => {
				const btn = element('button', choice === 'merge' ? 'settings-btn primary' : 'settings-btn', label);
				btn.type = 'button';
				btn.disabled = busy;
				btn.onclick = async () => {
					busy = true;
					setFeedback('正在处理存储库同步…', false);
					render();
					try {
						await syncEngine.resolveStoreMismatch(choice);
						setFeedback('已完成存储库同步', false);
					} catch (error) {
						setFeedback(error instanceof Error ? error.message : '操作失败', true);
					} finally {
						busy = false;
						render();
					}
				};
				return btn;
			};
			actions.append(
				runChoice('merge', '合并两端数据（推荐）'),
				runChoice('push_replace', '以本机覆盖服务端'),
				runChoice('pull_replace', '以服务端覆盖本机'),
			);
			mismatchCard.append(actions);
			content.append(mismatchCard);
		}

		// 3. Conflict Resolution Card
		if (view.conflicts.length > 0) {
			const conflictCard = element('section', 'settings-card danger');
			conflictCard.append(element('h3', '', `同步冲突（${view.conflicts.length}）`));
			conflictCard.append(element('p', 'settings-desc', '以下项目在另一设备已被修改，请逐项决定保留哪一版：'));
			for (const conflict of view.conflicts) {
				const row = element('div', 'settings-conflict-row');
				row.append(element('span', 'settings-conflict-label', conflict.label));
				const btns = element('div', 'settings-actions');
				const keepLocal = element('button', 'settings-btn primary', '保留本机');
				keepLocal.type = 'button';
				keepLocal.disabled = busy;
				keepLocal.onclick = () => { void syncEngine.resolveConflict(conflict.id, 'local'); };
				const useServer = element('button', 'settings-btn', '采用服务端');
				useServer.type = 'button';
				useServer.disabled = busy;
				useServer.onclick = () => { void syncEngine.resolveConflict(conflict.id, 'server'); };
				btns.append(keepLocal, useServer);
				row.append(btns);
				conflictCard.append(row);
			}
			content.append(conflictCard);
		}

		// 4. Storage Mode Switcher
		const modeCard = element('section', 'settings-card');
		modeCard.append(element('h3', '', '存储服务配置'));
		const modeGrid = element('div', 'settings-mode-grid');

		const localBtn = element('button', 'settings-mode-card');
		localBtn.type = 'button';
		localBtn.setAttribute('aria-pressed', String(draftStorageMode === 'local'));
		localBtn.append(
			element('strong', '', '本机内置存储（默认）'),
			element('small', '', '直连当前启动服务内置的 SQLite 数据库，无需填写地址与口令'),
		);
		localBtn.onclick = () => {
			draftStorageMode = 'local';
			setFeedback('', false);
			render();
		};

		const remoteBtn = element('button', 'settings-mode-card');
		remoteBtn.type = 'button';
		remoteBtn.setAttribute('aria-pressed', String(draftStorageMode === 'remote'));
		remoteBtn.append(
			element('strong', '', '自定义远程存储服务'),
			element('small', '', '连接远程 Docker / 局域网自托管同步服务（需填写地址与口令）'),
		);
		remoteBtn.onclick = () => {
			draftStorageMode = 'remote';
			setFeedback('', false);
			render();
		};

		modeGrid.append(localBtn, remoteBtn);
		modeCard.append(modeGrid);

		if (draftStorageMode === 'local') {
			const pillClass = view.localService.available && view.localService.authMode === 'local'
				? 'settings-pill ok'
				: 'settings-pill warn';
			const pillText = !view.localService.checked
				? '正在探测本机存储服务…'
				: view.localService.available && view.localService.authMode === 'local'
					? `已检测到本机内置存储（${window.location.origin}）`
					: view.localService.available && view.localService.authMode === 'token'
						? '当前同源服务启用了口令保护，请切到「自定义远程存储服务」并填写口令'
						: '未检测到同源本机存储服务（请用 pnpm dev:terminal 或 pnpm start:terminal 启动）';
			modeCard.append(element('div', pillClass, pillText));

			const localActions = element('div', 'settings-actions');
			const useLocalBtn = element('button', 'settings-btn primary', view.config.mode === 'local' && view.config.enabled ? '重新同步本机存储' : '启用本机默认存储');
			useLocalBtn.type = 'button';
			useLocalBtn.disabled = busy;
			useLocalBtn.onclick = async () => {
				busy = true;
				setFeedback('正在连接本机内置存储服务…', false);
				render();
				try {
					await syncEngine.useLocalStorage();
					setFeedback('已连接本机内置 SQLite 存储服务', false);
				} catch (error) {
					setFeedback(error instanceof Error ? error.message : '连接本机存储失败', true);
				} finally {
					busy = false;
					render();
				}
			};
			const probeBtn = element('button', 'settings-btn', '重新检测本机服务');
			probeBtn.type = 'button';
			probeBtn.disabled = busy;
			probeBtn.onclick = async () => {
				busy = true;
				setFeedback('正在检测本机存储服务…', false);
				render();
				try {
					const info = await syncEngine.probeLocalService();
					if (info.available && info.authMode === 'local') {
						setFeedback(`本机内置存储服务可用（Store: ${(info.storeId ?? '').slice(0, 8)}）`, false);
					} else if (info.available && info.authMode === 'token') {
						setFeedback('当前同源服务启用了访问口令保护，请切到「自定义远程存储服务」并填写 SYNC_TOKEN（地址可留空）', true);
					} else {
						setFeedback('未检测到同源存储服务，请确认通过单服务命令启动', true);
					}
				} finally {
					busy = false;
					render();
				}
			};
			localActions.append(useLocalBtn, probeBtn);
			if (view.config.enabled) {
				const disableBtn = element('button', 'settings-btn danger', '停用存储同步');
				disableBtn.type = 'button';
				disableBtn.disabled = busy;
				disableBtn.onclick = async () => {
					busy = true;
					try {
						await syncEngine.configure({ serverUrl: draftServerUrl, token: draftToken, enabled: false, mode: 'disabled' });
						setFeedback('已停用存储服务同步，当前仅使用浏览器缓存', false);
					} finally {
						busy = false;
						render();
					}
				};
				localActions.append(disableBtn);
			}
			modeCard.append(localActions);
		} else {
			const urlField = element('div', 'settings-field');
			const urlLabel = element('label');
			urlLabel.htmlFor = 'sync-server-url';
			urlLabel.append(element('span', '', '服务地址（同源 Docker 部署可留空）'));
			const useOriginBtn = element('button', 'settings-link-btn', '填入当前地址');
			useOriginBtn.type = 'button';
			useOriginBtn.onclick = () => {
				draftServerUrl = window.location.origin;
				urlInput.value = draftServerUrl;
			};
			urlLabel.append(useOriginBtn);
			const urlInput = element('input');
			urlInput.id = 'sync-server-url';
			urlInput.type = 'url';
			urlInput.placeholder = '例如 https://charts.example.com 或 http://192.168.1.10:8080';
			urlInput.value = draftServerUrl;
			urlInput.oninput = () => { draftServerUrl = urlInput.value; };
			urlField.append(urlLabel, urlInput);

			const tokenField = element('div', 'settings-field');
			const tokenLabel = element('label');
			tokenLabel.htmlFor = 'sync-access-token';
			tokenLabel.textContent = '访问口令（SYNC_TOKEN，仅存于本机浏览器）';
			const tokenInput = element('input');
			tokenInput.id = 'sync-access-token';
			tokenInput.type = 'password';
			tokenInput.autocomplete = 'current-password';
			tokenInput.placeholder = '至少 8 位，与服务端 .env 中 SYNC_TOKEN 一致';
			tokenInput.value = draftToken;
			tokenInput.oninput = () => { draftToken = tokenInput.value; };
			tokenField.append(tokenLabel, tokenInput);

			const cfgActions = element('div', 'settings-actions');
			const testBtn = element('button', 'settings-btn', '测试连接');
			testBtn.type = 'button';
			testBtn.disabled = busy;
			testBtn.onclick = async () => {
				busy = true;
				setFeedback('正在测试远程存储连接…', false);
				render();
				try {
					const res = await syncEngine.testConnection(draftServerUrl, draftToken, 'token');
					setFeedback(`连接成功（SQLite Store: ${res.storeId.slice(0, 8)}）`, false);
				} catch (error) {
					setFeedback(error instanceof Error ? error.message : '连接失败', true);
				} finally {
					busy = false;
					render();
				}
			};

			const saveBtn = element('button', 'settings-btn primary', view.config.enabled && view.config.mode === 'remote' ? '保存并同步' : '连接远程存储');
			saveBtn.type = 'button';
			saveBtn.disabled = busy;
			saveBtn.onclick = async () => {
				busy = true;
				setFeedback('正在保存并同步…', false);
				render();
				try {
					await syncEngine.configure({ serverUrl: draftServerUrl, token: draftToken, enabled: true, mode: 'remote' });
					setFeedback('已连接自定义远程存储服务', false);
				} catch (error) {
					setFeedback(error instanceof Error ? error.message : '保存失败', true);
				} finally {
					busy = false;
					render();
				}
			};

			cfgActions.append(testBtn, saveBtn);
			if (view.config.enabled) {
				const disableBtn = element('button', 'settings-btn danger', '停用存储同步');
				disableBtn.type = 'button';
				disableBtn.disabled = busy;
				disableBtn.onclick = async () => {
					busy = true;
					try {
						await syncEngine.configure({ serverUrl: draftServerUrl, token: draftToken, enabled: false, mode: 'disabled' });
						setFeedback('已停用存储服务同步，当前仅使用浏览器缓存', false);
					} finally {
						busy = false;
						render();
					}
				};
				cfgActions.append(disableBtn);
			}
			modeCard.append(urlField, tokenField, cfgActions);
		}

		content.append(modeCard);
	}

	function renderBackupTab(): void {
		const view = latestSync;

		const sqliteCard = element('section', 'settings-card');
		sqliteCard.append(
			element('h3', '', 'SQLite 单文件数据库热备份'),
			element('p', 'settings-desc', '通过 VACUUM INTO 在线导出完整一致的 terminal.db 文件，可直接复制到另一台电脑或 Docker 的 deploy/terminal/data/terminal.db 无缝接管（保留全部周期、画线、墓碑与 Store ID）。'),
		);
		const sqliteActions = element('div', 'settings-actions');
		const sqliteBtn = element('button', 'settings-btn primary', '下载 SQLite 备份 (.db)');
		sqliteBtn.type = 'button';
		sqliteBtn.disabled = busy || !view.config.enabled;
		sqliteBtn.title = view.config.enabled ? '下载完整单文件 SQLite 热备份' : '请先在「存储服务」中启用本机存储或远程存储';
		sqliteBtn.onclick = async () => {
			busy = true;
			setFeedback('正在生成 SQLite 热备份…', false);
			render();
			try {
				const { blob, filename } = await syncEngine.downloadBackup();
				triggerDownload(blob, filename);
				setFeedback(`已下载 ${filename}`, false);
			} catch (error) {
				setFeedback(error instanceof Error ? error.message : '下载备份失败', true);
			} finally {
				busy = false;
				render();
			}
		};
		sqliteActions.append(sqliteBtn);
		if (!view.config.enabled) {
			sqliteActions.append(element('span', 'settings-field-hint', '启用本机或远程存储后可用'));
		}
		sqliteCard.append(sqliteActions);
		content.append(sqliteCard);

		const jsonCard = element('section', 'settings-card');
		jsonCard.append(
			element('h3', '', '便携 JSON 快照导出与导入（离线可用）'),
			element('p', 'settings-desc', '即使存储服务离线，也可随时导出或恢复包含全部交易对周期、画线（含删除墓碑）、自选、标签页、指标与常用周期的 JSON 文件。'),
		);

		const exportActions = element('div', 'settings-actions');
		const exportJsonBtn = element('button', 'settings-btn', '导出本机 JSON 快照');
		exportJsonBtn.type = 'button';
		exportJsonBtn.disabled = busy;
		exportJsonBtn.onclick = () => {
			const snapshot = syncEngine.exportPortableJson();
			const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
			const stamp = new Date().toISOString().slice(0, 10);
			triggerDownload(blob, `crypto-terminal-snapshot-${stamp}.json`);
			setFeedback('已导出完整本机 JSON 快照（含交易对周期、画线与指标设置）', false);
			render();
		};
		exportActions.append(exportJsonBtn);

		const importRow = element('div', 'settings-import-row');
		const modeSelect = element('select');
		modeSelect.setAttribute('aria-label', 'JSON 导入模式');
		const mergeOpt = document.createElement('option');
		mergeOpt.value = 'merge';
		mergeOpt.textContent = '合并导入（保留现有数据）';
		const replaceOpt = document.createElement('option');
		replaceOpt.value = 'replace';
		replaceOpt.textContent = '替换覆盖（以导入文件为准）';
		modeSelect.append(mergeOpt, replaceOpt);
		modeSelect.value = importMode;
		modeSelect.onchange = () => { importMode = modeSelect.value === 'replace' ? 'replace' : 'merge'; };

		const importBtn = element('button', 'settings-btn', '导入 JSON 快照…');
		importBtn.type = 'button';
		importBtn.disabled = busy;
		importBtn.onclick = () => fileInput.click();
		importRow.append(modeSelect, importBtn);

		jsonCard.append(exportActions, importRow);
		content.append(jsonCard);
	}

	function render(): void {
		if (!dialog.open) return;
		renderNav();
		content.replaceChildren();
		if (activeTab === 'data-source') renderDataSourceTab();
		else if (activeTab === 'storage') renderStorageTab();
		else renderBackupTab();

		if (feedbackText) {
			const fb = element('p', `settings-feedback${feedbackError ? ' error' : ''}`, feedbackText);
			fb.setAttribute('role', 'status');
			content.append(fb);
		}
	}

	const unsubscribe = syncEngine.subscribe(view => {
		latestSync = view;
		if (dialog.open) render();
	});

	return {
		open(tab: SettingsTab = 'data-source'): void {
			activeTab = tab;
			sourceDraftLoaded = false;
			storageDraftLoaded = false;
			feedbackText = '';
			feedbackError = false;
			if (!dialog.open) dialog.showModal();
			render();
		},
		close(): void {
			if (dialog.open) dialog.close();
		},
		destroy(): void {
			unsubscribe();
			dialog.remove();
		},
	};
}
