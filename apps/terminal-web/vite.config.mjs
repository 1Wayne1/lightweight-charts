import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { createSyncRequestHandler } from '../../services/sync-api/src/app.mjs';
import { createMarketRelay } from '../../services/sync-api/src/market-relay.mjs';
import { openStore } from '../../services/sync-api/src/store.mjs';

const webDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(webDir, '../..');
const defaultDbPath = resolve(repoRoot, 'deploy/terminal/data/terminal.db');

/**
 * Mounts the local SQLite sync, backup, and Binance market relay API directly on the Vite dev server
 * so `pnpm dev:terminal` boots web UI + local storage + market relay in a single service.
 */
function terminalLocalSyncPlugin() {
	return {
		name: 'terminal-local-sync',
		configureServer(server) {
			if (process.env.TERMINAL_DISABLE_LOCAL_SYNC === '1') return;
			const dbPath = resolve(process.env.DB_PATH ?? defaultDbPath);
			const explicitToken = process.env.SYNC_TOKEN?.trim() ?? '';
			const authMode = explicitToken.length >= 8 ? 'token' : 'local';
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
			const handleSync = createSyncRequestHandler({
				store,
				token: explicitToken,
				authMode,
				corsOrigin: authMode === 'local' ? '' : (process.env.CORS_ORIGIN ?? '*'),
				fallbackNotFound: false,
				marketRelay,
			});

			server.middlewares.use((request, response, next) => {
				const rawUrl = request.url ?? '/';
				if (!rawUrl.startsWith('/v1/') && rawUrl !== '/health/live' && rawUrl !== '/health/ready') {
					next();
					return;
				}
				void handleSync(request, response).then(handled => {
					if (!handled) next();
				}).catch(next);
			});

			server.httpServer?.on('upgrade', (request, socket, head) => {
				// Only intercept /v1/market/binance/*/stream; leave Vite HMR websocket untouched.
				handleSync.handleUpgrade(request, socket, head);
			});

			let closed = false;
			const cleanup = () => {
				if (closed) return;
				closed = true;
				try {
					handleSync.close();
					marketRelay.close();
					store.close();
				} catch {
					// Ignore close errors during dev server shutdown.
				}
			};
			server.httpServer?.once('close', cleanup);
			process.once('exit', cleanup);

			const proxyNote = marketRelay.proxyConfigured ? ', relay: binance (via proxy)' : ', relay: binance (direct)';
			server.config.logger.info(
				`[terminal-local-sync] Embedded SQLite & market relay ready (auth: ${authMode}, db: ${dbPath}${proxyNote})`,
				{ timestamp: true },
			);
		},
	};
}

export default defineConfig({
	plugins: [terminalLocalSyncPlugin()],
});
