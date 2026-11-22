import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApp } from '../src/app.mjs';
import { openStore } from '../src/store.mjs';

const TEST_TOKEN = 'test-secret-token-12345';

async function startServer(t, options = {}) {
	const tempDir = mkdtempSync(join(tmpdir(), 'terminal-sync-test-'));
	const dbPath = options.dbPath ?? join(tempDir, 'terminal.db');
	const store = openStore(dbPath);
	const app = createApp({ store, token: options.token ?? TEST_TOKEN, staticDir: options.staticDir });
	t.after(async () => {
		await new Promise((resolve, reject) => app.close(error => error ? reject(error) : resolve()));
		store.close();
		rmSync(tempDir, { recursive: true, force: true });
	});
	app.listen(0, '127.0.0.1');
	await once(app, 'listening');
	const baseUrl = `http://127.0.0.1:${app.address().port}`;
	return { baseUrl, dbPath, tempDir, store };
}

function authHeaders(token = TEST_TOKEN) {
	return {
		'Authorization': `Bearer ${token}`,
		'Content-Type': 'application/json',
	};
}

test('health, readiness, capabilities and token authentication enforcement', async t => {
	const { baseUrl, store } = await startServer(t);
	const live = await fetch(`${baseUrl}/health/live`);
	assert.equal(live.status, 200);
	assert.equal((await live.json()).stage, 'ready');

	const ready = await fetch(`${baseUrl}/health/ready`);
	assert.equal(ready.status, 200);
	assert.deepEqual(await ready.json(), { status: 'ready', storage: 'sqlite', storeId: store.storeId });

	const caps = await fetch(`${baseUrl}/v1/capabilities`);
	assert.equal(caps.status, 200);
	assert.deepEqual(await caps.json(), {
		apiVersion: 1,
		mode: 'single-user',
		storage: 'sqlite',
		storeId: store.storeId,
		authentication: 'token',
		sync: true,
		backup: true,
		staticWeb: false,
	});

	// Protected routes reject missing or wrong Bearer token.
	assert.equal((await fetch(`${baseUrl}/v1/snapshot`)).status, 401);
	assert.equal((await fetch(`${baseUrl}/v1/snapshot`, { headers: authHeaders('wrong-token-value') })).status, 401);
	assert.equal((await fetch(`${baseUrl}/v1/backup/sqlite`)).status, 401);
});

