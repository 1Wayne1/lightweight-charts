import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { createMarketRelay, parseBinanceRestRoute } from './market-relay.mjs';
import {
	validateDrawingMutation,
	validateImportPayload,
	validatePreferenceMutation,
	validateSettingMutation,
} from './validate.mjs';

const MAX_MUTATION_BYTES = 2 * 1024 * 1024;
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

const MIME_TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'application/javascript; charset=utf-8',
	'.mjs': 'application/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.ico': 'image/x-icon',
	'.woff2': 'font/woff2',
	'.txt': 'text/plain; charset=utf-8',
};

export function isLoopbackBindHost(host) {
	return typeof host === 'string' && LOOPBACK_HOSTS.has(host.trim().toLowerCase());
}

function isLoopbackRemoteAddress(address) {
	if (typeof address !== 'string') return false;
	const normalized = address.trim().toLowerCase();
	return normalized === '127.0.0.1' || normalized === '::1' || normalized === '::ffff:127.0.0.1';
}

function parseLoopbackHostHeader(hostHeader) {
	if (typeof hostHeader !== 'string' || !hostHeader.trim()) return null;
	try {
		const parsed = new URL(`http://${hostHeader.trim()}`);
		if (!LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) return null;
		return parsed.host.toLowerCase();
	} catch {
		return null;
	}
}

function hasForwardedProxyHeaders(request) {
	return Boolean(
		request.headers['x-forwarded-for'] ||
		request.headers['x-forwarded-host'] ||
		request.headers.forwarded
	);
}

