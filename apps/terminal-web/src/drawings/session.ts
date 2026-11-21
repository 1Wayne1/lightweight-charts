import { DrawingManager, type AnchorPoint, type DrawingBar } from '@tradingview/lwc-plugin-drawing-tools';
import type { Candle } from '@terminal/domain';
import type { TerminalChart } from '../chart';
import { DrawingTimeScale } from './coordinates';
import { DrawingRepository, reconcileDrawings, restoreDrawings, type DrawingStore } from './storage';

// Keep unsaved edits available when storage fails and the user changes instruments.
const recovery = new Map<string, DrawingStore>();
export function createDrawingSession(chart: TerminalChart, key: string, interval: number, onStatus: (message: string, error: boolean) => void, onReady?: () => void) {
	let scale: DrawingTimeScale | undefined;
	let rows: DrawingBar[] = [];
	let store: DrawingStore = { schemaVersion: 1, instrumentKey: key, documents: [] };
	let repository: DrawingRepository | undefined;
	let loaded = false; let pending = false; let loading = false; let timer: ReturnType<typeof setTimeout> | undefined;
	let loadError = '';
	try { repository = new DrawingRepository(localStorage, key); store = repository.load(); }
	catch (error) { loadError = error instanceof Error ? error.message : '无法读取本机存储'; }
	if (recovery.has(key)) store = recovery.get(key)!;
	const report = (message: string, error = false): void => onStatus(message, error);
	const manager = new DrawingManager(chart.chart, chart.series, {
		normalizeAnchor: point => scale?.canonical(point) ?? point,
		dataSource: () => rows,
	});
	const save = (): void => {
		clearTimeout(timer); timer = undefined;
		if (!pending) return;
		try {
			if (!repository || loadError) throw new Error(loadError || '本机存储不可用');
			repository.save(store); pending = false; recovery.delete(key); report('画线已自动保存到本机');
		} catch (error) { recovery.set(key, store); report(`画线未保存：${error instanceof Error ? error.message : '存储失败'}`, true); }
	};
	const unsubscribe = manager.subscribeStateChange(() => {
		if (!loaded || loading || !scale) return;
		const next = reconcileDrawings(store, manager.exportState().drawings, scale);
		if (JSON.stringify(next) === JSON.stringify(store)) return;
		store = next; pending = true; recovery.set(key, store); report('正在保存画线…');
		clearTimeout(timer); timer = setTimeout(save, 300);
	});
	const reproject = (point: AnchorPoint): AnchorPoint => typeof point.time === 'number' && scale ? scale.project({ time: point.time, price: point.price }) : point;
	return {
		manager,
		projectAnchors(anchors: readonly { time: number; price: number }[]): AnchorPoint[] {
			const currentScale = scale;
			if (!currentScale) throw new Error('行情尚未就绪');
			return anchors.map(anchor => currentScale.project(anchor));
		},
		beforeDataChange() { manager.prepareDataChange(); },
		setData(candles: readonly Candle[]) {
			if (!candles.length) return;
			rows = candles.map((bar, logical) => ({ ...bar, logical }));
			scale = new DrawingTimeScale(candles.map(c => c.time), interval);
			if (!loaded) {
				loading = true; manager.importState(restoreDrawings(store, scale), false); loading = false; loaded = true;
				onReady?.();
				const activeCount = store.documents.filter(d => !d.deleted).length;
				if (loadError) report(`画线读取失败，原数据已保留：${loadError}`, true);
				else if (recovery.has(key)) { pending = true; save(); }
				else report(activeCount > 0 ? '画线自动保存 · 本机' : '');
			} else manager.reprojectAnchors(reproject);
		},
		update(candle: Candle) {
			const last = rows.at(-1); if (!last || candle.time < last.time) return;
			const appended = candle.time !== last.time;
			const index = appended ? rows.length : rows.length - 1;
			rows[index] = { ...candle, logical: index };
			if (appended) { scale = new DrawingTimeScale(rows.map(c => c.time), interval); manager.reprojectAnchors(reproject); }
			else manager.refreshData();
		},
		exportStore() { manager.prepareDataChange(); return structuredClone(store); },
		flush: save,
		destroy() { manager.prepareDataChange(); save(); unsubscribe(); manager.destroy(); },
	};
}
export type DrawingSession = ReturnType<typeof createDrawingSession>;