test('two-client sync: preference & drawing isolation, idempotency, 409 conflicts and tombstones', async t => {
	const { baseUrl } = await startServer(t);
	const deviceA = randomUUID();
	const deviceB = randomUUID();
	const spotKey = 'binance:spot:BTC-USDT';
	const perpKey = 'binance:perpetual:BTC-USDT';

	// Device A sets spot timeframe to 4h and perpetual to 15m (isolated).
	const prefMut1 = randomUUID();
	const r1 = await fetch(`${baseUrl}/v1/instruments/${encodeURIComponent(spotKey)}/preferences`, {
		method: 'PUT',
		headers: authHeaders(),
		body: JSON.stringify({ mutationId: prefMut1, deviceId: deviceA, baseRevision: 0, timeframe: '4h' }),
	});
	assert.equal(r1.status, 200);
	const spotPref = await r1.json();
	assert.equal(spotPref.timeframe, '4h');
	assert.equal(spotPref.revision, 1);

	// Retrying the exact same mutationId is idempotent and does not bump revision or conflict.
	const r1Retry = await fetch(`${baseUrl}/v1/instruments/${encodeURIComponent(spotKey)}/preferences`, {
		method: 'PUT',
		headers: authHeaders(),
		body: JSON.stringify({ mutationId: prefMut1, deviceId: deviceA, baseRevision: 0, timeframe: '4h' }),
	});
	assert.equal(r1Retry.status, 200);
	assert.deepEqual(await r1Retry.json(), spotPref);

	// Device B tries to update spot timeframe with stale baseRevision=0 -> 409 Conflict with latest.
	const rConflict = await fetch(`${baseUrl}/v1/instruments/${encodeURIComponent(spotKey)}/preferences`, {
		method: 'PUT',
		headers: authHeaders(),
		body: JSON.stringify({ mutationId: randomUUID(), deviceId: deviceB, baseRevision: 0, timeframe: '1d' }),
	});
	assert.equal(rConflict.status, 409);
	const conflictBody = await rConflict.json();
	assert.equal(conflictBody.error, 'conflict');
	assert.equal(conflictBody.latest.revision, 1);
	assert.equal(conflictBody.latest.timeframe, '4h');

	// Device B sets perpetual BTC-USDT independently.
	const rPerp = await fetch(`${baseUrl}/v1/instruments/${encodeURIComponent(perpKey)}/preferences`, {
		method: 'PUT',
		headers: authHeaders(),
		body: JSON.stringify({ mutationId: randomUUID(), deviceId: deviceB, baseRevision: 0, timeframe: '15m' }),
	});
	assert.equal(rPerp.status, 200);

	// Device A creates a drawing with UTC time + price anchors, then deletes it (tombstone).
	const drawingId = 'draw-line-1';
	const doc = {
		schemaVersion: 1,
		id: drawingId,
		instrumentKey: spotKey,
		kind: 'trend-line',
		anchors: [{ time: 1700000000, price: 62000 }, { time: 1700086400, price: 65000 }],
		style: { color: '#2962ff', lineWidth: 2 },
		deleted: false,
	};
	const d1 = await fetch(`${baseUrl}/v1/instruments/${encodeURIComponent(spotKey)}/drawings/${drawingId}`, {
		method: 'PUT',
		headers: authHeaders(),
		body: JSON.stringify({ mutationId: randomUUID(), deviceId: deviceA, baseRevision: 0, document: doc }),
	});
	assert.equal(d1.status, 200);
	const savedDrawing = await d1.json();
	assert.equal(savedDrawing.revision, 1);
	assert.equal(savedDrawing.deleted, false);

	// Stale drawing edit gets 409.
	const dConflict = await fetch(`${baseUrl}/v1/instruments/${encodeURIComponent(spotKey)}/drawings/${drawingId}`, {
		method: 'PUT',
		headers: authHeaders(),
		body: JSON.stringify({ mutationId: randomUUID(), deviceId: deviceB, baseRevision: 0, document: { ...doc, style: { color: '#ff0000' } } }),
	});
	assert.equal(dConflict.status, 409);

	// Delete drawing creates tombstone (revision 2, deleted: true).
	const dDel = await fetch(`${baseUrl}/v1/instruments/${encodeURIComponent(spotKey)}/drawings/${drawingId}`, {
		method: 'PUT',
		headers: authHeaders(),
		body: JSON.stringify({ mutationId: randomUUID(), deviceId: deviceB, baseRevision: 1, document: { ...doc, deleted: true } }),
	});
	assert.equal(dDel.status, 200);
	const deletedDrawing = await dDel.json();
	assert.equal(deletedDrawing.revision, 2);
	assert.equal(deletedDrawing.deleted, true);

	// Shared settings update with optimistic concurrency.
	const s1 = await fetch(`${baseUrl}/v1/settings/timeframes`, {
		method: 'PUT',
		headers: authHeaders(),
		body: JSON.stringify({
			mutationId: randomUUID(),
			deviceId: deviceA,
			baseRevision: 0,
			value: { schemaVersion: 1, favorites: ['15m', '1h', '4h', '1d'], collapsedGroups: [] },
		}),
	});
	assert.equal(s1.status, 200);

	// Snapshot includes both instruments (isolated), drawing tombstone, and settings.
	const snapRes = await fetch(`${baseUrl}/v1/snapshot`, { headers: authHeaders() });
	assert.equal(snapRes.status, 200);
	const snap = await snapRes.json();
	assert.equal(snap.instruments.length, 2);
	assert.equal(snap.drawings.length, 1);
	assert.equal(snap.drawings[0].deleted, true);
	assert.equal(snap.drawings[0].revision, 2);
	assert.deepEqual(snap.settings.timeframes.value.favorites, ['15m', '1h', '4h', '1d']);
});

