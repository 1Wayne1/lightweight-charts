import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.mjs';
import { openStore } from './store.mjs';

const serviceDir = dirname(fileURLToPath(import.meta.url));
const repoDeployDir = resolve(serviceDir, '../../../deploy/terminal');
const defaultEnvFile = resolve(repoDeployDir, '.env');

// Convenience for local `pnpm dev:sync`: load deploy/terminal/.env if present without overriding explicit env vars.
if (!process.env.SYNC_TOKEN && existsSync(defaultEnvFile) && typeof process.loadEnvFile === 'function') {
	try {
		process.loadEnvFile(defaultEnvFile);
	} catch {
		// Ignore malformed optional local .env file and surface explicit validation below.
	}
}

const port = Number(process.env.PORT ?? process.env.SYNC_PORT ?? '8080');
if (!Number.isInteger(port) || port < 1 || port > 65535) {
	throw new Error('PORT must be an integer between 1 and 65535');
}
const host = process.env.HOST ?? process.env.SYNC_BIND ?? '127.0.0.1';
const token = process.env.SYNC_TOKEN?.trim() ?? '';
if (token.length < 8) {
	throw new Error('SYNC_TOKEN must be set to at least 8 characters (via env var or deploy/terminal/.env; never commit tokens to git)');
}
const defaultDbPath = existsSync(repoDeployDir)
	? resolve(repoDeployDir, 'data/terminal.db')
	: resolve('./data/terminal.db');
const dbPath = resolve(process.env.DB_PATH ?? defaultDbPath);
const staticDir = process.env.STATIC_DIR ? resolve(process.env.STATIC_DIR) : undefined;
const corsOrigin = process.env.CORS_ORIGIN ?? '*';

const store = openStore(dbPath);
const app = createApp({ store, token, staticDir, corsOrigin });

app.listen(port, host, () => {
	// Never log SYNC_TOKEN.
	console.log(`Crypto Terminal sync service listening on http://${host}:${port} (db: ${dbPath}${staticDir ? `, web: ${staticDir}` : ''})`);
});

let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
	process.once(signal, () => {
		if (closing) return;
		closing = true;
		app.close(error => {
			try {
				store.close();
			} catch {
				// Ignore close error on shutdown.
			}
			process.exit(error ? 1 : 0);
		});
		setTimeout(() => process.exit(1), 5000).unref();
	});
}
