import assert from 'node:assert/strict';
import test from 'node:test';
import { DrawingTimeScale } from '../src/drawings/coordinates.ts';
import { DrawingRepository, drawingStorageKey, parseDrawingStore, reconcileDrawings, restoreDrawings } from '../src/drawings/storage.ts';
import { DrawingHistory, TOOL_DEFINITIONS, BASE_DRAWING_OPTIONS } from '@tradingview/lwc-plugin-drawing-tools';
const key = 'binance:spot:BTC-USDT';
const empty = () => ({ schemaVersion: 1, instrumentKey: key, documents: [] });
const scale = new DrawingTimeScale([1000, 1060, 1120, 1180], 60);
const line = () => ({ id: 'line-1', type: 'trend-line', points: [scale.canonical({ logical: 1.5, price: 100 }), scale.canonical({ logical: 8.25, price: 120 })], options: { color: '#2962ff', lineWidth: 2, extendRight: true } });

test('fractional, missing-bar, future and past times round trip through canonical coordinates', () => {
	const gapped = new DrawingTimeScale([1000, 1060, 1180], 60);
	for (const logical of [-5.25, 0, 0.2, 1, 1.5, 2, 5.9]) assert.ok(Math.abs(gapped.toLogical(gapped.toTime(logical)) - logical) < 1e-10);
	assert.equal(gapped.toTime(1.5), 1120);
});
test('timeframe switch and history prepend preserve exact time and price, including whitespace', () => {
	const store = reconcileDrawings(empty(), [line()], scale);
	const coarse = new DrawingTimeScale([880, 1180, 1480], 300);
	const restored = restoreDrawings(store, coarse);
	assert.equal(restored[0].points[0].time, 1090);
	assert.equal(restored[0].points[1].time, 1495);
	assert.deepEqual(reconcileDrawings(store, restored, coarse), store);
	const prepended = new DrawingTimeScale([880, 940, ...scale.times], 60);
	assert.equal(restoreDrawings(store, prepended)[0].points[1].logical, 10.25);
});
test('every tool round trips all styles without pixels or logical indices in storage', () => {
	for (const def of TOOL_DEFINITIONS) {
		const drawing = { id: def.type, type: def.type, points: Array.from({ length: def.pointCount || 8 }, (_, i) => scale.canonical({ logical: i * 0.75, price: 100 + i })), options: { ...BASE_DRAWING_OPTIONS, ...def.defaultOptions } };
		const stored = reconcileDrawings(empty(), [drawing], scale);
		const parsed = parseDrawingStore(JSON.parse(JSON.stringify(stored)), key);
		assert.deepEqual(restoreDrawings(parsed, scale), [drawing]);
		assert.ok(!JSON.stringify(stored).includes('logical'));
	}
});
test('deletion tombstones and undo/redo keep identity, style and server revision', () => {
	const history = new DrawingHistory(); const original = line();
	let store = reconcileDrawings(empty(), [original], scale); store.documents[0].revision = 7;
	history.push([original]); store = reconcileDrawings(store, [], scale);
	assert.equal(store.documents[0].deleted, true);
	const restored = history.undo([]); store = reconcileDrawings(store, restored, scale);
	assert.equal(store.documents[0].deleted, false); assert.equal(store.documents[0].revision, 7);
	assert.deepEqual(store.documents[0].style, original.options);
	store = reconcileDrawings(store, history.redo(restored), scale); assert.equal(store.documents[0].deleted, true);
});
test('history reprojects deleted objects too, so undo after prepend cannot drift', () => {
	const history = new DrawingHistory(); history.push([line()]);
	const prepended = new DrawingTimeScale([880, 940, ...scale.times], 60);
	history.mapPoints(point => prepended.project(point));
	const restored = history.undo([]); assert.equal(restored[0].points[1].logical, 10.25); assert.equal(restored[0].points[1].time, 1495);
});
function memory() { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k, value) => map.set(k, value), map }; }
test('repository isolates spot/perpetual and reloads independent records', () => {
	const storage = memory(); const spot = new DrawingRepository(storage, key); spot.load();
	spot.save(reconcileDrawings(empty(), [line()], scale));
	const perpetual = new DrawingRepository(storage, key.replace(':spot:', ':perpetual:'));
	assert.equal(perpetual.load().documents.length, 0);
	assert.equal(new DrawingRepository(storage, key).load().documents.length, 1);
});
test('corrupt/unsupported storage is preserved and writes are blocked', () => {
	for (const raw of ['{oops', JSON.stringify({ ...empty(), schemaVersion: 2 }), JSON.stringify({ ...empty(), documents: [{ kind: 'unknown' }] })]) {
		const storage = memory(); storage.setItem(drawingStorageKey(key), raw);
		const repo = new DrawingRepository(storage, key); assert.throws(() => repo.load()); assert.throws(() => repo.save(empty()));
		assert.equal(storage.getItem(drawingStorageKey(key)), raw);
	}
});
test('repository detects a second window rather than overwriting and reports quota failure', () => {
	const storage = memory(); const first = new DrawingRepository(storage, key); const second = new DrawingRepository(storage, key); first.load(); second.load();
	first.save(reconcileDrawings(empty(), [line()], scale)); assert.throws(() => second.save(empty()), /另一窗口/);
	const failing = new DrawingRepository({ getItem: () => null, setItem: () => { throw new Error('quota'); } }, key); failing.load(); assert.throws(() => failing.save(empty()), /quota/);
});
test('validation rejects invalid anchors, unknown tools/options, duplicate IDs and malformed styles', () => {
	const valid = reconcileDrawings(empty(), [line()], scale);
	const mutate = change => { const value = structuredClone(valid); change(value); assert.throws(() => parseDrawingStore(value, key)); };
	mutate(v => v.documents[0].anchors[0].time = Infinity);
	mutate(v => v.documents[0].kind = 'not-a-tool');
	mutate(v => v.documents[0].style.extra = 1);
	mutate(v => v.documents[0].style.fillOpacity = 3);
	mutate(v => v.documents[0].style.lineStyle = 1.5);
	mutate(v => v.documents[0].style.color = 'javascript:bad');
	mutate(v => v.documents[0].style.fibLevels = [{ value: NaN }]);
	mutate(v => v.documents.push(v.documents[0]));
	mutate(v => v.instrumentKey = 'binance:perpetual:BTC-USDT');
});

