import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openStore } from '../../../services/sync-api/src/store.mjs';
import { validateDrawingMutation, validateImportPayload, validatePreferenceMutation, validateSettingMutation } from '../../../services/sync-api/src/validate.mjs';
import { SyncEngine } from '../src/sync/engine';
import { MemorySyncStorage } from '../src/sync/storage';

/**
 * In-process fetch adapter backed by the real SQLite store (no sockets needed in sandbox).
 * Allows toggling `online` to simulate server shutdown and swapping `store` to simulate PC migration.
 */
function createMockSyncTransport(initialStore, token = 'secret-sync-token-123', authMode = 'token') {
	let activeStore = initialStore;
	let online = true;
	let mode = authMode;
	const calls = [];

	const fetcher = async (input, init = {}) => {
		const url = new URL(String(input));
		const method = init.method ?? 'GET';
		calls.push({ method, pathname: url.pathname });
		if (!online) throw new TypeError('Failed to fetch (server offline)');

		const jsonResponse = (status, body) => new Response(JSON.stringify(body), {
			status,
			headers: { 'Content-Type': 'application/json' },
		});

		if (url.pathname === '/v1/capabilities' && method === 'GET') {
			return jsonResponse(200, {
				apiVersion: 1,
				mode: 'single-user',
				storage: 'sqlite',
				storeId: activeStore.storeId,
				authentication: mode,
				sync: true,
				backup: true,
				staticWeb: true,
			});
		}

		if (mode === 'local') {
			const localHeader = init.headers?.['X-Terminal-Local'] ?? init.headers?.['x-terminal-local'];
			if (localHeader !== '1') {
				return jsonResponse(403, { error: 'forbidden' });
			}
		} else {
			const auth = init.headers?.Authorization ?? init.headers?.authorization;
			if (auth !== `Bearer ${token}`) {
				return jsonResponse(401, { error: 'unauthorized' });
			}
		}

		if (url.pathname === '/v1/snapshot' && method === 'GET') {
			return jsonResponse(200, activeStore.getSnapshot());
		}

		if (url.pathname === '/v1/backup/sqlite' && method === 'GET') {
			return new Response(new Uint8Array([83, 81, 76, 105, 116, 101]), {
				status: 200,
				headers: {
					'Content-Type': 'application/vnd.sqlite3',
					'Content-Disposition': 'attachment; filename="terminal-local.db"',
				},
			});
		}

		if (url.pathname === '/v1/import' && method === 'POST') {
			const validated = validateImportPayload(JSON.parse(String(init.body)));
			return jsonResponse(200, activeStore.importSnapshot(validated));
		}

		const prefMatch = /^\/v1\/instruments\/([^/]+)\/preferences$/.exec(url.pathname);
		if (prefMatch && method === 'PUT') {
			const key = decodeURIComponent(prefMatch[1]);
			const res = activeStore.putPreference(key, validatePreferenceMutation(JSON.parse(String(init.body))));
			return jsonResponse(res.status, res.body);
		}

		const drawMatch = /^\/v1\/instruments\/([^/]+)\/drawings\/([^/]+)$/.exec(url.pathname);
		if (drawMatch && method === 'PUT') {
			const key = decodeURIComponent(drawMatch[1]);
			const id = decodeURIComponent(drawMatch[2]);
			const res = activeStore.putDrawing(key, id, validateDrawingMutation(JSON.parse(String(init.body)), key, id));
			return jsonResponse(res.status, res.body);
		}

		const setMatch = /^\/v1\/settings\/([^/]+)$/.exec(url.pathname);
		if (setMatch && method === 'PUT') {
			const key = decodeURIComponent(setMatch[1]);
			const res = activeStore.putSetting(key, validateSettingMutation(key, JSON.parse(String(init.body))));
			return jsonResponse(res.status, res.body);
		}

		return jsonResponse(404, { error: 'not_found' });
	};

	return {
		fetcher,
		calls,
		setOnline(value) { online = value; },
		setStore(nextStore) { activeStore = nextStore; },
		setAuthMode(nextMode) { mode = nextMode; },
	};
}

