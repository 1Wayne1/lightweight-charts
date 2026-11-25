import { randomBytes } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { WebSocket, WebSocketServer } from 'ws';

export const DEFAULT_BINANCE_UPSTREAMS = {
	spotRest: 'https://data-api.binance.vision',
	perpetualRest: 'https://fapi.binance.com',
	spotWs: 'wss://data-stream.binance.vision',
	perpetualWs: 'wss://fstream.binance.com/market',
};

const ALLOWED_REST_PATHS = {
	spot: new Set(['/api/v3/klines', '/api/v3/exchangeInfo', '/api/v3/ticker/24hr']),
	perpetual: new Set(['/fapi/v1/klines', '/fapi/v1/exchangeInfo', '/fapi/v1/ticker/24hr']),
};

const ALLOWED_QUERY_KEYS = new Set(['symbol', 'symbols', 'interval', 'limit', 'startTime', 'endTime']);
const STREAM_TOKEN_RE = /^[a-z0-9]{2,30}@(kline_(1m|3m|5m|15m|30m|1h|2h|4h|6h|8h|12h|1d|3d|1w|1M)|ticker)$/;
const EXCHANGE_INFO_TTL_MS = 10 * 60 * 1000;
const WS_TICKET_TTL_MS = 30 * 1000;
const MAX_WS_TICKETS = 256;
const MAX_WS_CONNECTIONS = 64;
const WS_HEARTBEAT_MS = 25 * 1000;
const REST_TIMEOUT_MS = 15 * 1000;

function normalizeBaseUrl(raw, allowedProtocols, label) {
	const trimmed = String(raw ?? '').trim().replace(/\/+$/, '');
	if (!trimmed) throw new Error(`${label} cannot be empty`);
	const parsed = new URL(trimmed);
	if (!allowedProtocols.includes(parsed.protocol)) {
		throw new Error(`${label} must use ${allowedProtocols.join(' or ')}`);
	}
	return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
}

/**
 * Lightweight HTTPS/WSS Agent that tunnels TLS connections over an HTTP CONNECT proxy
 * (e.g. local Clash/Mihomo http://127.0.0.1:7890) with zero extra proxy packages.
 */
export function createHttpsConnectAgent(proxyUrl) {
	const parsedProxy = new URL(proxyUrl);
	if (parsedProxy.protocol !== 'http:' && parsedProxy.protocol !== 'https:') {
		throw new Error('MARKET_PROXY_URL must use http:// or https://');
	}
	const proxyHost = parsedProxy.hostname;
	const proxyPort = Number(parsedProxy.port || (parsedProxy.protocol === 'https:' ? 443 : 80));
	const proxyAuth = parsedProxy.username || parsedProxy.password
		? `Basic ${Buffer.from(`${decodeURIComponent(parsedProxy.username)}:${decodeURIComponent(parsedProxy.password)}`).toString('base64')}`
		: undefined;

	class ConnectTunnelAgent extends https.Agent {
		createConnection(options, callback) {
			const targetHost = options.host || options.hostname;
			const targetPort = Number(options.port || 443);
			const authority = `${targetHost}:${targetPort}`;
			const headers = { Host: authority };
			if (proxyAuth) headers['Proxy-Authorization'] = proxyAuth;

			const reqFn = parsedProxy.protocol === 'https:' ? https.request : http.request;
			const proxyReq = reqFn({
				host: proxyHost,
				port: proxyPort,
				method: 'CONNECT',
				path: authority,
				headers,
				timeout: REST_TIMEOUT_MS,
			});

			let settled = false;
			const done = (error, socket) => {
				if (settled) return;
				settled = true;
				callback(error, socket);
			};

			proxyReq.once('connect', (proxyRes, rawSocket) => {
				if (proxyRes.statusCode !== 200) {
					rawSocket.destroy();
					done(new Error(`Proxy CONNECT rejected with HTTP ${proxyRes.statusCode}`));
					return;
				}
				const tlsSocket = tls.connect({
					socket: rawSocket,
					servername: options.servername || targetHost,
					rejectUnauthorized: options.rejectUnauthorized !== false,
				});
				tlsSocket.once('error', error => done(error));
				done(null, tlsSocket);
			});

			proxyReq.once('timeout', () => {
				proxyReq.destroy(new Error('Proxy CONNECT timeout'));
			});
			proxyReq.once('error', error => done(error));
			proxyReq.end();
			return undefined;
		}
	}

	return new ConnectTunnelAgent({ keepAlive: false });
}