test('manager commits on release, cancels touch gestures, supports freehand, and restores chart controls', async () => {
	const { DrawingManager } = await import('@tradingview/lwc-plugin-drawing-tools');
	class Node extends EventTarget {
		style = {}; children = []; tagName = 'DIV'; captured = new Set();
		querySelector() { return {}; }
		closest() { return null; }
		getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; }
		setPointerCapture(id) { this.captured.add(id); }
		hasPointerCapture(id) { return this.captured.has(id); }
		releasePointerCapture(id) { this.captured.delete(id); }
	}
	const savedWindow = globalThis.window; const savedElement = globalThis.HTMLElement;
	const win = new EventTarget();
	globalThis.window = win; globalThis.HTMLElement = Node;
	try {
		const container = new Node(); const pane = new Node(); const cell = new Node(); const surface = new Node();
		pane.children = [cell]; cell.style.position = 'relative'; cell.firstElementChild = surface;
		let opts = { crosshair: { mode: 0 }, handleScroll: { pressedMouseMove: true }, handleScale: { pinch: true } };
		const timescale = { coordinateToLogical: x => x / 20, logicalToCoordinate: x => x * 20, coordinateToTime: x => 1000 + x / 20 * 60, timeToCoordinate: t => (t - 1000) / 60 * 20, width: () => 800 };
		const chart = { options: () => opts, applyOptions: next => opts = { ...opts, ...next }, chartElement: () => container, timeScale: () => timescale };
		const paneApi = { getHTMLElement: () => pane, getHeight: () => 600 };
		const series = { priceToCoordinate: v => v, coordinateToPrice: v => v, getPane: () => paneApi, priceFormatter: () => ({ format: String }), subscribeDataChanged() {}, unsubscribeDataChanged() {}, attachPrimitive(p) { p.attached({ chart, series, requestUpdate() {} }); }, detachPrimitive(p) { p.detached(); } };
		const manager = new DrawingManager(chart, series, { normalizeAnchor: p => scale.canonical(p) });
		const pointer = (target, type, x, y, extra = {}) => {
			const event = new Event(type);
			Object.assign(event, { clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0, shiftKey: false, pointerType: 'mouse', ...extra });
			target.dispatchEvent(event);
		};
		manager.setActiveTool('horizontal-line'); assert.equal(opts.handleScroll, false); assert.equal(surface.style.touchAction, 'none');
		pointer(container, 'pointerdown', 100, 100); assert.equal(manager.drawings().length, 0);
		pointer(win, 'pointercancel', 100, 100); assert.equal(manager.drawings().length, 0);
		// Horizontal line supports touch slide-to-aim before release.
		pointer(container, 'pointerdown', 100, 100, { pointerType: 'touch' });
		pointer(win, 'pointermove', 100, 130, { pointerType: 'touch' });
		pointer(win, 'pointerup', 100, 130, { pointerType: 'touch' });
		assert.equal(manager.drawings().length, 1); assert.equal(manager.drawings()[0].points()[0].price, 130);
		assert.deepEqual(opts.handleScale, { pinch: true });
		// Trend line supports press-drag-release in a single gesture.
		manager.setActiveTool('trend-line');
		pointer(container, 'pointerdown', 60, 200, { pointerType: 'touch' });
		pointer(win, 'pointermove', 240, 260, { pointerType: 'touch' });
		pointer(win, 'pointerup', 240, 260, { pointerType: 'touch' });
		assert.equal(manager.drawings().length, 2);
		assert.equal(manager.drawings()[1].points()[0].price, 200);
		assert.equal(manager.drawings()[1].points()[1].price, 260);
		// Trend line also supports tap-P1 then tap-and-aim-P2.
		manager.setActiveTool('trend-line');
		pointer(container, 'pointerdown', 80, 300, { pointerType: 'touch' });
		pointer(win, 'pointerup', 80, 300, { pointerType: 'touch' });
		assert.equal(manager.drawings().length, 2);
		pointer(container, 'pointerdown', 200, 320, { pointerType: 'touch' });
		pointer(win, 'pointermove', 220, 350, { pointerType: 'touch' });
		pointer(win, 'pointerup', 220, 350, { pointerType: 'touch' });
		assert.equal(manager.drawings().length, 3);
		assert.equal(manager.drawings()[2].points()[1].price, 350);
		// Touch hit-testing uses generous slop while mouse requires exact precision.
		manager.selectDrawing(null);
		pointer(container, 'pointerdown', 100, 145, { pointerType: 'mouse' });
		pointer(win, 'pointerup', 100, 145, { pointerType: 'mouse' });
		assert.equal(manager.selectedDrawing(), null);
		pointer(container, 'pointerdown', 100, 145, { pointerType: 'touch' });
		assert.equal(manager.selectedDrawing()?.id, manager.drawings()[0].id);
		// Second finger arriving before drag movement cancels drag so pinch-zoom is not blocked.
		pointer(container, 'pointerdown', 200, 200, { pointerId: 2, isPrimary: false, pointerType: 'touch' });
		assert.deepEqual(opts.handleScale, { pinch: true });
		pointer(win, 'pointerup', 100, 145, { pointerType: 'touch' });
		// Freehand brush, undo/redo, and drag cancel.
		manager.setActiveTool('brush'); pointer(container, 'pointerdown', 100, 100);
		pointer(win, 'pointermove', 120, 110); pointer(win, 'pointermove', 140, 120); pointer(win, 'pointerup', 140, 120);
		assert.equal(manager.drawings().length, 4); assert.equal(manager.drawings()[3].points().length, 3);
		manager.undo(); assert.equal(manager.drawings().length, 3); manager.redo(); assert.equal(manager.drawings().length, 4);
		manager.setActiveTool(null); manager.selectDrawing(manager.drawings()[0].id);
		pointer(container, 'pointerdown', 100, 130); pointer(win, 'pointermove', 100, 180); pointer(win, 'pointercancel', 100, 180);
		assert.equal(manager.drawings()[0].points()[0].price, 130);
		// Refresh recovery via repository preserves horizontal line and trend line anchors after delete + undo.
		const storage = memory();
		const repo = new DrawingRepository(storage, key);
		let store = reconcileDrawings(repo.load(), manager.exportState().drawings, scale);
		repo.save(store);
		const firstId = manager.drawings()[0].id;
		manager.removeDrawing(firstId);
		store = reconcileDrawings(store, manager.exportState().drawings, scale);
		repo.save(store);
		assert.equal(restoreDrawings(new DrawingRepository(storage, key).load(), scale).length, 3);
		manager.undo();
		store = reconcileDrawings(store, manager.exportState().drawings, scale);
		repo.save(store);
		const reloaded = restoreDrawings(new DrawingRepository(storage, key).load(), scale);
		assert.equal(reloaded.length, 4);
		assert.equal(reloaded[0].id, firstId);
		assert.equal(reloaded[0].points[0].price, 130);
		// A settings commit edits canonical future anchors and style in one history step.
		const before = manager.exportState();
		const future = scale.project({ time: scale.toTime(800.25), price: 333.5 });
		manager.updateDrawing(firstId, { points: [future], options: { color: '#089981', lineWidth: 4 } });
		assert.equal(manager.getDrawing(firstId).points()[0].time, future.time);
		assert.equal(manager.getDrawing(firstId).options().lineWidth, 4);
		const after = manager.exportState();
		manager.undo(); assert.deepEqual(manager.exportState(), before);
		manager.redo(); assert.deepEqual(manager.exportState(), after);
		manager.setActiveTool('trend-line'); manager.destroy(); assert.deepEqual(opts.handleScroll, { pressedMouseMove: true }); assert.equal(surface.style.touchAction, '');
	} finally { globalThis.window = savedWindow; globalThis.HTMLElement = savedElement; }
});