function createFakeHost() {
	const preferences = new Map();
	const drawings = new Map();
	const settings = new Map();
	let remoteAppliedCount = 0;

	const host = {
		preferences,
		drawings,
		settings,
		get remoteAppliedCount() { return remoteAppliedCount; },
		exportLocalSnapshot() {
			const now = new Date().toISOString();
			return {
				schemaVersion: 1,
				storeId: 'local-host',
				exportedAt: now,
				instruments: [...preferences.values()],
				drawings: [...drawings.values()],
				settings: Object.fromEntries(settings.entries()),
			};
		},
		applyRemotePreference(item) {
			preferences.set(item.instrumentKey, structuredClone(item));
		},
		applyRemoteDrawings(_key, records) {
			for (const rec of records) drawings.set(rec.id, structuredClone(rec));
		},
		confirmDrawingRevision(_key, id, revision) {
			const existing = drawings.get(id);
			if (existing) drawings.set(id, { ...existing, revision });
		},
		applyRemoteSetting(record) {
			settings.set(record.key, structuredClone(record));
		},
		replaceLocalFromSnapshot(snapshot) {
			preferences.clear();
			drawings.clear();
			settings.clear();
			for (const item of snapshot.instruments) preferences.set(item.instrumentKey, structuredClone(item));
			for (const rec of snapshot.drawings) drawings.set(rec.id, structuredClone(rec));
			for (const [k, rec] of Object.entries(snapshot.settings)) settings.set(k, structuredClone(rec));
		},
		onRemoteApplied() {
			remoteAppliedCount++;
		},
	};
	return host;
}

test('offline edits queue persistently while server is shut down, never claim synced, and flush on reconnect', async t => {
	const store = openStore(':memory:');
	t.after(() => store.close());
	const transport = createMockSyncTransport(store);
	const storage = new MemorySyncStorage();
	const host = createFakeHost();
	const engine = new SyncEngine(storage, host, { fetcher: transport.fetcher });

	await engine.init();
	await engine.configure({ serverUrl: 'http://sync.local', token: 'secret-sync-token-123', enabled: true });
	assert.equal(engine.getViewState().status, 'synced');

	// Server shuts down! User edits BTC timeframe and adds a drawing offline.
	transport.setOnline(false);
	const spotKey = 'binance:spot:BTC-USDT';
	const doc = {
		schemaVersion: 1,
		id: 'offline-trend-1',
		instrumentKey: spotKey,
		kind: 'trend-line',
		anchors: [{ time: 1700000000, price: 61000 }, { time: 1700086400, price: 63000 }],
		style: { color: '#2962ff' },
		revision: 0,
		deleted: false,
	};
	host.drawings.set(doc.id, { ...doc, updatedAt: new Date().toISOString() });
	await engine.enqueuePreference(spotKey, '4h');
	await engine.enqueueDrawing(doc);
	await engine.syncNow();

	const offlineView = engine.getViewState();
	assert.equal(offlineView.status, 'offline');
	assert.equal(offlineView.pendingCount, 2);

	// Reload engine from persistent storage while still offline, then server comes back online.
	const reloaded = new SyncEngine(storage, host, { fetcher: transport.fetcher });
	transport.setOnline(true);
	await reloaded.init();
	await reloaded.syncNow();

	const syncedView = reloaded.getViewState();
	assert.equal(syncedView.status, 'synced');
	assert.equal(syncedView.pendingCount, 0);
	const serverSnap = store.getSnapshot();
	assert.equal(serverSnap.instruments[0].timeframe, '4h');
	assert.equal(serverSnap.drawings[0].id, 'offline-trend-1');
	assert.equal(host.drawings.get('offline-trend-1').revision, 1);
});

