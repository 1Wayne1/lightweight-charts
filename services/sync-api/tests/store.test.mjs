import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openStore } from '../src/store.mjs';

test('SQLite store runs versioned migrations once, preserves storeId, enforces concurrency, idempotency and hot backup restore', t => {
	const tempDir = mkdtempSync(join(tmpdir(), 'terminal-store-test-'));
	t.after(() => rmSync(tempDir, { recursive: true, force: true }));

	const dbPath = join(tempDir, 'terminal.db');
	const store1 = openStore(dbPath);
	const initialStoreId = store1.storeId;
	assert.equal(store1.healthCheck(), true);

	const deviceA = randomUUID();
	const mut1 = randomUUID();
	const p1 = store1.putPreference('binance:spot:BTC-USDT', {
		mutationId: mut1,
		deviceId: deviceA,
		baseRevision: 0,
		timeframe: '4h',
	});
	assert.equal(p1.status, 200);
	assert.equal(p1.body.revision, 1);

	// Idempotent replay returns exact same response without bumping revision.
	const p1Replay = store1.putPreference('binance:spot:BTC-USDT', {
		mutationId: mut1,
		deviceId: deviceA,
		baseRevision: 0,
		timeframe: '4h',
	});
	assert.equal(p1Replay.status, 200);
	assert.deepEqual(p1Replay.body, p1.body);

	// Stale baseRevision fails with 409 and returns latest.
	const pConflict = store1.putPreference('binance:spot:BTC-USDT', {
		mutationId: randomUUID(),
		deviceId: randomUUID(),
		baseRevision: 0,
		timeframe: '1d',
	});
	assert.equal(pConflict.status, 409);
	assert.equal(pConflict.body.latest.timeframe, '4h');

	// Drawing creation + tombstone deletion.
	const doc = {
		schemaVersion: 1,
		id: 'draw-1',
		instrumentKey: 'binance:spot:BTC-USDT',
		kind: 'horizontal-line',
		anchors: [{ time: 1700000000, price: 64000 }],
		style: { color: '#2962ff' },
		deleted: false,
	};
	const d1 = store1.putDrawing('binance:spot:BTC-USDT', 'draw-1', {
		mutationId: randomUUID(),
		deviceId: deviceA,
		baseRevision: 0,
		document: doc,
	});
	assert.equal(d1.status, 200);
	assert.equal(d1.body.revision, 1);

	const dDel = store1.putDrawing('binance:spot:BTC-USDT', 'draw-1', {
		mutationId: randomUUID(),
		deviceId: deviceA,
		baseRevision: 1,
		document: { ...doc, deleted: true },
	});
	assert.equal(dDel.status, 200);
	assert.equal(dDel.body.deleted, true);
	assert.equal(dDel.body.revision, 2);

	// Online hot backup via VACUUM INTO while DB is open in WAL mode.
	const backupPath = join(tempDir, 'backup.db');
	store1.createSqliteBackup(backupPath);
	store1.close();

	// Reopen original DB -> migration is idempotent and storeId is preserved.
	const reopened = openStore(dbPath);
	assert.equal(reopened.storeId, initialStoreId);
	reopened.close();

	// Open standalone hot backup on another machine -> full state & storeId intact.
	const restored = openStore(backupPath);
	t.after(() => restored.close());
	assert.equal(restored.storeId, initialStoreId);
	const snap = restored.getSnapshot();
	assert.equal(snap.instruments.length, 1);
	assert.equal(snap.instruments[0].timeframe, '4h');
	assert.equal(snap.drawings.length, 1);
	assert.equal(snap.drawings[0].deleted, true);
	assert.equal(snap.drawings[0].revision, 2);
});
