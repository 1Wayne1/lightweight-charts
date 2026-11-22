-- Single-user self-hosted SQLite schema for Crypto Terminal sync & portable migration.
CREATE TABLE IF NOT EXISTS schema_migrations (
	version TEXT PRIMARY KEY,
	applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS store_meta (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS instrument_states (
	venue TEXT NOT NULL,
	market TEXT NOT NULL CHECK (market IN ('spot', 'perpetual')),
	symbol TEXT NOT NULL,
	timeframe TEXT NOT NULL DEFAULT '1h' CHECK (timeframe IN (
		'1m', '3m', '5m', '15m', '30m',
		'1h', '2h', '4h', '6h', '8h', '12h',
		'1d', '3d', '1w', '1M'
	)),
	revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
	updated_at TEXT NOT NULL,
	PRIMARY KEY (venue, market, symbol)
);

CREATE TABLE IF NOT EXISTS drawings (
	id TEXT PRIMARY KEY,
	venue TEXT NOT NULL,
	market TEXT NOT NULL,
	symbol TEXT NOT NULL,
	schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version = 1),
	kind TEXT NOT NULL,
	anchors TEXT NOT NULL,
	style TEXT NOT NULL,
	revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
	deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
	deleted_at TEXT,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (venue, market, symbol)
		REFERENCES instrument_states(venue, market, symbol)
);

CREATE INDEX IF NOT EXISTS drawings_instrument_idx
	ON drawings(venue, market, symbol);

CREATE TABLE IF NOT EXISTS app_settings (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL,
	revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
	updated_at TEXT NOT NULL
);

-- Persist mutation deduplication and its response in the same transaction as the write.
CREATE TABLE IF NOT EXISTS sync_mutations (
	mutation_id TEXT PRIMARY KEY,
	device_id TEXT NOT NULL,
	status_code INTEGER NOT NULL,
	response TEXT NOT NULL,
	created_at TEXT NOT NULL
);
