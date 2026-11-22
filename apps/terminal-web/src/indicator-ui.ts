import {
	INDICATOR_CATALOG, INDICATOR_CATEGORIES, defaultParamsFor, getCatalogIndicator,
	type CatalogIndicator,
} from './data/indicator-catalog';
import {
	MAX_MA_LINES, activePaneOrder, indicatorColor, indicatorParams, indicatorPlotColors, isIndicatorEnabled,
	movePaneOrder, nextLinePreset, setIndicatorEnabled,
	type IndicatorSettings, type MovingAverageLineConfig,
} from './data/indicators';
import { renderTradingViewColorPicker } from './drawings/color-picker';
import { element, icon } from './ui';

export type IndicatorTab = 'popular' | 'all' | 'active';

let activeColorPopup: HTMLDivElement | undefined;
let activeColorTrigger: HTMLButtonElement | undefined;
let activeColorCleanup: (() => void) | undefined;

export function closeIndicatorColorPopover(restoreFocus = false): void {
	const trigger = activeColorTrigger;
	activeColorCleanup?.();
	activeColorCleanup = undefined;
	activeColorPopup?.remove();
	activeColorPopup = undefined;
	activeColorTrigger = undefined;
	trigger?.setAttribute('aria-expanded', 'false');
	if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
}

function clampNumber(value: string, min: number, max: number, integer: boolean, fallback: number): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return fallback;
	const clamped = Math.max(min, Math.min(max, parsed));
	return integer ? Math.round(clamped) : Math.round(clamped * 1000) / 1000;
}

export interface IndicatorExplorerOptions {
	initialTab?: IndicatorTab;
	initialFocusId?: string;
}