test('two clients detect 409 conflict without silent overwrite and resolve by keeping local or adopting server', async t => {
	const store = openStore(':memory:');
	t.after(() => store.close());
	const transport = createMockSyncTransport(store);

	const hostA = createFakeHost();
	const hostB = createFakeHost();
	const clientA = new SyncEngine(new MemorySyncStorage(), hostA, { fetcher: transport.fetcher });
	const clientB = new SyncEngine(new MemorySyncStorage(), hostB, { fetcher: transport.fetcher });

	await clientA.init();
	await clientB.init();
	await clientA.configure({ serverUrl: 'http://sync.local', token: 'secret-sync-token-123', enabled: true });
	await clientB.configure({ serverUrl: 'http://sync.local', token: 'secret-sync-token-123', enabled: true });

	const spotKey = 'binance:spot:ETH-USDT';
	await clientA.enqueuePreference(spotKey, '15m');
	await clientA.syncNow();
	await clientB.syncNow();
	assert.equal(hostB.preferences.get(spotKey).timeframe, '15m');

	// Both clients go offline and edit ETH timeframe to different values.
	transport.setOnline(false);
	await clientA.enqueuePreference(spotKey, '4h');
	await clientB.enqueuePreference(spotKey, '1d');

	// Client A syncs first -> succeeds (revision 2).
	transport.setOnline(true);
	await clientA.syncNow();
	assert.equal(store.getSnapshot().instruments[0].timeframe, '4h');
	assert.equal(store.getSnapshot().instruments[0].revision, 2);

	// Client B syncs with stale baseRevision=1 -> 409 conflict, NOT silent overwrite!
	await clientB.syncNow();
	const viewB = clientB.getViewState();
	assert.equal(viewB.status, 'conflict');
	assert.equal(viewB.conflictCount, 1);
	assert.equal(store.getSnapshot().instruments[0].timeframe, '4h');

	// Client B chooses 'local' -> pushes '1d' on top of revision 2 -> revision 3.
	await clientB.resolveConflict(viewB.conflicts[0].id, 'local');
	assert.equal(clientB.getViewState().status, 'synced');
	assert.equal(store.getSnapshot().instruments[0].timeframe, '1d');
	assert.equal(store.getSnapshot().instruments[0].revision, 3);
});

test('switching from shut-down cloud server to fresh local PC SQLite DB triggers storeMismatch and push_replace migrates all data', async t => {
	const cloudStore = openStore(':memory:');
	const pcFreshStore = openStore(':memory:');
	t.after(() => { cloudStore.close(); pcFreshStore.close(); });
	const transport = createMockSyncTransport(cloudStore);
	const host = createFakeHost();
	const engine = new SyncEngine(new MemorySyncStorage(), host, { fetcher: transport.fetcher });

	await engine.init();
	await engine.configure({ serverUrl: 'http://cloud.local', token: 'secret-sync-token-123', enabled: true });

	const key = 'binance:perpetual:BTC-USDT';
	const doc = {
		schemaVersion: 1,
		id: 'perp-fib-1',
		instrumentKey: key,
		kind: 'fib-retracement',
		anchors: [{ time: 1700000000, price: 50000 }, { time: 1700100000, price: 70000 }],
		style: { color: '#26a69a' },
		revision: 0,
		deleted: false,
	};
	host.preferences.set(key, {
		instrumentKey: key,
		instrument: { venue: 'binance', market: 'perpetual', symbol: 'BTC-USDT' },
		timeframe: '4h',
		revision: 1,
		updatedAt: new Date().toISOString(),
	});
	host.drawings.set(doc.id, { ...doc, updatedAt: new Date().toISOString() });
	await engine.enqueuePreference(key, '4h');
	await engine.enqueueDrawing(doc);
	await engine.syncNow();
	assert.equal(engine.getViewState().status, 'synced');

	// Cloud server shuts down; user starts a fresh empty SQLite container on their PC and points the client at it.
	transport.setStore(pcFreshStore);
	await engine.configure({ serverUrl: 'http://127.0.0.1:8080', token: 'secret-sync-token-123', enabled: true });

	const mismatchView = engine.getViewState();
	assert.equal(mismatchView.status, 'store_mismatch');
	assert.equal(mismatchView.storeMismatch?.reason, 'store_changed');
	assert.equal(mismatchView.storeMismatch?.expectedStoreId, cloudStore.storeId);
	assert.equal(mismatchView.storeMismatch?.actualStoreId, pcFreshStore.storeId);

	// User chooses 'push_replace' -> local data populates the fresh PC SQLite DB seamlessly.
	await engine.resolveStoreMismatch('push_replace');
	assert.equal(engine.getViewState().status, 'synced');
	assert.equal(engine.getViewState().config.lastStoreId, pcFreshStore.storeId);
	const pcSnap = pcFreshStore.getSnapshot();
	assert.equal(pcSnap.instruments.length, 1);
	assert.equal(pcSnap.instruments[0].timeframe, '4h');
	assert.equal(pcSnap.drawings.length, 1);
	assert.equal(pcSnap.drawings[0].id, 'perp-fib-1');
});

