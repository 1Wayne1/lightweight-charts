import {
	CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, LineStyle, createChart,
	type IPaneApi, type ISeriesApi, type ISeriesPrimitive, type ISeriesPrimitiveAxisView, type SeriesAttachedParameter, type Time, type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle } from '@terminal/domain';
import {
	createMaRunner, getCatalogIndicator, histogramBarColor, type IndicatorRunner,
} from './data/indicator-catalog';
import {
	MAX_MA_LINES, activePaneOrder, indicatorColor, indicatorParams, indicatorPlotColors, isIndicatorVisible,
	type IndicatorSettings, type PaneId,
} from './data/indicators';

export type { IndicatorSettings };

export interface PaneBounds {
	top: number;
	height: number;
	visible: boolean;
}
export type PaneLayout = Record<PaneId, PaneBounds>;

export interface ChartLayout {
	panes: PaneLayout;
	rightScaleWidth: number;
	maximizedPane: PaneId | null;
}

interface HistogramHistory {
	prevCompleted: number | undefined;
	current: number | undefined;
}

interface MountedIndicator {
	signature: string;
	runner: IndicatorRunner;
	series: Map<string, ISeriesApi<'Line' | 'Histogram'>>;
	histogramState: Map<string, HistogramHistory>;
	pane?: IPaneApi<Time>;
}

const LINE_BASE = { lineWidth: 1 as const, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false };

function buildPlotSeries(
	pane: IPaneApi<Time>,
	runner: IndicatorRunner,
	isSubPane: boolean,
): Map<string, ISeriesApi<'Line' | 'Histogram'>> {
	const map = new Map<string, ISeriesApi<'Line' | 'Histogram'>>();
	let refAttached = false;
	for (const plot of runner.plots) {
		const autoscaleInfoProvider = isSubPane && runner.fixedRange
			? () => ({ priceRange: runner.fixedRange! })
			: undefined;
		if (plot.kind === 'histogram') {
			const s = pane.addSeries(HistogramSeries, {
				priceLineVisible: false,
				lastValueVisible: plot.lastValueVisible ?? isSubPane,
				autoscaleInfoProvider,
			});
			map.set(plot.key, s);
			if (!refAttached && runner.refLines?.length) {
				attachRefLines(s, runner.refLines);
				refAttached = true;
			}
		} else {
			const s = pane.addSeries(LineSeries, {
				lineWidth: plot.lineWidth ?? 1,
				lineStyle: (plot.lineStyle ?? LineStyle.Solid) as LineStyle,
				color: plot.color,
				lastValueVisible: plot.lastValueVisible ?? isSubPane,
				priceLineVisible: false,
				crosshairMarkerVisible: false,
				autoscaleInfoProvider,
			});
			map.set(plot.key, s);
			if (!refAttached && runner.refLines?.length) {
				attachRefLines(s, runner.refLines);
				refAttached = true;
			}
		}
	}
	return map;
}

function attachRefLines(
	series: ISeriesApi<'Line' | 'Histogram'>,
	lines: NonNullable<IndicatorRunner['refLines']>,
): void {
	for (const line of lines) {
		series.createPriceLine({
			price: line.price,
			color: line.color,
			lineWidth: 1,
			lineStyle: line.dashed ? LineStyle.Dashed : LineStyle.Dotted,
			axisLabelVisible: false,
			title: line.title ?? '',
		});
	}
}