test('SQLite hot backup can be restored directly on another machine, and JSON import supports merge/replace', async t => {
	const { baseUrl, tempDir, store } = await startServer(t);
	const spotKey = 'binance:spot:ETH-USDT';

	await fetch(`${baseUrl}/v1/instruments/${encodeURIComponent(spotKey)}/preferences`, {
		method: 'PUT',
		headers: authHeaders(),
		body: JSON.stringify({ mutationId: randomUUID(), deviceId: randomUUID(), baseRevision: 0, timeframe: '2h' }),
	});
	await fetch(`${baseUrl}/v1/instruments/${encodeURIComponent(spotKey)}/drawings/eth-hl-1`, {
		method: 'PUT',
		headers: authHeaders(),
		body: JSON.stringify({
			mutationId: randomUUID(),
			deviceId: randomUUID(),
			baseRevision: 0,
			document: {
				schemaVersion: 1,
				id: 'eth-hl-1',
				instrumentKey: spotKey,
				kind: 'horizontal-line',
				anchors: [{ time: 1700100000, price: 3200 }],
				style: { color: '#f59e0b' },
				deleted: false,
			},
		}),
	});

	// Download online consistent SQLite single-file backup.
	const backupRes = await fetch(`${baseUrl}/v1/backup/sqlite`, { headers: authHeaders() });
	assert.equal(backupRes.status, 200);
	assert.equal(backupRes.headers.get('content-type'), 'application/vnd.sqlite3');
	const backupBytes = Buffer.from(await backupRes.arrayBuffer());
	assert.ok(backupBytes.length > 4096);

	// Open the downloaded backup as a brand-new standalone store (simulating PC takeover after server shutdown).
	const migratedPath = join(tempDir, 'pc-migrated.db');
	writeFileSync(migratedPath, backupBytes);
	const pcStore = openStore(migratedPath);
	t.after(() => pcStore.close());
	assert.equal(pcStore.storeId, store.storeId);
	const pcSnap = pcStore.getSnapshot();
	assert.equal(pcSnap.instruments[0].timeframe, '2h');
	assert.equal(pcSnap.drawings[0].id, 'eth-hl-1');
	assert.equal(pcSnap.drawings[0].anchors[0].price, 3200);

	// Also verify JSON snapshot import into a fresh empty server.
	const fresh = await startServer(t);
	assert.notEqual(fresh.store.storeId, store.storeId);
	const importRes = await fetch(`${fresh.baseUrl}/v1/import`, {
		method: 'POST',
		headers: authHeaders(),
		body: JSON.stringify({ mode: 'replace', snapshot: pcSnap }),
	});
	assert.equal(importRes.status, 200);
	const imported = await importRes.json();
	assert.equal(imported.instruments.length, 1);
	assert.equal(imported.instruments[0].timeframe, '2h');
	assert.equal(imported.drawings[0].id, 'eth-hl-1');
});

test('staticDir serves single-container web bundle safely without path traversal', async t => {
	const webDir = mkdtempSync(join(tmpdir(), 'terminal-web-static-'));
	mkdirSync(join(webDir, 'assets'), { recursive: true });
	writeFileSync(join(webDir, 'index.html'), '<!doctype html><div id="app"></div>');
	writeFileSync(join(webDir, 'assets', 'app.js'), 'console.log("ok");');
	t.after(() => rmSync(webDir, { recursive: true, force: true }));

	const { baseUrl } = await startServer(t, { staticDir: webDir });
	const caps = await (await fetch(`${baseUrl}/v1/capabilities`)).json();
	assert.equal(caps.staticWeb, true);

	const indexRes = await fetch(`${baseUrl}/`);
	assert.equal(indexRes.status, 200);
	assert.match(await indexRes.text(), /id="app"/);

	const assetRes = await fetch(`${baseUrl}/assets/app.js`);
	assert.equal(assetRes.status, 200);
	assert.match(assetRes.headers.get('cache-control') ?? '', /immutable/);

	const traversal = await fetch(`${baseUrl}/..%2F..%2Fetc%2Fpasswd`);
	assert.equal(traversal.status, 404);
});
