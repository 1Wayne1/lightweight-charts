import {
	parseSyncSnapshot,
	type DrawingDocument,
	type SyncCapabilities,
	type SyncSettingKey,
	type SyncSnapshot,
	type SyncedDrawingRecord,
	type SyncedInstrumentState,
	type SyncedSettingRecord,
	type Timeframe,
} from '@terminal/domain';

export type FetchLike = typeof fetch;

export class SyncClientError extends Error {
	constructor(
		readonly kind: 'network' | 'auth' | 'http' | 'invalid',
		message: string,
		readonly status?: number,
	) {
		super(message);
		this.name = 'SyncClientError';
	}
}

export function normalizeServerUrl(input: string, fallbackOrigin?: string): string {
	const raw = input.trim().replace(/\/+$/, '');
	const target = raw || fallbackOrigin?.trim().replace(/\/+$/, '') || '';
	if (!target) throw new SyncClientError('invalid', '请填写同步服务地址');
	let parsed: URL;
	try {
		parsed = new URL(target);
	} catch {
		throw new SyncClientError('invalid', '同步服务地址格式无效，请以 http:// 或 https:// 开头');
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new SyncClientError('invalid', '同步服务仅支持 http:// 或 https:// 协议');
	}
	return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
}

async function requestRaw(
	url: string,
	init: RequestInit,
	fetcher: FetchLike,
	timeoutMs = 12000,
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetcher(url, { ...init, signal: controller.signal });
	} catch {
		throw new SyncClientError('network', '无法连接到同步服务（可能已关机或离线）');
	} finally {
		clearTimeout(timer);
	}
}

function authHeaders(token: string, json = true): Record<string, string> {
	const headers: Record<string, string> = {
		Authorization: `Bearer ${token}`,
	};
	if (json) headers['Content-Type'] = 'application/json';
	return headers;
}

export async function fetchCapabilities(serverUrl: string, fetcher: FetchLike = fetch): Promise<SyncCapabilities> {
	const base = normalizeServerUrl(serverUrl);
	const response = await requestRaw(`${base}/v1/capabilities`, { method: 'GET' }, fetcher);
	if (!response.ok) {
		throw new SyncClientError('http', `服务端返回 ${response.status}`, response.status);
	}
	const data = await response.json() as Partial<SyncCapabilities>;
	if (data.apiVersion !== 1 || !data.sync || typeof data.storeId !== 'string') {
		throw new SyncClientError('invalid', '服务端版本不兼容或未启用同步功能');
	}
	return data as SyncCapabilities;
}

export async function fetchSnapshot(serverUrl: string, token: string, fetcher: FetchLike = fetch): Promise<SyncSnapshot> {
	const base = normalizeServerUrl(serverUrl);
	const response = await requestRaw(`${base}/v1/snapshot`, {
		method: 'GET',
		headers: authHeaders(token, false),
	}, fetcher);
	if (response.status === 401 || response.status === 403) {
		throw new SyncClientError('auth', '访问口令无效或未授权', response.status);
	}
	if (!response.ok) {
		throw new SyncClientError('http', `拉取快照失败（HTTP ${response.status}）`, response.status);
	}
	return parseSyncSnapshot(await response.json());
}

export type PushResult<T> =
	| { ok: true; data: T }
	| { ok: false; conflict: T | null };

export async function pushPreference(
	serverUrl: string,
	token: string,
	key: string,
	payload: { mutationId: string; deviceId: string; baseRevision: number; timeframe: Timeframe },
	fetcher: FetchLike = fetch,
): Promise<PushResult<SyncedInstrumentState>> {
	const base = normalizeServerUrl(serverUrl);
	const response = await requestRaw(`${base}/v1/instruments/${encodeURIComponent(key)}/preferences`, {
		method: 'PUT',
		headers: authHeaders(token),
		body: JSON.stringify(payload),
	}, fetcher);
	if (response.status === 401 || response.status === 403) {
		throw new SyncClientError('auth', '访问口令无效', response.status);
	}
	if (response.status === 409) {
		const body = await response.json() as { latest?: SyncedInstrumentState | null };
		return { ok: false, conflict: body.latest ?? null };
	}
	if (!response.ok) {
		throw new SyncClientError('http', `推送交易对周期失败（HTTP ${response.status}）`, response.status);
	}
	return { ok: true, data: await response.json() as SyncedInstrumentState };
}

