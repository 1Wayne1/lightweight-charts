import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, isLoopbackBindHost } from './app.mjs';
import { createMarketRelay } from './market-relay.mjs';
import { openStore } from './store.mjs';

const serviceDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(serviceDir, '../../..');
const repoDeployDir = resolve(repoRoot, 'deploy/terminal');
const defaultEnvFile = resolve(repoDeployDir, '.env');
const explicitAuthMode = process.env.SYNC_AUTH_MODE?.trim().toLowerCase() ?? '';

// Load deploy/terminal/.env automatically unless explicitly running in zero-config local loopback mode.
if (explicitAuthMode !== 'local' && !process.env.SYNC_TOKEN && existsSync(defaultEnvFile) && typeof process.loadEnvFile === 'function') {
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
const token = explicitAuthMode === 'local' ? '' : (process.env.SYNC_TOKEN?.trim() ?? '');
const isLoopback = isLoopbackBindHost(host);

let authMode;
if (explicitAuthMode === 'local') {
	if (!isLoopback) {
		throw new Error('SYNC_AUTH_MODE=local is only allowed when binding a loopback address (127.0.0.1 / localhost / ::1)');
	}
	authMode = 'local';
} else if (explicitAuthMode === 'token' || token.length > 0 || !isLoopback) {
	if (token.length < 8) {
		throw new Error('SYNC_TOKEN must be set to at least 8 characters when binding non-loopback addresses or in token mode (via env var or deploy/terminal/.env; never commit tokens to git)');
	}
	authMode = 'token';
} else {
	authMode = 'local';
}

const defaultDbPath = existsSync(repoDeployDir)
	? resolve(repoDeployDir, 'data/terminal.db')
	: resolve('./data/terminal.db');
const dbPath = resolve(process.env.DB_PATH ?? defaultDbPath);

const defaultStaticDir = resolve(repoRoot, 'apps/terminal-web/dist');
let staticDir;
if (process.env.STATIC_DIR === 'none') {
	staticDir = undefined;
} else if (process.env.STATIC_DIR) {
	staticDir = resolve(process.env.STATIC_DIR);
} else if (existsSync(join(defaultStaticDir, 'index.html'))) {
	staticDir = defaultStaticDir;
}
const corsOrigin = authMode === 'local' ? '' : (process.env.CORS_ORIGIN ?? '*');

const marketProxyUrl = (
	process.env.MARKET_PROXY_URL ??
	process.env.HTTPS_PROXY ??
	process.env.https_proxy ??
	process.env.HTTP_PROXY ??
	process.env.http_proxy ??
	''
).trim();
const marketRelay = createMarketRelay({
	proxyUrl: marketProxyUrl,
	endpoints: {
		spotRest: process.env.BINANCE_SPOT_REST || undefined,
		perpetualRest: process.env.BINANCE_PERPETUAL_REST || undefined,
		spotWs: process.env.BINANCE_SPOT_WS || undefined,
		perpetualWs: process.env.BINANCE_PERPETUAL_WS || undefined,
	},
});

const store = openStore(dbPath);
const app = createApp({ store, token, authMode, staticDir, corsOrigin, marketRelay });

app.listen(port, host, () => {
	// Never log SYNC_TOKEN or proxy credentials.
	const webNote = staticDir ? `, web: ${staticDir}` : ', web: disabled (run pnpm build:terminal to enable)';
	const relayNote = marketRelay.proxyConfigured ? ', relay: binance (via proxy)' : ', relay: binance (direct)';
	console.log(`Crypto Terminal listening on http://${host}:${port} (auth: ${authMode}, db: ${dbPath}${relayNote}${webNote})`);
});

let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
	process.once(signal, () => {
		if (closing) return;
		closing = true;
		marketRelay.close();
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