/** TradingView-style indicator browser + inline parameter configurator + pane ordering. */
export function renderIndicatorPanel(
	container: HTMLElement,
	settings: IndicatorSettings,
	onChange: () => void,
	options: IndicatorExplorerOptions = {},
): void {
	let tab: IndicatorTab = options.initialTab ?? 'popular';
	let query = '';
	let configId: string | null = options.initialFocusId ?? null;

	const countEnabled = (): number =>
		INDICATOR_CATALOG.filter(item => isIndicatorEnabled(settings, item.id)).length;

	const root = element('div', 'tv-ind-explorer');
	const searchBar = element('div', 'tv-ind-search');
	const searchInput = element('input');
	searchInput.type = 'search';
	searchInput.placeholder = '搜索指标（如 MA、EMA、BOLL、RSI、KDJ、ATR…）';
	searchInput.setAttribute('aria-label', '搜索技术指标');
	searchBar.append(icon('search'), searchInput);

	const body = element('div', 'tv-ind-body');
	const sidebar = element('nav', 'tv-ind-sidebar');
	sidebar.setAttribute('aria-label', '指标分类');
	const content = element('div', 'tv-ind-content');
	body.append(sidebar, content);
	root.append(searchBar, body);
	container.replaceChildren(root);

	const notify = (): void => {
		onChange();
		renderSidebar();
		renderContent();
	};

	function createColorButton(label: string, getCurrent: () => string, onPick: (nextColor: string) => void): HTMLButtonElement {
		const btn = element('button', 'ind-color-btn');
		btn.type = 'button';
		btn.setAttribute('aria-label', label);
		btn.setAttribute('aria-haspopup', 'dialog');
		btn.setAttribute('aria-expanded', 'false');
		const swatch = element('span', 'ind-color-swatch');
		swatch.style.backgroundColor = getCurrent();
		btn.append(swatch);

		const placePopover = (popup: HTMLDivElement): void => {
			const rect = btn.getBoundingClientRect();
			const bounds = popup.getBoundingClientRect();
			const left = Math.max(8, Math.min(rect.left, window.innerWidth - bounds.width - 8));
			const fitsBelow = rect.bottom + 6 + bounds.height <= window.innerHeight - 8;
			const top = fitsBelow
				? rect.bottom + 6
				: Math.max(8, rect.top - bounds.height - 6);
			popup.style.left = `${left}px`;
			popup.style.top = `${top}px`;
		};

		btn.onclick = event => {
			event.stopPropagation();
			if (activeColorTrigger === btn && activeColorPopup) {
				closeIndicatorColorPopover(true);
				return;
			}
			closeIndicatorColorPopover();
			activeColorTrigger = btn;
			btn.setAttribute('aria-expanded', 'true');
			const popup = element('div', 'drawing-property-popover tv-color-popover ind-color-popover');
			popup.setAttribute('role', 'dialog');
			popup.setAttribute('aria-label', label);
			popup.tabIndex = -1;
			const pickerHost = element('div', 'tv-color-picker-host');
			popup.append(pickerHost);

			const mountRoot = container.closest('dialog[open]') ?? container.closest('#app') ?? document.body;
			mountRoot.append(popup);
			activeColorPopup = popup;

			renderTradingViewColorPicker({
				container: pickerHost,
				label,
				current: getCurrent(),
				onSelect: nextColor => {
					swatch.style.backgroundColor = nextColor;
					onPick(nextColor);
				},
				onResize: () => placePopover(popup),
			});
			placePopover(popup);

			const onPointerDown = (ev: PointerEvent): void => {
				if (ev.target instanceof Node && !popup.contains(ev.target) && !btn.contains(ev.target)) {
					closeIndicatorColorPopover();
				}
			};
			const onKeyDown = (ev: KeyboardEvent): void => {
				if (ev.key === 'Escape') {
					ev.preventDefault();
					ev.stopImmediatePropagation();
					closeIndicatorColorPopover(true);
				}
			};
			const onResize = (): void => { placePopover(popup); };
			document.addEventListener('pointerdown', onPointerDown, true);
			window.addEventListener('keydown', onKeyDown, true);
			window.addEventListener('resize', onResize);
			activeColorCleanup = () => {
				document.removeEventListener('pointerdown', onPointerDown, true);
				window.removeEventListener('keydown', onKeyDown, true);
				window.removeEventListener('resize', onResize);
			};
		};
		return btn;
	}

	searchInput.oninput = () => {
		query = searchInput.value.trim().toLowerCase();
		configId = null;
		renderContent();
	};

	function renderSidebar(): void {
		sidebar.replaceChildren();
		const activeCount = countEnabled();
		const popularCount = INDICATOR_CATALOG.filter(i => i.popular).length;
		const items: [IndicatorTab, string, number][] = [
			['popular', '常用指标', popularCount],
			['all', '全部指标', INDICATOR_CATALOG.length],
			['active', '已添加', activeCount],
		];
		for (const [id, label, count] of items) {
			const btn = element('button', 'tv-ind-tab');
			btn.type = 'button';
			btn.dataset.tab = id;
			btn.setAttribute('aria-pressed', String(tab === id && !configId));
			btn.append(element('span', '', label), element('small', 'tv-ind-badge', String(count)));
			btn.onclick = () => {
				tab = id;
				configId = null;
				renderSidebar();
				renderContent();
			};
			sidebar.append(btn);
		}
	}

	function renderRow(item: CatalogIndicator): HTMLElement {
		const enabled = isIndicatorEnabled(settings, item.id);
		const row = element('div', `tv-ind-row${enabled ? ' active' : ''}`);
		row.dataset.indicator = item.id;

		const main = element('button', 'tv-ind-row-main');
		main.type = 'button';
		main.setAttribute('aria-pressed', String(enabled));
		main.setAttribute('aria-label', `${enabled ? '隐藏' : '添加'} ${item.shortName} ${item.name}`);
		const titleLine = element('div', 'tv-ind-row-title');
		titleLine.append(
			element('strong', '', item.name),
			element('span', 'tv-ind-short', item.shortName),
			element('span', `tv-ind-place ${item.placement}`, item.placement === 'overlay' ? '主图' : '副图'),
		);
		main.append(titleLine, element('small', 'tv-ind-desc', item.description));
		main.onclick = () => {
			setIndicatorEnabled(settings, item.id, !enabled);
			notify();
		};

		const actions = element('div', 'tv-ind-row-actions');
		const configurable = item.special === 'ma' || item.special === 'ema' || item.params.length > 0 || Boolean(item.defaultColor);
		if (configurable) {
			const cfgBtn = element('button', 'tv-ind-icon-btn', '⚙');
			cfgBtn.type = 'button';
			cfgBtn.title = `设置 ${item.shortName} 参数`;
			cfgBtn.setAttribute('aria-label', `设置 ${item.shortName} 参数`);
			cfgBtn.onclick = () => {
				configId = item.id;
				renderSidebar();
				renderContent();
			};
			actions.append(cfgBtn);
		}
		const toggleBtn = element('button', `tv-ind-toggle-btn${enabled ? ' on' : ''}`, enabled ? '已添加' : '+ 添加');
		toggleBtn.type = 'button';
		toggleBtn.setAttribute('aria-label', `${enabled ? '移除' : '添加'} ${item.shortName}`);
		toggleBtn.onclick = () => {
			setIndicatorEnabled(settings, item.id, !enabled);
			notify();
		};
		actions.append(toggleBtn);

		row.append(main, actions);
		return row;
	}

	function renderMovingAverageEditor(kind: 'ma' | 'ema', item: CatalogIndicator): void {
		const enabled = kind === 'ma' ? settings.maEnabled : settings.emaEnabled;
		const lines: MovingAverageLineConfig[] = kind === 'ma' ? settings.maLines : settings.emaLines;
		const setEnabled = (v: boolean): void => {
			setIndicatorEnabled(settings, kind, v);
		};

		const header = element('div', 'ind-section-header');
		const toggle = element('label', 'ind-toggle');
		const checkbox = element('input');
		checkbox.type = 'checkbox';
		checkbox.checked = enabled;
		checkbox.setAttribute('aria-label', `启用 ${item.shortName}`);
		checkbox.onchange = () => { setEnabled(checkbox.checked); notify(); };
		const copy = element('span');
		copy.append(element('strong', '', `${item.shortName} ${item.name}`), element('small', '', `最多支持 ${MAX_MA_LINES} 条自定义均线`));
		toggle.append(checkbox, copy);

		const actions = element('div', 'ind-section-actions');
		actions.append(element('span', 'ind-count', `${lines.length}/${MAX_MA_LINES}`));
		const addBtn = element('button', 'ind-mini-btn', '+ 添加均线');
		addBtn.type = 'button';
		addBtn.disabled = lines.length >= MAX_MA_LINES;
		addBtn.setAttribute('aria-label', `添加 ${item.shortName} 均线`);
		addBtn.onclick = () => {
			const preset = nextLinePreset(kind, lines);
			if (!preset) return;
			lines.push(preset);
			setEnabled(true);
			notify();
		};
		actions.append(addBtn);
		header.append(toggle, actions);

		const list = element('div', 'ind-line-list');
		lines.forEach((line, index) => {
			const row = element('div', `ind-line-row${enabled ? '' : ' muted'}`);
			const vis = element('input');
			vis.type = 'checkbox';
			vis.checked = line.visible;
			vis.setAttribute('aria-label', `显示 ${kind.toUpperCase()} ${index + 1}`);
			vis.onchange = () => { line.visible = vis.checked; onChange(); };

			const color = createColorButton(
				`${kind.toUpperCase()} ${index + 1} 颜色`,
				() => line.color,
				nextColor => {
					if (line.color === nextColor) return;
					line.color = nextColor;
					onChange();
				},
			);

			const periodWrap = element('label', 'ind-period-field');
			periodWrap.append(element('span', '', kind.toUpperCase()));
			const period = element('input');
			period.type = 'number';
			period.min = '1';
			period.max = '500';
			period.step = '1';
			period.value = String(line.period);
			period.setAttribute('aria-label', `${kind.toUpperCase()} ${index + 1} 周期`);
			period.onchange = () => {
				line.period = clampNumber(period.value, 1, 500, true, line.period);
				period.value = String(line.period);
				onChange();
			};
			periodWrap.append(period);

			const remove = element('button', 'ind-remove-btn', '×');
			remove.type = 'button';
			remove.disabled = lines.length <= 1;
			remove.setAttribute('aria-label', `删除 ${kind.toUpperCase()} ${index + 1}`);
			remove.onclick = () => {
				if (lines.length <= 1) return;
				lines.splice(index, 1);
				notify();
			};
			row.append(vis, color, periodWrap, remove);
			list.append(row);
		});
		content.append(header, list);
	}

	function renderGenericEditor(item: CatalogIndicator): void {
		const enabled = isIndicatorEnabled(settings, item.id);
		const header = element('div', 'ind-section-header');
		const toggle = element('label', 'ind-toggle');
		const checkbox = element('input');
		checkbox.type = 'checkbox';
		checkbox.checked = enabled;
		checkbox.setAttribute('aria-label', `启用 ${item.shortName}`);
		checkbox.onchange = () => { setIndicatorEnabled(settings, item.id, checkbox.checked); notify(); };
		const copy = element('span');
		copy.append(element('strong', '', `${item.shortName} · ${item.name}`), element('small', '', item.description));
		toggle.append(checkbox, copy);

		const reset = element('button', 'ind-mini-btn', '恢复默认');
		reset.type = 'button';
		reset.onclick = () => {
			delete settings.params[item.id];
			delete settings.colors[item.id];
			delete settings.plotColors[item.id];
			notify();
		};
		header.append(toggle, reset);
		content.append(header);

		const form = element('div', 'ind-line-list');
		if (item.colorSpecs?.length) {
			const resolved = indicatorPlotColors(settings, item.id);
			const grid = element('div', 'ind-color-grid');
			for (const spec of item.colorSpecs) {
				const colorRow = element('div', 'ind-line-row');
				const color = createColorButton(
					`${item.shortName} ${spec.label}`,
					() => settings.plotColors[item.id]?.[spec.key] ?? resolved[spec.key] ?? spec.defaultColor,
					nextColor => {
						const existing = settings.plotColors[item.id]?.[spec.key];
						if (existing === nextColor) return;
						settings.plotColors[item.id] = { ...(settings.plotColors[item.id] ?? {}), [spec.key]: nextColor };
						if (spec.key === item.id) settings.colors[item.id] = nextColor;
						onChange();
					},
				);
				colorRow.append(color, element('span', 'ind-period-field', spec.label));
				grid.append(colorRow);
			}
			form.append(grid);
		} else if (item.defaultColor) {
			const colorRow = element('div', 'ind-line-row');
			const color = createColorButton(
				`${item.shortName} 颜色`,
				() => indicatorColor(settings, item.id),
				nextColor => {
					if (settings.colors[item.id] === nextColor) return;
					settings.colors[item.id] = nextColor;
					onChange();
				},
			);
			colorRow.append(color, element('span', 'ind-period-field', '主线条颜色'));
			form.append(colorRow);
		}

		const current = indicatorParams(settings, item.id);
		for (const spec of item.params) {
			const row = element('div', 'ind-line-row');
			const wrap = element('label', 'ind-period-field');
			wrap.append(element('span', '', spec.label));
			const input = element('input');
			input.type = 'number';
			input.min = String(spec.min);
			input.max = String(spec.max);
			input.step = String(spec.step);
			input.value = String(current[spec.key] ?? spec.defaultValue);
			input.setAttribute('aria-label', `${item.shortName} ${spec.label}`);
			input.onchange = () => {
				const nextVal = clampNumber(input.value, spec.min, spec.max, Boolean(spec.integer), current[spec.key] ?? spec.defaultValue);
				input.value = String(nextVal);
				settings.params[item.id] = { ...defaultParamsFor(item), ...(settings.params[item.id] ?? {}), [spec.key]: nextVal };
				onChange();
			};
			wrap.append(input);
			row.append(wrap);
			form.append(row);
		}
		content.append(form);
	}

	function renderPaneOrderSection(): void {
		const order = activePaneOrder(settings);
		const section = element('section', 'ind-section tv-ind-panes');
		section.append(element('h4', 'ind-subheading', '图表面板上下位置'));
		const list = element('div', 'ind-pane-list');
		order.forEach((paneId, index) => {
			const title = paneId === 'price' ? 'K 线主图' : `${getCatalogIndicator(paneId)?.shortName ?? paneId} · ${getCatalogIndicator(paneId)?.name ?? ''}`;
			const row = element('div', 'ind-pane-row');
			const name = element('span', 'ind-pane-name');
			name.append(element('strong', '', title));
			const controls = element('div', 'ind-pane-actions');
			const up = element('button', 'ind-mini-btn', '↑ 上移');
			up.type = 'button';
			up.disabled = index === 0;
			up.setAttribute('aria-label', `上移 ${title}`);
			up.onclick = () => {
				settings.paneOrder = movePaneOrder(order, paneId, -1);
				notify();
			};
			const down = element('button', 'ind-mini-btn', '↓ 下移');
			down.type = 'button';
			down.disabled = index === order.length - 1;
			down.setAttribute('aria-label', `下移 ${title}`);
			down.onclick = () => {
				settings.paneOrder = movePaneOrder(order, paneId, 1);
				notify();
			};
			controls.append(up, down);
			row.append(name, controls);
			list.append(row);
		});
		section.append(list);
		content.append(section);
	}

	function renderContent(): void {
		closeIndicatorColorPopover();
		content.replaceChildren();
		content.scrollTop = 0;

		if (configId) {
			const item = getCatalogIndicator(configId);
			if (item) {
				const backBar = element('div', 'tv-ind-backbar');
				const back = element('button', 'ind-mini-btn', '← 返回指标列表');
				back.type = 'button';
				back.onclick = () => { configId = null; renderSidebar(); renderContent(); };
				backBar.append(back);
				content.append(backBar);
				if (item.special === 'ma' || item.special === 'ema') renderMovingAverageEditor(item.special, item);
				else renderGenericEditor(item);
				return;
			}
			configId = null;
		}

		if (query) {
			const matches = INDICATOR_CATALOG.filter(item =>
				`${item.shortName} ${item.name} ${item.description} ${item.category}`.toLowerCase().includes(query)
			);
			if (!matches.length) {
				content.append(element('p', 'tv-ind-empty', '没有找到匹配的指标'));
				return;
			}
			const heading = element('div', 'tv-ind-group-title', `搜索结果 (${matches.length})`);
			content.append(heading);
			for (const item of matches) content.append(renderRow(item));
			return;
		}

		if (tab === 'popular') {
			const popular = INDICATOR_CATALOG.filter(item => item.popular);
			content.append(element('div', 'tv-ind-group-title', '常用指标 · trading-signals'));
			for (const item of popular) content.append(renderRow(item));
			return;
		}

		if (tab === 'all') {
			for (const category of INDICATOR_CATEGORIES) {
				const items = INDICATOR_CATALOG.filter(item => item.category === category);
				if (!items.length) continue;
				content.append(element('div', 'tv-ind-group-title', `${category} (${items.length})`));
				for (const item of items) content.append(renderRow(item));
			}
			return;
		}

		// 'active' tab
		const activeItems = INDICATOR_CATALOG.filter(item => isIndicatorEnabled(settings, item.id));
		content.append(element('div', 'tv-ind-group-title', `当前图表已添加 (${activeItems.length})`));
		if (!activeItems.length) {
			content.append(element('p', 'tv-ind-empty', '尚未添加指标，可从「常用指标」或「全部指标」启用'));
		} else {
			for (const item of activeItems) content.append(renderRow(item));
		}
		renderPaneOrderSection();
	}

	renderSidebar();
	renderContent();
}