test('attached notes and per-level text survive timeframe, history, deletion and restore', async () => {
	const { createDrawingInstance } = await import('@tradingview/lwc-plugin-drawing-tools');
	assert.equal(createDrawingInstance({ ...line(), options: { text: 'Text' } }).options().attachedText, '', 'Legacy unused text is not promoted to a note');
	const drawing = { ...line(), type: 'fib-retracement', options: { ...BASE_DRAWING_OPTIONS, attachedText: '中文\n支撑', textBold: true, textItalic: true, textOpacity: .6, textAlign: 'right', textPosition: 'bottom', textOrientation: 'horizontal', fibLevels: [{ value: .618, color: '#ff9800', visible: true, text: '回踩 <b>不解析 HTML</b>' }] } };
	const repo = new DrawingRepository(memory(), key); repo.load(); const stored = reconcileDrawings(empty(), [drawing], scale); repo.save(stored);
	const coarse = new DrawingTimeScale([880, 1180, 1480], 300); const restored = restoreDrawings(repo.load(), coarse);
	assert.deepEqual(restored[0].options, drawing.options); assert.deepEqual(reconcileDrawings(stored, restored, coarse), stored);
	const history = new DrawingHistory(); history.push(restored); const removed = reconcileDrawings(stored, [], coarse); const revived = reconcileDrawings(removed, history.undo([]), coarse);
	assert.deepEqual(revived, stored);
	for (const [field, value] of [['textBold', 'yes'], ['textOpacity', 1.1], ['textAlign', 'outside'], ['textOrientation', 'diagonal'], ['attachedText', 'x'.repeat(10001)], ['fibLevels', [{ value: 1, color: '#fff', visible: true, text: 123 }]]]) {
		const bad = structuredClone(stored); bad.documents[0].style[field] = value; assert.throws(() => parseDrawingStore(bad, key));
	}
});
