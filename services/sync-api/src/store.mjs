import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { parseInstrumentKey } from './validate.mjs';

const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

function rowToInstrument(row) {
	return {
		instrumentKey: `${row.venue}:${row.market}:${row.symbol}`,
		instrument: { venue: row.venue, market: row.market, symbol: row.symbol },
		timeframe: row.timeframe,
		revision: Number(row.revision),
		updatedAt: row.updated_at,
	};
}

function rowToDrawing(row) {
	return {
		schemaVersion: Number(row.schema_version),
		id: row.id,
		instrumentKey: `${row.venue}:${row.market}:${row.symbol}`,
		kind: row.kind,
		anchors: JSON.parse(row.anchors),
		style: JSON.parse(row.style),
		revision: Number(row.revision),
		deleted: Boolean(row.deleted),
		updatedAt: row.updated_at,
	};
}

function rowToSetting(row) {
	return {
		key: row.key,
		value: JSON.parse(row.value),
		revision: Number(row.revision),
		updatedAt: row.updated_at,
	};
}

export function openStore(dbPath = ':memory:', options = {}) {
	const migrationsDir = options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR;
	if (dbPath !== ':memory:') {
		mkdirSync(dirname(dbPath), { recursive: true });
	}
	const db = new DatabaseSync(dbPath);
	db.exec('PRAGMA foreign_keys = ON;');
	db.exec('PRAGMA busy_timeout = 5000;');
	if (dbPath !== ':memory:') {
		db.exec('PRAGMA journal_mode = WAL;');
		db.exec('PRAGMA synchronous = NORMAL;');
	}

	function runTransaction(fn) {
		db.exec('BEGIN IMMEDIATE');
		try {
			const result = fn();
			db.exec('COMMIT');
			return result;
		} catch (error) {
			try {
				db.exec('ROLLBACK');
			} catch {
				// Ignore rollback failure if transaction is already closed.
			}
			throw error;
		}
	}

	// Versioned migration runner: applies pending .sql files in lexical order without deleting data.
	db.exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version TEXT PRIMARY KEY,
			applied_at TEXT NOT NULL
		);
	`);
	const appliedRows = db.prepare('SELECT version FROM schema_migrations').all();
	const applied = new Set(appliedRows.map(row => row.version));
	const migrationFiles = readdirSync(migrationsDir)
		.filter(name => name.endsWith('.sql'))
		.sort();
	for (const file of migrationFiles) {
		if (applied.has(file)) continue;
		const sql = readFileSync(join(migrationsDir, file), 'utf8');
		runTransaction(() => {
			db.exec(sql);
			db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
				.run(file, new Date().toISOString());
		});
	}

	// Stable store_id uniquely identifies this SQLite database across backups and server/PC migrations.
	let storeMeta = db.prepare('SELECT value FROM store_meta WHERE key = ?').get('store_id');
	if (!storeMeta) {
		const id = options.storeId ?? randomUUID();
		db.prepare('INSERT INTO store_meta (key, value) VALUES (?, ?)').run('store_id', id);
		storeMeta = { value: id };
	}
	const storeId = String(storeMeta.value);

	const stmts = {
		getMutation: db.prepare('SELECT status_code, response FROM sync_mutations WHERE mutation_id = ?'),
		insertMutation: db.prepare('INSERT INTO sync_mutations (mutation_id, device_id, status_code, response, created_at) VALUES (?, ?, ?, ?, ?)'),
		getInstrument: db.prepare('SELECT venue, market, symbol, timeframe, revision, updated_at FROM instrument_states WHERE venue = ? AND market = ? AND symbol = ?'),
		allInstruments: db.prepare('SELECT venue, market, symbol, timeframe, revision, updated_at FROM instrument_states ORDER BY venue, market, symbol'),
		upsertInstrument: db.prepare(`
			INSERT INTO instrument_states (venue, market, symbol, timeframe, revision, updated_at)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(venue, market, symbol) DO UPDATE SET
				timeframe = excluded.timeframe,
				revision = excluded.revision,
				updated_at = excluded.updated_at
		`),
		ensureInstrument: db.prepare(`
			INSERT OR IGNORE INTO instrument_states (venue, market, symbol, timeframe, revision, updated_at)
			VALUES (?, ?, ?, '1h', 1, ?)
		`),
		getDrawing: db.prepare('SELECT id, venue, market, symbol, schema_version, kind, anchors, style, revision, deleted, deleted_at, updated_at FROM drawings WHERE id = ?'),
		allDrawings: db.prepare('SELECT id, venue, market, symbol, schema_version, kind, anchors, style, revision, deleted, deleted_at, updated_at FROM drawings ORDER BY updated_at, id'),
		upsertDrawing: db.prepare(`
			INSERT INTO drawings (id, venue, market, symbol, schema_version, kind, anchors, style, revision, deleted, deleted_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET
				schema_version = excluded.schema_version,
				kind = excluded.kind,
				anchors = excluded.anchors,
				style = excluded.style,
				revision = excluded.revision,
				deleted = excluded.deleted,
				deleted_at = excluded.deleted_at,
				updated_at = excluded.updated_at
		`),
		getSetting: db.prepare('SELECT key, value, revision, updated_at FROM app_settings WHERE key = ?'),
		allSettings: db.prepare('SELECT key, value, revision, updated_at FROM app_settings ORDER BY key'),
		upsertSetting: db.prepare(`
			INSERT INTO app_settings (key, value, revision, updated_at)
			VALUES (?, ?, ?, ?)
			ON CONFLICT(key) DO UPDATE SET
				value = excluded.value,
				revision = excluded.revision,
				updated_at = excluded.updated_at
		`),
		health: db.prepare('SELECT 1 AS ok'),
	};

	function getSnapshot() {
		const instruments = stmts.allInstruments.all().map(rowToInstrument);
		const drawings = stmts.allDrawings.all().map(rowToDrawing);
		const settings = {};
		for (const row of stmts.allSettings.all()) {
			settings[row.key] = rowToSetting(row);
		}
		return {
			schemaVersion: 1,
			storeId,
			exportedAt: new Date().toISOString(),
			instruments,
			drawings,
			settings,
		};
	}

	function putPreference(key, input) {
		const { venue, market, symbol } = parseInstrumentKey(key);
		return runTransaction(() => {
			const cached = stmts.getMutation.get(input.mutationId);
			if (cached) {
				return { status: Number(cached.status_code), body: JSON.parse(cached.response) };
			}
			const existing = stmts.getInstrument.get(venue, market, symbol);
			const currentRevision = existing ? Number(existing.revision) : 0;
			if (currentRevision !== input.baseRevision) {
				return {
					status: 409,
					body: {
						error: 'conflict',
						latest: existing ? rowToInstrument(existing) : null,
					},
				};
			}
			const now = new Date().toISOString();
			const nextRevision = currentRevision + 1;
			stmts.upsertInstrument.run(venue, market, symbol, input.timeframe, nextRevision, now);
			const saved = rowToInstrument(stmts.getInstrument.get(venue, market, symbol));
			stmts.insertMutation.run(input.mutationId, input.deviceId, 200, JSON.stringify(saved), now);
			return { status: 200, body: saved };
		});
	}

	function putDrawing(key, id, input) {
		const { venue, market, symbol } = parseInstrumentKey(key);
		return runTransaction(() => {
			const cached = stmts.getMutation.get(input.mutationId);
			if (cached) {
				return { status: Number(cached.status_code), body: JSON.parse(cached.response) };
			}
			const existing = stmts.getDrawing.get(id);
			if (existing && (existing.venue !== venue || existing.market !== market || existing.symbol !== symbol)) {
				return { status: 400, body: { error: 'drawing_instrument_mismatch' } };
			}
			const currentRevision = existing ? Number(existing.revision) : 0;
			if (currentRevision !== input.baseRevision) {
				return {
					status: 409,
					body: {
						error: 'conflict',
						latest: existing ? rowToDrawing(existing) : null,
					},
				};
			}
			const now = new Date().toISOString();
			stmts.ensureInstrument.run(venue, market, symbol, now);
			const nextRevision = currentRevision + 1;
			const deletedFlag = input.document.deleted ? 1 : 0;
			const deletedAt = deletedFlag ? (existing?.deleted_at ?? now) : null;
			stmts.upsertDrawing.run(
				id,
				venue,
				market,
				symbol,
				input.document.schemaVersion,
				input.document.kind,
				JSON.stringify(input.document.anchors),
				JSON.stringify(input.document.style),
				nextRevision,
				deletedFlag,
				deletedAt,
				now,
			);
			const saved = rowToDrawing(stmts.getDrawing.get(id));
			stmts.insertMutation.run(input.mutationId, input.deviceId, 200, JSON.stringify(saved), now);
			return { status: 200, body: saved };
		});
	}

	function putSetting(settingKey, input) {
		return runTransaction(() => {
			const cached = stmts.getMutation.get(input.mutationId);
			if (cached) {
				return { status: Number(cached.status_code), body: JSON.parse(cached.response) };
			}
			const existing = stmts.getSetting.get(settingKey);
			const currentRevision = existing ? Number(existing.revision) : 0;
			if (currentRevision !== input.baseRevision) {
				return {
					status: 409,
					body: {
						error: 'conflict',
						latest: existing ? rowToSetting(existing) : null,
					},
				};
			}
			const now = new Date().toISOString();
			const nextRevision = currentRevision + 1;
			stmts.upsertSetting.run(settingKey, JSON.stringify(input.value), nextRevision, now);
			const saved = rowToSetting(stmts.getSetting.get(settingKey));
			stmts.insertMutation.run(input.mutationId, input.deviceId, 200, JSON.stringify(saved), now);
			return { status: 200, body: saved };
		});
	}

	function importSnapshot(payload) {
		const { mode, snapshot } = payload;
		return runTransaction(() => {
			const now = new Date().toISOString();
			if (mode === 'replace') {
				db.exec('DELETE FROM drawings; DELETE FROM instrument_states; DELETE FROM app_settings; DELETE FROM sync_mutations;');
			}
			for (const item of snapshot.instruments) {
				const existing = stmts.getInstrument.get(item.venue, item.market, item.symbol);
				const nextRevision = mode === 'replace'
					? Math.max(1, item.revision)
					: (existing ? Math.max(Number(existing.revision), item.revision) + 1 : Math.max(1, item.revision));
				stmts.upsertInstrument.run(item.venue, item.market, item.symbol, item.timeframe, nextRevision, now);
			}
			for (const drawing of snapshot.drawings) {
				stmts.ensureInstrument.run(drawing.venue, drawing.market, drawing.symbol, now);
				const existing = stmts.getDrawing.get(drawing.id);
				if (existing && (existing.venue !== drawing.venue || existing.market !== drawing.market || existing.symbol !== drawing.symbol)) {
					continue;
				}
				const nextRevision = mode === 'replace'
					? Math.max(1, drawing.revision)
					: (existing ? Math.max(Number(existing.revision), drawing.revision) + 1 : Math.max(1, drawing.revision));
				const deletedFlag = drawing.deleted ? 1 : 0;
				const deletedAt = deletedFlag ? (existing?.deleted_at ?? now) : null;
				stmts.upsertDrawing.run(
					drawing.id,
					drawing.venue,
					drawing.market,
					drawing.symbol,
					drawing.schemaVersion,
					drawing.kind,
					JSON.stringify(drawing.anchors),
					JSON.stringify(drawing.style),
					nextRevision,
					deletedFlag,
					deletedAt,
					now,
				);
			}
			for (const setting of snapshot.settings) {
				const existing = stmts.getSetting.get(setting.key);
				const nextRevision = mode === 'replace'
					? Math.max(1, setting.revision)
					: (existing ? Math.max(Number(existing.revision), setting.revision) + 1 : Math.max(1, setting.revision));
				stmts.upsertSetting.run(setting.key, JSON.stringify(setting.value), nextRevision, now);
			}
			return getSnapshot();
		});
	}

	/** Online consistent single-file SQLite backup via VACUUM INTO (safe while WAL is active). */
	function createSqliteBackup(targetPath) {
		if (existsSync(targetPath)) unlinkSync(targetPath);
		db.prepare('VACUUM INTO ?').run(targetPath);
	}

	function healthCheck() {
		const row = stmts.health.get();
		return Boolean(row && row.ok === 1);
	}

	function close() {
		db.close();
	}

	return {
		storeId,
		getSnapshot,
		putPreference,
		putDrawing,
		putSetting,
		importSnapshot,
		createSqliteBackup,
		healthCheck,
		close,
	};
}