test('offline portable JSON snapshot export and import works without any server connection', async () => {
	const hostA = createFakeHost();
	const engineA = new SyncEngine(new MemorySyncStorage(), hostA);
	await engineA.init();
	const key = 'binance:spot:SOL-USDT';
	hostA.preferences.set(key, {
		instrumentKey: key,
		instrument: { venue: 'binance', market: 'spot', symbol: 'SOL-USDT' },
		timeframe: '1d',
		revision: 1,
		updatedAt: '2026-11-22T12:00:00.000Z',
	});
	hostA.drawings.set('sol-1', {
		schemaVersion: 1,
		id: 'sol-1',
		instrumentKey: key,
		kind: 'horizontal-line',
		anchors: [{ time: 1700000000, price: 210 }],
		style: { color: '#f59e0b' },
		revision: 1,
		deleted: false,
		updatedAt: '2026-11-22T12:00:00.000Z',
	});

	const exported = JSON.parse(JSON.stringify(engineA.exportPortableJson()));
	const hostB = createFakeHost();
	const engineB = new SyncEngine(new MemorySyncStorage(), hostB);
	await engineB.init();
	await engineB.importPortableJson(exported, 'replace');

	assert.equal(hostB.preferences.get(key).timeframe, '1d');
	assert.equal(hostB.drawings.get('sol-1').anchors[0].price, 210);
});

test('watchlist and open workspace tabs sync across two devices independently of drawings', async t => {
	const store = openStore(':memory:');
	t.after(() => store.close());
	const transport = createMockSyncTransport(store);
	const hostA = createFakeHost();
	const hostB = createFakeHost();
	const clientA = new SyncEngine(new MemorySyncStorage(), hostA, { fetcher: transport.fetcher });
	const clientB = new SyncEngine(new MemorySyncStorage(), hostB, { fetcher: transport.fetcher });

	await clientA.init();
	await clientB.init();
	await clientA.configure({ serverUrl: 'http://sync.local', token: 'secret-sync-token-123', enabled: true });
	await clientB.configure({ serverUrl: 'http://sync.local', token: 'secret-sync-token-123', enabled: true });

	await clientA.enqueueSetting('watchlist', {
		schemaVersion: 1,
		items: [{ venue: 'binance', market: 'perpetual', symbol: 'ETH-USDT' }],
	});
	await clientA.enqueueSetting('workspace-tabs', {
		schemaVersion: 1,
		tabs: [{ id: 'binance:perpetual:ETH-USDT', instrumentKey: 'binance:perpetual:ETH-USDT' }],
		activeTabId: 'binance:perpetual:ETH-USDT',
	});
	await clientA.syncNow();
	await clientB.syncNow();

	assert.equal(hostB.settings.get('watchlist').value.items[0].symbol, 'ETH-USDT');
	assert.equal(hostB.settings.get('workspace-tabs').value.activeTabId, 'binance:perpetual:ETH-USDT');

	// Verify MA/EMA line periods, alpha hex colors, and custom colors sync intact.
	await clientA.enqueueSetting('indicators', {
		schemaVersion: 2,
		maEnabled: true,
		maLines: [
			{ id: 'ma-1', period: 20, color: '#ffeb3b', visible: true },
			{ id: 'ma-2', period: 80, color: '#ffa72680', visible: true },
			{ id: 'ma-3', period: 200, color: '#2962ff', visible: false },
		],
		emaEnabled: true,
		emaLines: [{ id: 'ema-1', period: 21, color: '#089981', visible: true }],
		volume: true,
		enabled: { macd: true },
		params: {},
		colors: {},
		plotColors: { macd: { macd: '#4285ff', signal: '#ff9e2c' } },
		paneOrder: ['price', 'macd'],
		hidden: [],
		legendCollapsed: false,
	});
	await clientA.enqueueSetting('custom-colors', {
		schemaVersion: 1,
		colors: ['#ffa726', '#4f82bd'],
	});
	await clientA.syncNow();
	await clientB.syncNow();

	const syncedInd = hostB.settings.get('indicators').value;
	assert.equal(syncedInd.maLines.length, 3);
	assert.deepEqual(syncedInd.maLines.map(l => [l.period, l.color, l.visible]), [
		[20, '#ffeb3b', true],
		[80, '#ffa72680', true],
		[200, '#2962ff', false],
	]);
	assert.deepEqual(hostB.settings.get('custom-colors').value.colors, ['#ffa726', '#4f82bd']);
});

