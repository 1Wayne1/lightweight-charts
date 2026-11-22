import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import {
	validateDrawingMutation,
	validateImportPayload,
	validatePreferenceMutation,
	validateSettingMutation,
} from './validate.mjs';

const MAX_MUTATION_BYTES = 2 * 1024 * 1024;
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

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
 * Single-user self-hosted sync & backup HTTP server backed by SQLite.
 * Optionally serves the built terminal web bundle from staticDir for single-container Docker deployment.
 */
export function createApp(options = {}) {
	const { store, token, staticDir, corsOrigin = '*' } = options;
	if (!store) throw new Error('createApp requires a SQLite store instance');
	if (typeof token !== 'string' || token.length < 8) {
		throw new Error('createApp requires a SYNC_TOKEN of at least 8 characters');
	}
	const expectedTokenHash = hashToken(token);
	const hasStaticWeb = Boolean(staticDir && existsSync(join(staticDir, 'index.html')));

	function applyCors(response) {
		if (!corsOrigin) return;
		response.setHeader('Access-Control-Allow-Origin', corsOrigin);
		response.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS');
		response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
		response.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
	}

	function isAuthorized(request) {
		const header = request.headers.authorization;
		if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
		const provided = header.slice('Bearer '.length).trim();
		if (!provided) return false;
		return timingSafeEqual(hashToken(provided), expectedTokenHash);
	}

	return createServer(async (request, response) => {
		applyCors(response);
		const method = request.method ?? 'GET';
		const url = new URL(request.url ?? '/', 'http://localhost');
		const pathname = url.pathname;

		if (method === 'OPTIONS') {
			response.writeHead(204);
			response.end();
			return;
		}

		try {
			// Public operational endpoints (never expose user data or tokens).
			if (pathname === '/health/live') {
				if (method !== 'GET') {
					response.setHeader('Allow', 'GET');
					sendJson(response, 405, { error: 'method_not_allowed' });
					return;
				}
				sendJson(response, 200, { status: 'ok', service: 'terminal-sync', stage: 'ready' });
				return;
			}

			if (pathname === '/health/ready') {
				if (method !== 'GET') {
					response.setHeader('Allow', 'GET');
					sendJson(response, 405, { error: 'method_not_allowed' });
					return;
				}
				try {
					if (!store.healthCheck()) throw new Error('store_unhealthy');
					sendJson(response, 200, { status: 'ready', storage: 'sqlite', storeId: store.storeId });
				} catch {
					sendJson(response, 503, { status: 'not_ready', storage: 'sqlite' });
				}
				return;
			}

			if (pathname === '/v1/capabilities') {
				if (method !== 'GET') {
					response.setHeader('Allow', 'GET');
					sendJson(response, 405, { error: 'method_not_allowed' });
					return;
				}
				sendJson(response, 200, {
					apiVersion: 1,
					mode: 'single-user',
					storage: 'sqlite',
					storeId: store.storeId,
					authentication: 'token',
					sync: true,
					backup: true,
					staticWeb: hasStaticWeb,
				});
				return;
			}

			// All other /v1/* routes require single-user Bearer token authentication.
			if (pathname.startsWith('/v1/')) {
				if (!isAuthorized(request)) {
					response.setHeader('WWW-Authenticate', 'Bearer realm="crypto-terminal"');
					sendJson(response, 401, { error: 'unauthorized' });
					return;
				}

				if (pathname === '/v1/snapshot' || pathname === '/v1/instruments') {
					if (method !== 'GET') {
						response.setHeader('Allow', 'GET');
						sendJson(response, 405, { error: 'method_not_allowed' });
						return;
					}
					sendJson(response, 200, store.getSnapshot());
					return;
				}

				if (pathname === '/v1/backup/sqlite') {
					if (method !== 'GET') {
						response.setHeader('Allow', 'GET');
						sendJson(response, 405, { error: 'method_not_allowed' });
						return;
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
					return;
				}

				if (pathname === '/v1/import') {
					if (method !== 'POST') {
						response.setHeader('Allow', 'POST');
						sendJson(response, 405, { error: 'method_not_allowed' });
						return;
					}
					const body = await readJsonBody(request, MAX_IMPORT_BYTES);
					const validated = validateImportPayload(body);
					const snapshot = store.importSnapshot(validated);
					sendJson(response, 200, snapshot);
					return;
				}

				const prefMatch = /^\/v1\/instruments\/([^/]+)\/preferences$/.exec(pathname);
				if (prefMatch) {
					if (method !== 'PUT') {
						response.setHeader('Allow', 'PUT');
						sendJson(response, 405, { error: 'method_not_allowed' });
						return;
					}
					const key = safeDecode(prefMatch[1]);
					const body = await readJsonBody(request, MAX_MUTATION_BYTES);
					const validated = validatePreferenceMutation(body);
					const result = store.putPreference(key, validated);
					sendJson(response, result.status, result.body);
					return;
				}

				const drawingMatch = /^\/v1\/instruments\/([^/]+)\/drawings\/([^/]+)$/.exec(pathname);
				if (drawingMatch) {
					if (method !== 'PUT') {
						response.setHeader('Allow', 'PUT');
						sendJson(response, 405, { error: 'method_not_allowed' });
						return;
					}
					const key = safeDecode(drawingMatch[1]);
					const drawingId = safeDecode(drawingMatch[2]);
					const body = await readJsonBody(request, MAX_MUTATION_BYTES);
					const validated = validateDrawingMutation(body, key, drawingId);
					const result = store.putDrawing(key, drawingId, validated);
					sendJson(response, result.status, result.body);
					return;
				}

				const settingMatch = /^\/v1\/settings\/([^/]+)$/.exec(pathname);
				if (settingMatch) {
					if (method !== 'PUT') {
						response.setHeader('Allow', 'PUT');
						sendJson(response, 405, { error: 'method_not_allowed' });
						return;
					}
					const settingKey = safeDecode(settingMatch[1]);
					const body = await readJsonBody(request, MAX_MUTATION_BYTES);
					const validated = validateSettingMutation(settingKey, body);
					const result = store.putSetting(settingKey, validated);
					sendJson(response, result.status, result.body);
					return;
				}

				sendJson(response, 404, { error: 'not_found' });
				return;
			}

			// Optional single-container static web app serving.
			if (hasStaticWeb && (method === 'GET' || method === 'HEAD')) {
				if (serveStaticFile(response, staticDir, pathname, method)) return;
			}

			sendJson(response, 404, { error: 'not_found' });
		} catch (error) {
			const statusCode = typeof error?.statusCode === 'number' ? error.statusCode : 400;
			const message = error instanceof Error ? error.message : 'invalid_request';
			sendJson(response, statusCode, { error: statusCode === 413 ? 'payload_too_large' : 'bad_request', message });
		}
	});
}
