-- Initial storage contract; the scaffold API does not connect to these tables yet.
BEGIN;

CREATE TABLE app_users (
    id uuid PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE instrument_states (
    user_id uuid NOT NULL REFERENCES app_users(id),
    venue text NOT NULL CHECK (venue ~ '^[a-z0-9-]+$'),
    market text NOT NULL CHECK (market IN ('spot', 'perpetual')),
    symbol text NOT NULL CHECK (symbol ~ '^[A-Z0-9]+-[A-Z0-9]+$'),
    timeframe text NOT NULL DEFAULT '1h' CHECK (timeframe IN ('1m', '5m', '15m', '1h', '4h', '1d')),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, venue, market, symbol)
);

CREATE TABLE drawings (
    user_id uuid NOT NULL,
    id uuid NOT NULL,
    venue text NOT NULL,
    market text NOT NULL,
    symbol text NOT NULL,
    schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    deleted_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, id),
    FOREIGN KEY (user_id, venue, market, symbol)
        REFERENCES instrument_states(user_id, venue, market, symbol)
);

CREATE INDEX drawings_instrument_idx ON drawings(user_id, venue, market, symbol);

-- Persist mutation deduplication and its response in the same transaction as the write.
CREATE TABLE sync_mutations (
    user_id uuid NOT NULL REFERENCES app_users(id),
    mutation_id uuid NOT NULL,
    device_id uuid NOT NULL,
    response jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, mutation_id)
);

COMMIT;