export function createTerminalChart(
	container: HTMLElement,
	initialSettings: IndicatorSettings,
	onHover: (candle: Candle) => void,
	onPaneLayout: (layout: ChartLayout) => void,
) {
	let currentSettings: IndicatorSettings = structuredClone(initialSettings);
	const chart = createChart(container, {
		autoSize: true,
		layout: {
			background: { type: ColorType.Solid, color: '#0c0d10' }, textColor: '#92959e', fontSize: 11,
			fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', attributionLogo: true,
			panes: { separatorColor: '#292c34', separatorHoverColor: '#454958' },
		},
		grid: {
			vertLines: { color: '#24262d', style: LineStyle.Dotted },
			horzLines: { color: '#24262d', style: LineStyle.Dotted },
		},
		crosshair: {
			mode: CrosshairMode.Normal,
			vertLine: { color: '#777b87', labelBackgroundColor: '#363a45' },
			horzLine: { color: '#777b87', labelBackgroundColor: '#363a45' },
		},
		rightPriceScale: { borderColor: '#292c34', minimumWidth: 78, scaleMargins: { top: 0.19, bottom: 0.18 } },
		timeScale: { borderColor: '#292c34', timeVisible: true, secondsVisible: false, rightOffset: 8, barSpacing: 7 },
	});

	const pricePane = chart.panes()[0];
	pricePane.setStretchFactor(4);

	const candles = pricePane.addSeries(CandlestickSeries, {
		upColor: '#089981', downColor: '#f23645', borderVisible: false,
		wickUpColor: '#089981', wickDownColor: '#f23645',
	});
	const maSeries: ISeriesApi<'Line'>[] = Array.from({ length: MAX_MA_LINES }, () =>
		pricePane.addSeries(LineSeries, { ...LINE_BASE, visible: false })
	);
	const emaSeries: ISeriesApi<'Line'>[] = Array.from({ length: MAX_MA_LINES }, () =>
		pricePane.addSeries(LineSeries, { ...LINE_BASE, visible: false })
	);
	type MaRunner = { update(v: number, replace: boolean): number | null } | null;
	let maRunners: MaRunner[] = Array.from({ length: MAX_MA_LINES }, () => null);
	let emaRunners: MaRunner[] = Array.from({ length: MAX_MA_LINES }, () => null);

	const volume = pricePane.addSeries(HistogramSeries, {
		priceScaleId: 'volume', priceFormat: { type: 'volume' }, priceLineVisible: false,
		lastValueVisible: false, visible: currentSettings.volume,
	});
	volume.priceScale().applyOptions({ scaleMargins: { top: 0.83, bottom: 0 } });

	// Native right-axis badge for latest volume (volume itself uses an overlay scale so bars don't distort price).
	let volumeBadgeVisible = false;
	let volumeBadgeText = '';
	let volumeBadgeColor = '#089981';
	let volumeBadgeUpdate: (() => void) | undefined;
	const volumeAxisView: ISeriesPrimitiveAxisView = {
		coordinate: () => Math.max(14, pricePane.getHeight() - 12),
		text: () => volumeBadgeText,
		textColor: () => '#ffffff',
		backColor: () => volumeBadgeColor,
		visible: () => volumeBadgeVisible && volumeBadgeText.length > 0,
		tickVisible: () => false,
	};
	const volumeAxisPrimitive: ISeriesPrimitive<Time> = {
		attached(param: SeriesAttachedParameter<Time>) { volumeBadgeUpdate = param.requestUpdate; },
		detached() { volumeBadgeUpdate = undefined; },
		priceAxisViews: () => [volumeAxisView],
	};
	candles.attachPrimitive(volumeAxisPrimitive);
	const updateVolumeAxisLabel = (): void => {
		const last = data.at(-1);
		const visible = isIndicatorVisible(currentSettings, 'volume') && Boolean(last);
		volumeBadgeVisible = visible;
		if (visible && last) {
			volumeBadgeText = volume.priceFormatter().format(last.volume);
			volumeBadgeColor = last.close >= last.open ? '#089981' : '#f23645';
		} else {
			volumeBadgeText = '';
		}
		volumeBadgeUpdate?.();
	};

	const overlays = new Map<string, MountedIndicator>();
	const subPanes = new Map<string, MountedIndicator>();

	let data: Candle[] = [];
	let mobileLayout = false;
	let hoverTime: number | undefined;
	let currentMinMove = 0.01;
	let layoutFrame: number | undefined;
	let maximizedPane: PaneId | null = null;

	const reportLayout = (): void => {
		const stageRect = container.getBoundingClientRect();
		const layout: PaneLayout = {};
		const measure = (id: PaneId, pane: IPaneApi<Time>): void => {
			const visible = pane.visible();
			const height = pane.getHeight();
			const el = pane.getHTMLElement();
			const top = visible && el ? Math.max(0, Math.round(el.getBoundingClientRect().top - stageRect.top)) : 0;
			layout[id] = { top, height, visible };
		};
		measure('price', pricePane);
		for (const [id, entry] of subPanes) {
			if (entry.pane) measure(id, entry.pane);
		}
		let rightScaleWidth = 0;
		try {
			rightScaleWidth = Math.max(rightScaleWidth, pricePane.priceScale('right').width());
		} catch { /* ignore */ }
		for (const entry of subPanes.values()) {
			try {
				if (entry.pane) rightScaleWidth = Math.max(rightScaleWidth, entry.pane.priceScale('right').width());
			} catch { /* ignore */ }
		}
		onPaneLayout({
			panes: layout,
			rightScaleWidth: rightScaleWidth || (mobileLayout ? 64 : 78),
			maximizedPane,
		});
	};

	function applyMaximizedState(): void {
		if (maximizedPane !== null && maximizedPane !== 'price' && !subPanes.has(maximizedPane)) {
			maximizedPane = null;
		}
		const allPanes: [PaneId, IPaneApi<Time>][] = [['price', pricePane]];
		for (const [id, entry] of subPanes) {
			if (entry.pane) allPanes.push([id, entry.pane]);
		}
		if (allPanes.length <= 1) maximizedPane = null;

		if (maximizedPane === null) {
			for (const [, pane] of allPanes) pane.setVisible(true);
		} else {
			// Show the maximized target first so we never attempt to hide the last visible pane.
			const target = allPanes.find(([id]) => id === maximizedPane);
			target?.[1].setVisible(true);
			for (const [id, pane] of allPanes) {
				if (id !== maximizedPane) pane.setVisible(false);
			}
		}
	}

	const observer = new ResizeObserver(reportLayout);
	const observedElements = new WeakSet<HTMLElement>();
	observer.observe(container);
	const observePane = (pane: IPaneApi<Time>): void => {
		const el = pane.getHTMLElement();
		if (el && !observedElements.has(el)) {
			observedElements.add(el);
			observer.observe(el);
		}
	};
	observePane(pricePane);

	function applyPaneOrder(): void {
		const order = activePaneOrder(currentSettings);
		for (let target = 0; target < order.length; target++) {
			const id = order[target];
			const pane = id === 'price' ? pricePane : subPanes.get(id)?.pane;
			if (!pane || !pane.getHTMLElement()) return;
		}
		for (let target = 0; target < order.length; target++) {
			const id = order[target];
			const pane = id === 'price' ? pricePane : subPanes.get(id)?.pane;
			if (pane && pane.paneIndex() !== target) pane.moveTo(target);
		}
	}

	const scheduleLayout = (): void => {
		reportLayout();
		if (layoutFrame !== undefined) cancelAnimationFrame(layoutFrame);
		layoutFrame = requestAnimationFrame(() => {
			layoutFrame = undefined;
			observePane(pricePane);
			for (const entry of subPanes.values()) {
				if (entry.pane) observePane(entry.pane);
			}
			applyPaneOrder();
			reportLayout();
		});
	};

	function feedMounted(entry: MountedIndicator): void {
		const buffers = new Map<string, { time: UTCTimestamp; value: number; color?: string }[]>();
		entry.histogramState.clear();
		for (const plot of entry.runner.plots) {
			buffers.set(plot.key, []);
			if (plot.kind === 'histogram') {
				entry.histogramState.set(plot.key, { prevCompleted: undefined, current: undefined });
			}
		}
		for (const candle of data) {
			const values = entry.runner.update(candle, false);
			const time = candle.time as UTCTimestamp;
			for (const plot of entry.runner.plots) {
				const v = values[plot.key];
				if (v === null || v === undefined || !Number.isFinite(v)) continue;
				if (plot.kind === 'histogram') {
					const hist = entry.histogramState.get(plot.key)!;
					hist.prevCompleted = hist.current;
					hist.current = v;
					buffers.get(plot.key)!.push({ time, value: v, color: histogramBarColor(v, hist.prevCompleted, plot.histogramPalette) });
				} else {
					buffers.get(plot.key)!.push({ time, value: v });
				}
			}
		}
		for (const plot of entry.runner.plots) {
			const s = entry.series.get(plot.key);
			if (!s) continue;
			s.setData(buffers.get(plot.key)!);
		}
	}

	function updateMounted(entry: MountedIndicator, candle: Candle, replace: boolean): void {
		const values = entry.runner.update(candle, replace);
		const time = candle.time as UTCTimestamp;
		for (const plot of entry.runner.plots) {
			const v = values[plot.key];
			if (v === null || v === undefined || !Number.isFinite(v)) continue;
			const s = entry.series.get(plot.key);
			if (!s) continue;
			if (plot.kind === 'histogram') {
				let hist = entry.histogramState.get(plot.key);
				if (!hist) {
					hist = { prevCompleted: undefined, current: undefined };
					entry.histogramState.set(plot.key, hist);
				}
				if (!replace) hist.prevCompleted = hist.current;
				hist.current = v;
				(s as ISeriesApi<'Histogram'>).update({ time, value: v, color: histogramBarColor(v, hist.prevCompleted, plot.histogramPalette) });
			} else {
				(s as ISeriesApi<'Line'>).update({ time, value: v });
			}
		}
	}

	function applyPriceFormatToSubPanes(): void {
		const precision = Math.max(0, Math.min(10, Math.ceil(-Math.log10(currentMinMove))));
		const macdEntry = subPanes.get('macd');
		if (macdEntry) {
			for (const s of macdEntry.series.values()) {
				s.applyOptions({ priceFormat: { type: 'price', precision: Math.min(10, precision + 2), minMove: currentMinMove / 100 } });
			}
		}
	}

	function syncAverages(): void {
		maRunners = Array.from({ length: MAX_MA_LINES }, () => null);
		for (let i = 0; i < MAX_MA_LINES; i++) {
			const cfg = currentSettings.maLines[i];
			const visible = Boolean(cfg && currentSettings.maEnabled && cfg.visible);
			maSeries[i].applyOptions({ color: cfg?.color ?? '#f5c542', visible });
			if (cfg && data.length) {
				const runner = createMaRunner('ma', cfg.period);
				maRunners[i] = runner;
				const pts: { time: UTCTimestamp; value: number }[] = [];
				for (const c of data) {
					const v = runner.update(c.close, false);
					if (v !== null && Number.isFinite(v)) pts.push({ time: c.time as UTCTimestamp, value: v });
				}
				maSeries[i].setData(pts);
			} else {
				maSeries[i].setData([]);
			}
		}
		emaRunners = Array.from({ length: MAX_MA_LINES }, () => null);
		for (let i = 0; i < MAX_MA_LINES; i++) {
			const cfg = currentSettings.emaLines[i];
			const visible = Boolean(cfg && currentSettings.emaEnabled && cfg.visible);
			emaSeries[i].applyOptions({ color: cfg?.color ?? '#83bd8c', visible });
			if (cfg && data.length) {
				const runner = createMaRunner('ema', cfg.period);
				emaRunners[i] = runner;
				const pts: { time: UTCTimestamp; value: number }[] = [];
				for (const c of data) {
					const v = runner.update(c.close, false);
					if (v !== null && Number.isFinite(v)) pts.push({ time: c.time as UTCTimestamp, value: v });
				}
				emaSeries[i].setData(pts);
			} else {
				emaSeries[i].setData([]);
			}
		}
	}

	function rebuildRunnersForData(): void {
		for (const [id, entry] of overlays) {
			const def = getCatalogIndicator(id);
			if (!def?.createRunner) continue;
			entry.runner = def.createRunner(indicatorParams(currentSettings, id), indicatorColor(currentSettings, id), indicatorPlotColors(currentSettings, id));
			feedMounted(entry);
		}
		for (const [id, entry] of subPanes) {
			const def = getCatalogIndicator(id);
			if (!def?.createRunner) continue;
			entry.runner = def.createRunner(indicatorParams(currentSettings, id), indicatorColor(currentSettings, id), indicatorPlotColors(currentSettings, id));
			feedMounted(entry);
		}
	}

	function syncCatalogIndicators(): void {
		volume.applyOptions({ visible: currentSettings.volume });

		const wantedOverlays = new Set<string>();
		const wantedPanes = new Set<string>();
		for (const [id, flag] of Object.entries(currentSettings.enabled)) {
			if (!flag) continue;
			const def = getCatalogIndicator(id);
			if (!def || def.special || !def.createRunner) continue;
			if (def.placement === 'overlay') wantedOverlays.add(id);
			else wantedPanes.add(id);
		}

		// Remove disabled overlays
		for (const [id, entry] of overlays) {
			if (!wantedOverlays.has(id)) {
				for (const s of entry.series.values()) chart.removeSeries(s);
				overlays.delete(id);
			}
		}
		// Mount or reconfigure active overlays
		for (const id of wantedOverlays) {
			const def = getCatalogIndicator(id)!;
			const params = indicatorParams(currentSettings, id);
			const color = indicatorColor(currentSettings, id);
			const plotColors = indicatorPlotColors(currentSettings, id);
			const signature = JSON.stringify({ params, color, plotColors });
			const existing = overlays.get(id);
			if (existing && existing.signature === signature) continue;
			if (existing) {
				for (const s of existing.series.values()) chart.removeSeries(s);
			}
			const runner = def.createRunner!(params, color, plotColors);
			const series = buildPlotSeries(pricePane, runner, false);
			const entry: MountedIndicator = { signature, runner, series, histogramState: new Map() };
			overlays.set(id, entry);
			if (data.length) feedMounted(entry);
		}

		// Remove disabled sub-panes
		for (const [id, entry] of subPanes) {
			if (!wantedPanes.has(id)) {
				if (entry.pane) {
					entry.pane.setPreserveEmptyPane(false);
					chart.removePane(entry.pane.paneIndex());
				}
				subPanes.delete(id);
			}
		}
		// Mount or reconfigure active sub-panes in activePaneOrder so initial load needs no synchronous moveTo.
		const orderedSubPanes = activePaneOrder(currentSettings).filter(id => id !== 'price' && wantedPanes.has(id));
		for (const id of orderedSubPanes) {
			const def = getCatalogIndicator(id)!;
			const params = indicatorParams(currentSettings, id);
			const color = indicatorColor(currentSettings, id);
			const plotColors = indicatorPlotColors(currentSettings, id);
			const signature = JSON.stringify({ params, color, plotColors });
			const existing = subPanes.get(id);
			if (existing && existing.signature === signature) continue;
			const pane = existing?.pane ?? chart.addPane();
			pane.setPreserveEmptyPane(true);
			pane.setStretchFactor(1);
			if (existing) {
				for (const s of existing.series.values()) chart.removeSeries(s);
			}
			const runner = def.createRunner!(params, color, plotColors);
			const series = buildPlotSeries(pane, runner, true);
			pane.priceScale('right').applyOptions({ scaleMargins: { top: 0.14, bottom: 0.12 } });
			pane.setPreserveEmptyPane(false);
			observePane(pane);
			const entry: MountedIndicator = { signature, runner, series, histogramState: new Map(), pane };
			subPanes.set(id, entry);
			if (data.length) feedMounted(entry);
		}

		// Reorder existing panes when their widgets are mounted (otherwise deferred to scheduleLayout rAF).
		applyPaneOrder();
		applyMaximizedState();
		applyPriceFormatToSubPanes();
		scheduleLayout();
	}

	function syncIndicatorVisibility(): void {
		maSeries.forEach((series, i) => series.applyOptions({ visible: isIndicatorVisible(currentSettings, 'ma') && Boolean(currentSettings.maLines[i]?.visible) }));
		emaSeries.forEach((series, i) => series.applyOptions({ visible: isIndicatorVisible(currentSettings, 'ema') && Boolean(currentSettings.emaLines[i]?.visible) }));
		volume.applyOptions({ visible: isIndicatorVisible(currentSettings, 'volume') });
		updateVolumeAxisLabel();
		for (const [id, entry] of [...overlays, ...subPanes]) {
			for (const series of entry.series.values()) series.applyOptions({ visible: isIndicatorVisible(currentSettings, id) });
		}
	}

	syncCatalogIndicators();
	syncIndicatorVisibility();

	chart.subscribeCrosshairMove(event => {
		const hovered = event.seriesData.get(candles);
		if (hovered && 'open' in hovered && typeof hovered.time === 'number') {
			hoverTime = hovered.time;
			onHover({ time: hovered.time, open: hovered.open, high: hovered.high, low: hovered.low, close: hovered.close, volume: 0 });
		} else if (data.length > 0) {
			hoverTime = undefined;
			onHover(data[data.length - 1]);
		}
	});

	return {
		chart,
		series: candles,
		setMobileLayout(enabled: boolean) {
			if (mobileLayout === enabled) return;
			mobileLayout = enabled;
			chart.applyOptions({
				layout: { fontSize: enabled ? 12 : 11 },
				rightPriceScale: { minimumWidth: enabled ? 64 : 78, scaleMargins: { top: enabled ? 0.16 : 0.19, bottom: 0.18 } },
			});
			pricePane.setStretchFactor(enabled ? 3 : 4);
			scheduleLayout();
		},
		setMaximizedPane(id: PaneId | null) {
			if (maximizedPane === id) return;
			maximizedPane = id;
			applyMaximizedState();
			scheduleLayout();
		},
		getMaximizedPane(): PaneId | null {
			return maximizedPane;
		},
		setPriceFormat(minMove: number) {
			currentMinMove = minMove;
			const precision = Math.max(0, Math.min(10, Math.ceil(-Math.log10(minMove))));
			candles.applyOptions({ priceFormat: { type: 'price', precision, minMove } });
			applyPriceFormatToSubPanes();
		},
		setData(next: Candle[], initial = true) {
			const range = chart.timeScale().getVisibleLogicalRange();
			const firstTime = data[0]?.time;
			const added = firstTime === undefined ? 0 : Math.max(0, next.findIndex(c => c.time === firstTime));
			data = [...next];
			candles.setData(data.map(c => ({ ...c, time: c.time as UTCTimestamp })));
			volume.setData(data.map(c => ({ time: c.time as UTCTimestamp, value: c.volume, color: c.close >= c.open ? '#08998155' : '#f2364555' })));
			syncAverages();
			rebuildRunnersForData();
			syncIndicatorVisibility();
			if (initial) chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, data.length - (mobileLayout ? 80 : 170)), to: data.length + 8 });
			else if (range) chart.timeScale().setVisibleLogicalRange({ from: range.from + added, to: range.to + added });
			if (data.length) onHover(data[data.length - 1]);
			scheduleLayout();
		},
		update(candle: Candle) {
			const last = data.at(-1);
			if (!last || candle.time < last.time) return;
			const replace = candle.time === last.time;
			const index = replace ? data.length - 1 : data.length;
			data[index] = candle;
			const time = candle.time as UTCTimestamp;
			candles.update({ ...candle, time });
			volume.update({ time, value: candle.volume, color: candle.close >= candle.open ? '#08998155' : '#f2364555' });
			updateVolumeAxisLabel();
			for (let i = 0; i < currentSettings.maLines.length; i++) {
				const runner = maRunners[i];
				if (!runner) continue;
				const v = runner.update(candle.close, replace);
				if (v !== null && Number.isFinite(v)) maSeries[i].update({ time, value: v });
			}
			for (let i = 0; i < currentSettings.emaLines.length; i++) {
				const runner = emaRunners[i];
				if (!runner) continue;
				const v = runner.update(candle.close, replace);
				if (v !== null && Number.isFinite(v)) emaSeries[i].update({ time, value: v });
			}
			for (const entry of overlays.values()) updateMounted(entry, candle, replace);
			for (const entry of subPanes.values()) updateMounted(entry, candle, replace);
			if (hoverTime === undefined || hoverTime === candle.time) onHover(candle);
		},
		setIndicators(next: IndicatorSettings) {
			const prev = currentSettings;
			currentSettings = structuredClone(next);
			if (JSON.stringify(prev.maLines) !== JSON.stringify(currentSettings.maLines) ||
				prev.maEnabled !== currentSettings.maEnabled ||
				JSON.stringify(prev.emaLines) !== JSON.stringify(currentSettings.emaLines) ||
				prev.emaEnabled !== currentSettings.emaEnabled) {
				syncAverages();
			}
			syncCatalogIndicators();
			syncIndicatorVisibility();
		},
		indicatorValues(): Record<string, { label: string; text: string; color: string }[]> {
			const result: Record<string, { label: string; text: string; color: string }[]> = {};
			const time = hoverTime ?? data.at(-1)?.time;
			const x = time === undefined ? null : chart.timeScale().timeToCoordinate(time as UTCTimestamp);
			const index = x === null ? null : chart.timeScale().coordinateToLogical(x);
			const value = (series: ISeriesApi<'Line' | 'Histogram'>, label: string, color: string) => {
				const point = index === null ? null : series.dataByIndex(Math.round(index));
				return { label, text: point && 'value' in point && typeof point.value === 'number' ? series.priceFormatter().format(point.value) : '—', color: point && 'color' in point && typeof point.color === 'string' ? point.color : color };
			};
			result.ma = currentSettings.maLines.flatMap((line, i) => line.visible ? [value(maSeries[i], `MA ${line.period}`, line.color)] : []);
			result.ema = currentSettings.emaLines.flatMap((line, i) => line.visible ? [value(emaSeries[i], `EMA ${line.period}`, line.color)] : []);
			const volumeValue = value(volume, '成交量', '#92959e');
			volumeValue.color = volumeValue.color.slice(0, 7);
			result.volume = [volumeValue];
			for (const [id, entry] of [...overlays, ...subPanes]) {
				result[id] = entry.runner.plots.map(plot => value(entry.series.get(plot.key)!, plot.label, plot.color));
			}
			return result;
		},
		destroy() {
			if (layoutFrame !== undefined) cancelAnimationFrame(layoutFrame);
			candles.detachPrimitive(volumeAxisPrimitive);
			observer.disconnect();
			chart.remove();
		},
	};
}

export type TerminalChart = ReturnType<typeof createTerminalChart>;