function isTrustedLocalRequest(request, requireLocalHeader) {
	if (!isLoopbackRemoteAddress(request.socket?.remoteAddress)) return false;
	if (hasForwardedProxyHeaders(request)) return false;
	const normalizedHost = parseLoopbackHostHeader(request.headers.host);
	if (!normalizedHost) return false;

	const origin = request.headers.origin;
	if (typeof origin === 'string' && origin.trim()) {
		try {
			const parsedOrigin = new URL(origin.trim());
			if (parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:') return false;
			if (parsedOrigin.host.toLowerCase() !== normalizedHost) return false;
		} catch {
			return false;
		}
	}

	const fetchSite = request.headers['sec-fetch-site'];
	if (typeof fetchSite === 'string' && fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
		return false;
	}

	if (requireLocalHeader && request.headers['x-terminal-local'] !== '1') {
		return false;
	}
	return true;
}

function hashToken(value) {
	return createHash('sha256').update(String(value), 'utf8').digest();
}

function sendJson(response, statusCode, body) {
	response.setHeader('Content-Type', 'application/json; charset=utf-8');
	response.setHeader('Cache-Control', 'no-store');
	response.setHeader('X-Content-Type-Options', 'nosniff');
	response.writeHead(statusCode);
	response.end(JSON.stringify(body));
}

async function readJsonBody(request, maxBytes) {
	const chunks = [];
	let total = 0;
	for await (const chunk of request) {
		total += chunk.length;
		if (total > maxBytes) {
			const error = new Error('Payload too large');
			error.statusCode = 413;
			throw error;
		}
		chunks.push(chunk);
	}
	const text = Buffer.concat(chunks).toString('utf8');
	if (!text.trim()) {
		const error = new Error('Empty request body');
		error.statusCode = 400;
		throw error;
	}
	try {
		return JSON.parse(text);
	} catch {
		const error = new Error('Invalid JSON');
		error.statusCode = 400;
		throw error;
	}
}

function safeDecode(segment) {
	try {
		return decodeURIComponent(segment);
	} catch {
		const error = new Error('Invalid URL encoding');
		error.statusCode = 400;
		throw error;
	}
}

function serveStaticFile(response, staticRoot, pathname, method) {
	const root = resolve(staticRoot);
	const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
	const cleanPath = pathname === '/' ? '/index.html' : pathname;
	let candidate = resolve(root, `.${cleanPath}`);
	if (candidate !== root && !candidate.startsWith(rootPrefix)) {
		sendJson(response, 403, { error: 'forbidden' });
		return true;
	}
	if (!existsSync(candidate) || !statSync(candidate).isFile()) {
		if (!extname(cleanPath)) {
			candidate = join(root, 'index.html');
		}
		if (!existsSync(candidate) || !statSync(candidate).isFile()) {
			return false;
		}
	}
	const ext = extname(candidate).toLowerCase();
	const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
	const isImmutableAsset = cleanPath.startsWith('/assets/');
	response.setHeader('Content-Type', contentType);
	response.setHeader('X-Content-Type-Options', 'nosniff');
	response.setHeader('Cache-Control', isImmutableAsset ? 'public, max-age=31536000, immutable' : 'no-cache');
	response.writeHead(200);
	if (method === 'HEAD') {
		response.end();
		return true;
	}
	response.end(readFileSync(candidate));
	return true;
}

/**
 * Reusable HTTP + WebSocket request handler for single-user SQLite sync, backup, and allowlisted Binance market relay.
 * Supports both Bearer token auth (remote/Docker/LAN) and strict same-origin loopback auth (local single-service mode).
 * Returns true if the request was handled, false when fallbackNotFound is false and the path is not owned by the API.
 */
export function createSyncRequestHandler(options = {}) {
	const {
		store,
		token,
		authMode = 'token',
		staticDir,
		corsOrigin = authMode === 'local' ? '' : '*',
		fallbackNotFound = true,
		marketRelay: marketRelayOption,
	} = options;
	if (!store) throw new Error('createSyncRequestHandler requires a SQLite store instance');
	if (authMode !== 'token' && authMode !== 'local') {
		throw new Error('authMode must be "token" or "local"');
	}
	if (authMode === 'token' && (typeof token !== 'string' || token.length < 8)) {
		throw new Error('createApp requires a SYNC_TOKEN of at least 8 characters');
	}
	const expectedTokenHash = authMode === 'token' ? hashToken(token) : null;
	const hasStaticWeb = Boolean(staticDir && existsSync(join(staticDir, 'index.html')));

	const ownsRelay = marketRelayOption !== false && !(marketRelayOption && typeof marketRelayOption.fetchBinanceRest === 'function');
	const relay = marketRelayOption === false
		? null
		: (marketRelayOption && typeof marketRelayOption.fetchBinanceRest === 'function'
			? marketRelayOption
			: createMarketRelay(marketRelayOption ?? {}));

	function applyCors(response) {
		if (authMode === 'local' || !corsOrigin) return;
		response.setHeader('Access-Control-Allow-Origin', corsOrigin);
		response.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS');
		response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Terminal-Local');
		response.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Retry-After, X-MBX-Used-Weight-1M, X-Terminal-Cache');
	}

	function isAuthorized(request) {
		if (authMode === 'local') {
			return isTrustedLocalRequest(request, true);
		}
		const header = request.headers.authorization;
		if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
		const provided = header.slice('Bearer '.length).trim();
		if (!provided) return false;
		return timingSafeEqual(hashToken(provided), expectedTokenHash);
	}

	function authorizeUpgrade(request, ticket) {
		if (authMode === 'local') {
			return isTrustedLocalRequest(request, false) ? { ok: true, statusCode: 200 } : { ok: false, statusCode: 403 };
		}
		if (!relay) return { ok: false, statusCode: 404 };
		return relay.consumeWsTicket(ticket) ? { ok: true, statusCode: 200 } : { ok: false, statusCode: 401 };
	}

	async function handleRequest(request, response) {
		const method = request.method ?? 'GET';
		const url = new URL(request.url ?? '/', 'http://localhost');
		const pathname = url.pathname;
		const isApiRoute = pathname === '/health/live' || pathname === '/health/ready' || pathname.startsWith('/v1/');

		if (!isApiRoute && !hasStaticWeb && !fallbackNotFound) {
			return false;
		}

		applyCors(response);

		if (method === 'OPTIONS' && isApiRoute) {
			if (authMode === 'local' && !isTrustedLocalRequest(request, false)) {
				sendJson(response, 403, { error: 'forbidden' });
				return true;
			}
			response.writeHead(204);
			response.end();
			return true;
		}

		try {
			// Public operational endpoints (never expose user data or tokens).
			if (pathname === '/health/live') {
				if (method !== 'GET') {
					response.setHeader('Allow', 'GET');
					sendJson(response, 405, { error: 'method_not_allowed' });
					return true;
				}
				sendJson(response, 200, { status: 'ok', service: 'terminal-sync', stage: 'ready' });
				return true;
			}

			if (pathname === '/health/ready') {
				if (method !== 'GET') {
					response.setHeader('Allow', 'GET');
					sendJson(response, 405, { error: 'method_not_allowed' });
					return true;
				}
				try {
					if (!store.healthCheck()) throw new Error('store_unhealthy');
					sendJson(response, 200, { status: 'ready', storage: 'sqlite', storeId: store.storeId });
				} catch {
					sendJson(response, 503, { status: 'not_ready', storage: 'sqlite' });
				}
				return true;
			}

			if (pathname === '/v1/capabilities') {
				if (method !== 'GET') {
					response.setHeader('Allow', 'GET');
					sendJson(response, 405, { error: 'method_not_allowed' });
					return true;
				}
				if (authMode === 'local' && !isTrustedLocalRequest(request, false)) {
					sendJson(response, 403, { error: 'forbidden' });
					return true;
				}
				sendJson(response, 200, {
					apiVersion: 1,
					mode: 'single-user',
					storage: 'sqlite',
					storeId: store.storeId,
					authentication: authMode,
					sync: true,
					backup: true,
					staticWeb: hasStaticWeb,
					marketRelay: {
						enabled: Boolean(relay),
						binance: Boolean(relay),
					},
				});
				return true;
			}

			// All other /v1/* routes require authentication (Bearer token or strict same-origin local loopback).
			if (pathname.startsWith('/v1/')) {
				if (!isAuthorized(request)) {
					if (authMode === 'token') {
						response.setHeader('WWW-Authenticate', 'Bearer realm="crypto-terminal"');
						sendJson(response, 401, { error: 'unauthorized' });
					} else {
						sendJson(response, 403, { error: 'forbidden', message: 'Local storage API only accepts same-origin loopback requests' });
					}
					return true;
				}

				if (pathname === '/v1/market/ws-ticket') {
					if (!relay) {
						sendJson(response, 404, { error: 'market_relay_disabled' });
						return true;
					}
					if (method !== 'POST') {
						response.setHeader('Allow', 'POST');
						sendJson(response, 405, { error: 'method_not_allowed' });
						return true;
					}
					sendJson(response, 200, relay.issueWsTicket());
					return true;
				}

				if (pathname.startsWith('/v1/market/binance/')) {
					if (!relay) {
						sendJson(response, 404, { error: 'market_relay_disabled' });
						return true;
					}
					if (method !== 'GET') {
						response.setHeader('Allow', 'GET');
						sendJson(response, 405, { error: 'method_not_allowed' });
						return true;
					}
					const route = parseBinanceRestRoute(pathname, url.searchParams);
					if (!route) {
						sendJson(response, 404, { error: 'not_found' });
						return true;
					}
					const controller = new AbortController();
					const onClose = () => {
						if (!response.writableEnded) controller.abort(new Error('Client disconnected'));
					};
					request.once('close', onClose);
					try {
						const upstream = await relay.fetchBinanceRest(route, controller.signal);
						response.setHeader('Content-Type', upstream.contentType);
						response.setHeader('Cache-Control', 'no-store');
						response.setHeader('X-Content-Type-Options', 'nosniff');
						response.setHeader('X-Terminal-Cache', upstream.cacheHit ? 'HIT' : 'MISS');
						if (upstream.retryAfter) response.setHeader('Retry-After', upstream.retryAfter);
						if (upstream.usedWeight) response.setHeader('X-MBX-Used-Weight-1M', upstream.usedWeight);
						response.writeHead(upstream.status);
						response.end(upstream.body);
					} catch (error) {
						if (controller.signal.aborted) return true;
						const message = error instanceof Error ? error.message : 'Upstream market relay error';
						sendJson(response, 502, { error: 'upstream_error', message });
					} finally {
						request.removeListener('close', onClose);
					}
					return true;
				}

				if (pathname === '/v1/snapshot' || pathname === '/v1/instruments') {
					if (method !== 'GET') {
						response.setHeader('Allow', 'GET');
						sendJson(response, 405, { error: 'method_not_allowed' });
						return true;
					}
					sendJson(response, 200, store.getSnapshot());
					return true;
				}

				if (pathname === '/v1/backup/sqlite') {
					if (method !== 'GET') {
						response.setHeader('Allow', 'GET');
						sendJson(response, 405, { error: 'method_not_allowed' });
						return true;
					}
					const tempFile = join(tmpdir(), `terminal-backup-${randomUUID()}.db`);
					try {
						store.createSqliteBackup(tempFile);
						const data = readFileSync(tempFile);
						const stamp = new Date().toISOString().slice(0, 10);
						response.setHeader('Content-Type', 'application/vnd.sqlite3');
						response.setHeader('Content-Disposition', `attachment; filename="terminal-${stamp}.db"`);
						response.setHeader('Cache-Control', 'no-store');
						response.setHeader('X-Content-Type-Options', 'nosniff');
						response.writeHead(200);
						response.end(data);
					} finally {
						if (existsSync(tempFile)) unlinkSync(tempFile);
					}
					return true;
				}

				if (pathname === '/v1/import') {
					if (method !== 'POST') {
						response.setHeader('Allow', 'POST');
						sendJson(response, 405, { error: 'method_not_allowed' });
						return true;
					}
					const body = await readJsonBody(request, MAX_IMPORT_BYTES);
					const validated = validateImportPayload(body);
					const snapshot = store.importSnapshot(validated);
					sendJson(response, 200, snapshot);
					return true;
				}

				const prefMatch = /^\/v1\/instruments\/([^/]+)\/preferences$/.exec(pathname);
				if (prefMatch) {
					if (method !== 'PUT') {
						response.setHeader('Allow', 'PUT');
						sendJson(response, 405, { error: 'method_not_allowed' });
						return true;
					}
					const key = safeDecode(prefMatch[1]);
					const body = await readJsonBody(request, MAX_MUTATION_BYTES);
					const validated = validatePreferenceMutation(body);
					const result = store.putPreference(key, validated);
					sendJson(response, result.status, result.body);
					return true;
				}

				const drawingMatch = /^\/v1\/instruments\/([^/]+)\/drawings\/([^/]+)$/.exec(pathname);
				if (drawingMatch) {
					if (method !== 'PUT') {
						response.setHeader('Allow', 'PUT');
						sendJson(response, 405, { error: 'method_not_allowed' });
						return true;
					}
					const key = safeDecode(drawingMatch[1]);
					const drawingId = safeDecode(drawingMatch[2]);
					const body = await readJsonBody(request, MAX_MUTATION_BYTES);
					const validated = validateDrawingMutation(body, key, drawingId);
					const result = store.putDrawing(key, drawingId, validated);
					sendJson(response, result.status, result.body);
					return true;
				}

				const settingMatch = /^\/v1\/settings\/([^/]+)$/.exec(pathname);
				if (settingMatch) {
					if (method !== 'PUT') {
						response.setHeader('Allow', 'PUT');
						sendJson(response, 405, { error: 'method_not_allowed' });
						return true;
					}
					const settingKey = safeDecode(settingMatch[1]);
					const body = await readJsonBody(request, MAX_MUTATION_BYTES);
					const validated = validateSettingMutation(settingKey, body);
					const result = store.putSetting(settingKey, validated);
					sendJson(response, result.status, result.body);
					return true;
				}

				sendJson(response, 404, { error: 'not_found' });
				return true;
			}

			// Optional single-container / unified local static web app serving.
			if (hasStaticWeb && (method === 'GET' || method === 'HEAD')) {
				if (serveStaticFile(response, staticDir, pathname, method)) return true;
			}

			if (!fallbackNotFound) return false;
			sendJson(response, 404, { error: 'not_found' });
			return true;
		} catch (error) {
			const statusCode = typeof error?.statusCode === 'number' ? error.statusCode : 400;
			const message = error instanceof Error ? error.message : 'invalid_request';
			sendJson(response, statusCode, { error: statusCode === 413 ? 'payload_too_large' : 'bad_request', message });
			return true;
		}
	}

	handleRequest.handleUpgrade = (request, socket, head) => {
		if (!relay) return false;
		return relay.handleUpgrade(request, socket, head, authorizeUpgrade);
	};

	handleRequest.close = () => {
		if (ownsRelay && relay) relay.close();
	};

	return handleRequest;
}

/**
 * Single-user self-hosted sync, backup, and market relay HTTP/WS server backed by SQLite.
 * Optionally serves the built terminal web bundle from staticDir for single-container or local unified deployment.
 */
export function createApp(options = {}) {
	const handler = createSyncRequestHandler({ ...options, fallbackNotFound: true });
	const server = createServer((request, response) => {
		void handler(request, response);
	});
	server.on('upgrade', (request, socket, head) => {
		if (!handler.handleUpgrade(request, socket, head)) {
			socket.destroy();
		}
	});
	server.on('close', () => {
		handler.close();
	});
	return server;
}