test('auto-discovers built-in local storage on startup without token, supports backup, and protects switching to remote server', async t => {
	const localStore = openStore(':memory:');
	const remoteStore = openStore(':memory:');
	t.after(() => { localStore.close(); remoteStore.close(); });
	const transport = createMockSyncTransport(localStore, 'remote-secret-token-999', 'local');
	const host = createFakeHost();
	const storage = new MemorySyncStorage();
	const engine = new SyncEngine(storage, host, {
		fetcher: transport.fetcher,
		fallbackOrigin: 'http://127.0.0.1:5173',
	});

	await engine.init();
	await engine.syncNow();
	const view = engine.getViewState();
	assert.equal(view.config.enabled, true);
	assert.equal(view.config.mode, 'local');
	assert.equal(view.status, 'synced');
	assert.equal(view.localService.available, true);
	assert.equal(view.localService.authMode, 'local');

	// Save a drawing to local SQLite without configuring URL or token.
	const key = 'binance:spot:BTC-USDT';
	await engine.enqueuePreference(key, '4h');
	await engine.syncNow();
	assert.equal(localStore.getSnapshot().instruments[0].timeframe, '4h');

	// SQLite backup works in local mode without token.
	const backup = await engine.downloadBackup();
	assert.equal(backup.filename, 'terminal-local.db');
	assert.equal(backup.blob.size, 6);

	// Switching from built-in local SQLite to a remote token-protected server triggers storeMismatch protection.
	transport.setStore(remoteStore);
	transport.setAuthMode('token');
	await engine.configure({ serverUrl: 'http://remote.local:8080', token: 'remote-secret-token-999', enabled: true, mode: 'remote' });
	assert.equal(engine.getViewState().status, 'store_mismatch');
	assert.equal(engine.getViewState().storeMismatch?.expectedStoreId, localStore.storeId);
	assert.equal(engine.getViewState().storeMismatch?.actualStoreId, remoteStore.storeId);

	// Respects explicit user disable across reloads (does not force local mode back on).
	await engine.configure({ serverUrl: '', token: '', enabled: false, mode: 'disabled' });
	transport.setStore(localStore);
	transport.setAuthMode('local');
	const reloaded = new SyncEngine(storage, host, {
		fetcher: transport.fetcher,
		fallbackOrigin: 'http://127.0.0.1:5173',
	});
	await reloaded.init();
	assert.equal(reloaded.getViewState().config.enabled, false);
	assert.equal(reloaded.getViewState().config.mode, 'disabled');
});