function defaultUpstreamRestFetch(targetUrl, proxyUrl, signal) {
	const parsed = new URL(targetUrl);
	const isHttps = parsed.protocol === 'https:';
	const useProxy = Boolean(proxyUrl);

	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason ?? new Error('Aborted'));
			return;
		}

		let reqOptions;
		let requestFn;
		if (isHttps) {
			requestFn = https.request;
			reqOptions = {
				protocol: parsed.protocol,
				hostname: parsed.hostname,
				port: parsed.port || 443,
				path: `${parsed.pathname}${parsed.search}`,
				method: 'GET',
				headers: {
					Accept: 'application/json',
					'Accept-Encoding': 'identity',
					'User-Agent': 'CryptoTerminal-Relay/1.0',
				},
				timeout: REST_TIMEOUT_MS,
				...(useProxy ? { agent: createHttpsConnectAgent(proxyUrl) } : {}),
			};
		} else if (useProxy) {
			const parsedProxy = new URL(proxyUrl);
			requestFn = parsedProxy.protocol === 'https:' ? https.request : http.request;
			const headers = {
				Host: parsed.host,
				Accept: 'application/json',
				'Accept-Encoding': 'identity',
				'User-Agent': 'CryptoTerminal-Relay/1.0',
			};
			if (parsedProxy.username || parsedProxy.password) {
				headers['Proxy-Authorization'] = `Basic ${Buffer.from(`${decodeURIComponent(parsedProxy.username)}:${decodeURIComponent(parsedProxy.password)}`).toString('base64')}`;
			}
			reqOptions = {
				hostname: parsedProxy.hostname,
				port: Number(parsedProxy.port || (parsedProxy.protocol === 'https:' ? 443 : 80)),
				path: targetUrl,
				method: 'GET',
				headers,
				timeout: REST_TIMEOUT_MS,
			};
		} else {
			requestFn = http.request;
			reqOptions = {
				protocol: parsed.protocol,
				hostname: parsed.hostname,
				port: parsed.port || 80,
				path: `${parsed.pathname}${parsed.search}`,
				method: 'GET',
				headers: {
					Accept: 'application/json',
					'Accept-Encoding': 'identity',
					'User-Agent': 'CryptoTerminal-Relay/1.0',
				},
				timeout: REST_TIMEOUT_MS,
			};
		}

		const req = requestFn(reqOptions, res => {
			const chunks = [];
			res.on('data', chunk => chunks.push(chunk));
			res.on('end', () => {
				signal?.removeEventListener('abort', onAbort);
				const retryAfter = typeof res.headers['retry-after'] === 'string' ? res.headers['retry-after'] : undefined;
				const usedWeight = typeof res.headers['x-mbx-used-weight-1m'] === 'string' ? res.headers['x-mbx-used-weight-1m'] : undefined;
				resolve({
					status: res.statusCode ?? 502,
					contentType: typeof res.headers['content-type'] === 'string' ? res.headers['content-type'] : 'application/json; charset=utf-8',
					body: Buffer.concat(chunks),
					retryAfter,
					usedWeight,
				});
			});
			res.on('error', error => {
				signal?.removeEventListener('abort', onAbort);
				reject(error);
			});
		});

		const onAbort = () => {
			req.destroy(signal?.reason instanceof Error ? signal.reason : new Error('Aborted'));
		};
		signal?.addEventListener('abort', onAbort, { once: true });

		req.once('timeout', () => {
			req.destroy(new Error('Upstream market request timeout'));
		});
		req.once('error', error => {
			signal?.removeEventListener('abort', onAbort);
			reject(error);
		});
		req.end();
	});
}

export function validateBinanceStreamsParam(raw) {
	if (typeof raw !== 'string' || !raw.trim()) return null;
	const parts = raw.trim().split('/').filter(Boolean);
	if (parts.length === 0 || parts.length > 100) return null;
	const normalized = [];
	const seen = new Set();
	for (const part of parts) {
		if (!STREAM_TOKEN_RE.test(part)) return null;
		if (!seen.has(part)) {
			seen.add(part);
			normalized.push(part);
		}
	}
	return normalized.join('/');
}

export function parseBinanceRestRoute(pathname, searchParams) {
	const match = /^\/v1\/market\/binance\/(spot|perpetual)(\/.+)$/.exec(pathname);
	if (!match) return null;
	const market = match[1];
	const subPath = match[2];
	if (!ALLOWED_REST_PATHS[market].has(subPath)) return null;

	const filteredParams = new URLSearchParams();
	let totalLen = 0;
	for (const [key, value] of searchParams.entries()) {
		if (!ALLOWED_QUERY_KEYS.has(key)) continue;
		totalLen += key.length + value.length;
		if (totalLen > 4096) return null;
		filteredParams.append(key, value);
	}
	return { market, subPath, queryString: filteredParams.toString() };
}