export async function pushDrawing(
	serverUrl: string,
	token: string,
	key: string,
	drawingId: string,
	payload: { mutationId: string; deviceId: string; baseRevision: number; document: DrawingDocument },
	fetcher: FetchLike = fetch,
): Promise<PushResult<SyncedDrawingRecord>> {
	const base = normalizeServerUrl(serverUrl);
	const response = await requestRaw(`${base}/v1/instruments/${encodeURIComponent(key)}/drawings/${encodeURIComponent(drawingId)}`, {
		method: 'PUT',
		headers: authHeaders(token),
		body: JSON.stringify(payload),
	}, fetcher);
	if (response.status === 401 || response.status === 403) {
		throw new SyncClientError('auth', '访问口令无效', response.status);
	}
	if (response.status === 409) {
		const body = await response.json() as { latest?: SyncedDrawingRecord | null };
		return { ok: false, conflict: body.latest ?? null };
	}
	if (!response.ok) {
		throw new SyncClientError('http', `推送画线失败（HTTP ${response.status}）`, response.status);
	}
	return { ok: true, data: await response.json() as SyncedDrawingRecord };
}

export async function pushSetting(
	serverUrl: string,
	token: string,
	settingKey: SyncSettingKey,
	payload: { mutationId: string; deviceId: string; baseRevision: number; value: Record<string, unknown> },
	fetcher: FetchLike = fetch,
): Promise<PushResult<SyncedSettingRecord>> {
	const base = normalizeServerUrl(serverUrl);
	const response = await requestRaw(`${base}/v1/settings/${encodeURIComponent(settingKey)}`, {
		method: 'PUT',
		headers: authHeaders(token),
		body: JSON.stringify(payload),
	}, fetcher);
	if (response.status === 401 || response.status === 403) {
		throw new SyncClientError('auth', '访问口令无效', response.status);
	}
	if (response.status === 409) {
		const body = await response.json() as { latest?: SyncedSettingRecord | null };
		return { ok: false, conflict: body.latest ?? null };
	}
	if (!response.ok) {
		throw new SyncClientError('http', `推送偏好设置失败（HTTP ${response.status}）`, response.status);
	}
	return { ok: true, data: await response.json() as SyncedSettingRecord };
}

export async function importRemoteSnapshot(
	serverUrl: string,
	token: string,
	snapshot: SyncSnapshot,
	mode: 'merge' | 'replace',
	fetcher: FetchLike = fetch,
): Promise<SyncSnapshot> {
	const base = normalizeServerUrl(serverUrl);
	const response = await requestRaw(`${base}/v1/import`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify({ mode, snapshot }),
	}, fetcher, 30000);
	if (response.status === 401 || response.status === 403) {
		throw new SyncClientError('auth', '访问口令无效', response.status);
	}
	if (!response.ok) {
		throw new SyncClientError('http', `导入快照到服务端失败（HTTP ${response.status}）`, response.status);
	}
	return parseSyncSnapshot(await response.json());
}

export async function downloadSqliteBackup(
	serverUrl: string,
	token: string,
	fetcher: FetchLike = fetch,
): Promise<{ blob: Blob; filename: string }> {
	const base = normalizeServerUrl(serverUrl);
	const response = await requestRaw(`${base}/v1/backup/sqlite`, {
		method: 'GET',
		headers: authHeaders(token, false),
	}, fetcher, 30000);
	if (response.status === 401 || response.status === 403) {
		throw new SyncClientError('auth', '访问口令无效', response.status);
	}
	if (!response.ok) {
		throw new SyncClientError('http', `下载 SQLite 备份失败（HTTP ${response.status}）`, response.status);
	}
	const disposition = response.headers.get('content-disposition') ?? '';
	const match = /filename="([^"]+)"/.exec(disposition);
	const filename = match?.[1] ?? `terminal-${new Date().toISOString().slice(0, 10)}.db`;
	return { blob: await response.blob(), filename };
}