export function parseBinanceWsRoute(pathname) {
	const match = /^\/v1\/market\/binance\/(spot|perpetual)\/stream$/.exec(pathname);
	if (!match) return null;
	return { market: match[1] };
}

function writeRawUpgradeError(socket, statusCode, statusText) {
	if (socket.destroyed) return;
	socket.write(`HTTP/1.1 ${statusCode} ${statusText}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${statusText.length}\r\n\r\n${statusText}`);
	socket.destroy();
}

/**
 * Strict allowlist REST & WebSocket market data relay for Binance public endpoints.
 * Keeps upstream hostnames server-controlled (preventing SSRF), caches exchangeInfo,
 * supports optional HTTP CONNECT proxy tunneling (e.g. local Clash), and uses one-time WS tickets in token mode.
 */
export function createMarketRelay(options = {}) {
	const endpoints = {
		spotRest: normalizeBaseUrl(options.endpoints?.spotRest ?? DEFAULT_BINANCE_UPSTREAMS.spotRest, ['http:', 'https:'], 'BINANCE_SPOT_REST'),
		perpetualRest: normalizeBaseUrl(options.endpoints?.perpetualRest ?? DEFAULT_BINANCE_UPSTREAMS.perpetualRest, ['http:', 'https:'], 'BINANCE_PERPETUAL_REST'),
		spotWs: normalizeBaseUrl(options.endpoints?.spotWs ?? DEFAULT_BINANCE_UPSTREAMS.spotWs, ['ws:', 'wss:'], 'BINANCE_SPOT_WS'),
		perpetualWs: normalizeBaseUrl(options.endpoints?.perpetualWs ?? DEFAULT_BINANCE_UPSTREAMS.perpetualWs, ['ws:', 'wss:'], 'BINANCE_PERPETUAL_WS'),
	};
	const proxyUrl = typeof options.proxyUrl === 'string' && options.proxyUrl.trim() ? options.proxyUrl.trim() : '';
	if (proxyUrl) {
		// Validate proxy URL upfront so misconfiguration surfaces immediately at startup.
		createHttpsConnectAgent(proxyUrl);
	}
	const restFetch = options.restFetch ?? ((url, signal) => defaultUpstreamRestFetch(url, proxyUrl, signal));
	const createUpstreamWs = options.createUpstreamWs ?? (url => {
		const isWss = url.startsWith('wss://');
		const wsOptions = {
			handshakeTimeout: REST_TIMEOUT_MS,
			...(isWss && proxyUrl ? { agent: createHttpsConnectAgent(proxyUrl) } : {}),
		};
		return new WebSocket(url, wsOptions);
	});
	const maxWsConnections = options.maxWsConnections ?? MAX_WS_CONNECTIONS;
	const exchangeInfoTtlMs = options.exchangeInfoTtlMs ?? EXCHANGE_INFO_TTL_MS;

	const exchangeInfoCache = new Map();
	const exchangeInfoInflight = new Map();
	const wsTickets = new Map();
	const activeBridges = new Set();
	const wss = new WebSocketServer({ noServer: true });

	function pruneExpiredTickets(now = Date.now()) {
		for (const [key, expiresAt] of wsTickets.entries()) {
			if (expiresAt <= now) wsTickets.delete(key);
		}
	}

	function issueWsTicket() {
		const now = Date.now();
		pruneExpiredTickets(now);
		while (wsTickets.size >= MAX_WS_TICKETS) {
			const oldest = wsTickets.keys().next().value;
			if (oldest === undefined) break;
			wsTickets.delete(oldest);
		}
		const ticket = randomBytes(24).toString('base64url');
		wsTickets.set(ticket, now + WS_TICKET_TTL_MS);
		return { ticket, expiresInMs: WS_TICKET_TTL_MS };
	}

	function consumeWsTicket(ticket) {
		if (typeof ticket !== 'string' || !ticket) return false;
		const now = Date.now();
		pruneExpiredTickets(now);
		const expiresAt = wsTickets.get(ticket);
		if (!expiresAt || expiresAt <= now) return false;
		wsTickets.delete(ticket);
		return true;
	}

	async function fetchBinanceRest(route, signal) {
		const upstreamBase = route.market === 'spot' ? endpoints.spotRest : endpoints.perpetualRest;
		const targetUrl = `${upstreamBase}${route.subPath}${route.queryString ? `?${route.queryString}` : ''}`;
		const isExchangeInfo = route.subPath.endsWith('/exchangeInfo') && !route.queryString;

		if (isExchangeInfo) {
			const cacheKey = `${route.market}:exchangeInfo`;
			const cached = exchangeInfoCache.get(cacheKey);
			if (cached && cached.expiresAt > Date.now()) {
				return { ...cached.response, cacheHit: true };
			}
			let inflight = exchangeInfoInflight.get(cacheKey);
			if (!inflight) {
				inflight = restFetch(targetUrl, undefined).then(res => {
					if (res.status === 200) {
						exchangeInfoCache.set(cacheKey, { response: res, expiresAt: Date.now() + exchangeInfoTtlMs });
					}
					return res;
				}).finally(() => {
					exchangeInfoInflight.delete(cacheKey);
				});
				exchangeInfoInflight.set(cacheKey, inflight);
			}
			const result = await inflight;
			return { ...result, cacheHit: false };
		}

		const result = await restFetch(targetUrl, signal);
		return { ...result, cacheHit: false };
	}

	function handleUpgrade(request, socket, head, authorizeUpgrade) {
		const url = new URL(request.url ?? '/', 'http://localhost');
		const wsRoute = parseBinanceWsRoute(url.pathname);
		if (!wsRoute) return false;

		const ticket = url.searchParams.get('ticket');
		const authResult = authorizeUpgrade(request, ticket);
		if (!authResult.ok) {
			writeRawUpgradeError(socket, authResult.statusCode, authResult.statusCode === 401 ? 'Unauthorized' : 'Forbidden');
			return true;
		}

		const streams = validateBinanceStreamsParam(url.searchParams.get('streams'));
		if (!streams) {
			writeRawUpgradeError(socket, 400, 'Bad Request');
			return true;
		}

		if (activeBridges.size >= maxWsConnections) {
			writeRawUpgradeError(socket, 503, 'Service Unavailable');
			return true;
		}

		const upstreamBase = wsRoute.market === 'spot' ? endpoints.spotWs : endpoints.perpetualWs;
		const upstreamUrl = `${upstreamBase}/stream?streams=${streams}`;

		wss.handleUpgrade(request, socket, head, clientWs => {
			let closed = false;
			let isAlive = true;
			let upstreamWs;

			const cleanup = (closeClient = false, code = 1011) => {
				if (closed) return;
				closed = true;
				clearInterval(heartbeat);
				activeBridges.delete(bridge);
				try {
					if (upstreamWs && (upstreamWs.readyState === WebSocket.OPEN || upstreamWs.readyState === WebSocket.CONNECTING)) {
						upstreamWs.close();
					}
				} catch {
					// Ignore upstream close errors.
				}
				if (closeClient && (clientWs.readyState === WebSocket.OPEN || clientWs.readyState === WebSocket.CONNECTING)) {
					try {
						clientWs.close(code);
					} catch {
						clientWs.terminate();
					}
				}
			};

			const bridge = { cleanup };
			activeBridges.add(bridge);

			clientWs.on('pong', () => { isAlive = true; });
			clientWs.on('close', () => cleanup(false));
			clientWs.on('error', () => cleanup(false));

			const heartbeat = setInterval(() => {
				if (!isAlive) {
					cleanup(true, 1001);
					return;
				}
				isAlive = false;
				try {
					if (clientWs.readyState === WebSocket.OPEN) clientWs.ping();
				} catch {
					cleanup(true, 1001);
				}
			}, WS_HEARTBEAT_MS);
			heartbeat.unref?.();

			try {
				upstreamWs = createUpstreamWs(upstreamUrl);
			} catch {
				cleanup(true, 1011);
				return;
			}

			upstreamWs.on('message', (data, isBinary) => {
				if (closed || clientWs.readyState !== WebSocket.OPEN) return;
				try {
					clientWs.send(isBinary ? data : data.toString());
				} catch {
					cleanup(true, 1011);
				}
			});
			upstreamWs.on('close', () => cleanup(true, 1011));
			upstreamWs.on('error', () => cleanup(true, 1011));
		});
		return true;
	}

	function close() {
		for (const bridge of [...activeBridges]) {
			bridge.cleanup(true, 1001);
		}
		activeBridges.clear();
		wsTickets.clear();
		exchangeInfoCache.clear();
		exchangeInfoInflight.clear();
		wss.close();
	}

	return {
		endpoints,
		proxyConfigured: Boolean(proxyUrl),
		issueWsTicket,
		consumeWsTicket,
		fetchBinanceRest,
		handleUpgrade,
		close,
	};
}
