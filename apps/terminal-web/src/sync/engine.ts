import {
	parseSyncSnapshot,
	type DrawingDocument,
	type PendingSyncMutation,
	type SyncSettingKey,
	type SyncSnapshot,
	type SyncStatusState,
	type SyncedDrawingRecord,
	type SyncedInstrumentState,
	type SyncedSettingRecord,
	type Timeframe,
} from '@terminal/domain';
import {
	SyncClientError,
	downloadSqliteBackup,
	fetchCapabilities,
	fetchSnapshot,
	importRemoteSnapshot,
	normalizeServerUrl,
	pushDrawing,
	pushPreference,
	pushSetting,
	type FetchLike,
	type SyncAuth,
} from './client';
import type { SyncStorageAdapter } from './storage';

const CONFIG_KEY = 'config';
const OUTBOX_KEY = 'outbox';
const REVISIONS_KEY = 'revisions';
const CONFLICTS_KEY = 'conflicts';

export type SyncStorageMode = 'local' | 'remote' | 'disabled';

export interface SyncConfig {
	enabled: boolean;
	mode: SyncStorageMode;
	serverUrl: string;
	token: string;
	deviceId: string;
	lastStoreId?: string;
	lastSyncedAt?: string;
}

export interface LocalServiceInfo {
	checked: boolean;
	available: boolean;
	authMode: 'local' | 'token' | null;
	storeId?: string;
	marketRelayBinance: boolean;
}

export interface MarketRelayTarget {
	ready: boolean;
	checking: boolean;
	baseUrl: string;
	auth: SyncAuth;
	source: 'local' | 'remote';
	needsToken?: boolean;
	reason?: string;
}

export interface SyncRevisions {
	instruments: Record<string, number>;
	drawings: Record<string, number>;
	settings: Record<string, number>;
}

export interface SyncConflictItem {
	id: string;
	label: string;
	mutation: PendingSyncMutation;
	serverLatest: SyncedInstrumentState | SyncedDrawingRecord | SyncedSettingRecord | null;
}

export interface StoreMismatchState {
	reason: 'store_changed' | 'initial_both_non_empty';
	expectedStoreId?: string;
	actualStoreId: string;
	serverSnapshot: SyncSnapshot;
}

export interface SyncViewState {
	status: SyncStatusState;
	message: string;
	pendingCount: number;
	conflictCount: number;
	conflicts: readonly SyncConflictItem[];
	storeMismatch: StoreMismatchState | null;
	config: SyncConfig;
	localService: LocalServiceInfo;
}

export interface SyncHostAdapter {
	exportLocalSnapshot(): SyncSnapshot;
	applyRemotePreference(item: SyncedInstrumentState): void;
	applyRemoteDrawings(instrumentKey: string, records: SyncedDrawingRecord[]): void;
	confirmDrawingRevision(instrumentKey: string, drawingId: string, revision: number): void;
	applyRemoteSetting(record: SyncedSettingRecord): void;
	replaceLocalFromSnapshot(snapshot: SyncSnapshot): void;
	onRemoteApplied(): void;
}

function makeId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function entityKey(mutation: PendingSyncMutation): string {
	if (mutation.kind === 'preference') return `pref:${mutation.instrumentKey}`;
	if (mutation.kind === 'drawing') return `drawing:${mutation.instrumentKey}:${mutation.drawingId}`;
	return `setting:${mutation.key}`;
}

function describeMutation(mutation: PendingSyncMutation): string {
	if (mutation.kind === 'preference') {
		return `${mutation.instrumentKey} · 周期 (${mutation.timeframe})`;
	}
	if (mutation.kind === 'drawing') {
		const action = mutation.document.deleted ? '删除画线' : `画线 ${mutation.document.kind}`;
		return `${mutation.instrumentKey} · ${action} (${mutation.drawingId.slice(0, 8)})`;
	}
	const names: Record<SyncSettingKey, string> = {
		indicators: '指标配置',
		timeframes: '常用周期设置',
		'drawing-defaults': '画线默认样式',
		watchlist: '自选列表',
		'workspace-tabs': '打开的标签页',
		'custom-colors': '自定义颜色',
	};
	return names[mutation.key];
}

function hasMeaningfulLocalData(snapshot: SyncSnapshot): boolean {
	if (snapshot.drawings.length > 0) return true;
	if (snapshot.instruments.some(item => item.timeframe !== '1h')) return true;
	return false;
}

function isSnapshotEmpty(snapshot: SyncSnapshot): boolean {
	return snapshot.instruments.length === 0 &&
		snapshot.drawings.length === 0 &&
		Object.keys(snapshot.settings).length === 0;
}

/**
 * Local-first sync engine backed by persistent outbox (IndexedDB) and SQLite server.
 * Auto-connects to the built-in same-origin local storage service by default when available,
 * while retaining full custom remote storage configuration, 409 conflict protection, and store_id guards.
 */
export class SyncEngine {
	private config: SyncConfig;
	private outbox: PendingSyncMutation[] = [];
	private revisions: SyncRevisions = { instruments: {}, drawings: {}, settings: {} };
	private conflicts: SyncConflictItem[] = [];
	private storeMismatch: StoreMismatchState | null = null;
	private status: SyncStatusState = 'disabled';
	private message = '仅浏览器缓存';
	private localService: LocalServiceInfo = { checked: false, available: false, authMode: null, marketRelayBinance: false };
	private initialized = false;
	private activeSync: Promise<void> | undefined;
	private scheduledSync: ReturnType<typeof setTimeout> | undefined;
	private pollTimer: ReturnType<typeof setInterval> | undefined;
	private readonly listeners = new Set<(view: SyncViewState) => void>();
	private readonly fetcher: FetchLike;
	private readonly fallbackOrigin?: string;

	constructor(
		private readonly storage: SyncStorageAdapter,
		private readonly host: SyncHostAdapter,
		options?: { fetcher?: FetchLike; fallbackOrigin?: string },
	) {
		this.fetcher = options?.fetcher ?? fetch;
		this.fallbackOrigin = options?.fallbackOrigin;
		this.config = {
			enabled: false,
			mode: 'disabled',
			serverUrl: '',
			token: '',
			deviceId: makeId(),
		};
	}

	async init(): Promise<void> {
		if (this.initialized) return;
		this.initialized = true;
		const savedConfig = await this.storage.get<Partial<SyncConfig>>(CONFIG_KEY);
		const isFresh = !savedConfig || typeof savedConfig.deviceId !== 'string';
		const isLegacyUnconfigured = Boolean(
			savedConfig &&
			savedConfig.mode === undefined &&
			!savedConfig.enabled &&
			!savedConfig.serverUrl &&
			!savedConfig.token &&
			!savedConfig.lastStoreId,
		);

		if (savedConfig && typeof savedConfig.deviceId === 'string') {
			const enabled = Boolean(savedConfig.enabled);
			const mode: SyncStorageMode = savedConfig.mode === 'local' || savedConfig.mode === 'remote' || savedConfig.mode === 'disabled'
				? savedConfig.mode
				: (enabled ? 'remote' : 'disabled');
			this.config = {
				enabled,
				mode,
				serverUrl: typeof savedConfig.serverUrl === 'string' ? savedConfig.serverUrl : '',
				token: typeof savedConfig.token === 'string' ? savedConfig.token : '',
				deviceId: savedConfig.deviceId,
				lastStoreId: savedConfig.lastStoreId,
				lastSyncedAt: savedConfig.lastSyncedAt,
			};
		} else {
			await this.storage.set(CONFIG_KEY, this.config);
		}
		const savedOutbox = await this.storage.get<PendingSyncMutation[]>(OUTBOX_KEY);
		if (Array.isArray(savedOutbox)) this.outbox = savedOutbox;
		const savedRevisions = await this.storage.get<SyncRevisions>(REVISIONS_KEY);
		if (savedRevisions && typeof savedRevisions === 'object') {
			this.revisions = {
				instruments: { ...(savedRevisions.instruments ?? {}) },
				drawings: { ...(savedRevisions.drawings ?? {}) },
				settings: { ...(savedRevisions.settings ?? {}) },
			};
		}
		const savedConflicts = await this.storage.get<SyncConflictItem[]>(CONFLICTS_KEY);
		if (Array.isArray(savedConflicts)) this.conflicts = savedConflicts;

		if (this.fallbackOrigin) {
			await this.probeLocalService();
			if ((isFresh || isLegacyUnconfigured) && this.localService.available && this.localService.authMode === 'local') {
				this.config = {
					...this.config,
					enabled: true,
					mode: 'local',
					serverUrl: '',
				};
				await this.storage.set(CONFIG_KEY, this.config);
			}
		}

		this.refreshIdleStatus();
		this.emit();
		if (this.config.enabled) {
			void this.syncNow();
		}
	}

	async probeLocalService(): Promise<LocalServiceInfo> {
		if (!this.fallbackOrigin) {
			this.localService = { checked: true, available: false, authMode: null, marketRelayBinance: false };
			return { ...this.localService };
		}
		try {
			const caps = await fetchCapabilities(this.fallbackOrigin, this.fetcher, 3000);
			this.localService = {
				checked: true,
				available: true,
				authMode: caps.authentication,
				storeId: caps.storeId,
				marketRelayBinance: Boolean(caps.marketRelay?.binance),
			};
		} catch {
			this.localService = { checked: true, available: false, authMode: null, marketRelayBinance: false };
		}
		return { ...this.localService };
	}

	getMarketRelayTarget(): MarketRelayTarget {
		if (this.config.enabled && this.config.mode === 'remote') {
			try {
				const baseUrl = this.resolvedServerUrl();
				if (this.config.token.length < 8) {
					return {
						ready: false,
						checking: false,
						baseUrl,
						auth: { mode: 'token', token: '' },
						source: 'remote',
						needsToken: true,
						reason: '当前远程服务需要访问口令，请在「设置 → 存储服务」填写 SYNC_TOKEN',
					};
				}
				return {
					ready: true,
					checking: false,
					baseUrl,
					auth: { mode: 'token', token: this.config.token },
					source: 'remote',
				};
			} catch (error) {
				return {
					ready: false,
					checking: false,
					baseUrl: '',
					auth: { mode: 'token', token: '' },
					source: 'remote',
					reason: error instanceof Error ? error.message : '远程存储服务地址无效',
				};
			}
		}

		if (this.config.enabled && this.config.mode === 'local' && this.fallbackOrigin) {
			return {
				ready: true,
				checking: false,
				baseUrl: this.resolvedServerUrl(),
				auth: { mode: 'local' },
				source: 'local',
			};
		}

		if (this.fallbackOrigin && !this.localService.checked) {
			return {
				ready: false,
				checking: true,
				baseUrl: this.fallbackOrigin,
				auth: { mode: 'local' },
				source: 'local',
				reason: '正在连接当前服务的行情中继…',
			};
		}

		if (this.localService.available && this.fallbackOrigin) {
			if (this.localService.authMode === 'local') {
				return {
					ready: true,
					checking: false,
					baseUrl: normalizeServerUrl('', this.fallbackOrigin),
					auth: { mode: 'local' },
					source: 'local',
				};
			}
			return {
				ready: false,
				checking: false,
				baseUrl: normalizeServerUrl('', this.fallbackOrigin),
				auth: { mode: 'token', token: '' },
				source: 'remote',
				needsToken: true,
				reason: '当前服务已开启口令保护，请在「设置 → 存储服务」填写访问口令以启用服务器行情转发与数据同步',
			};
		}

		return {
			ready: false,
			checking: false,
			baseUrl: '',
			auth: { mode: 'local' },
			source: 'local',
			reason: '未检测到可用的中继服务；请通过电脑/服务器地址访问，或在「设置 → 数据源」切换为浏览器直连',
		};
	}

	subscribe(listener: (view: SyncViewState) => void): () => void {
		this.listeners.add(listener);
		listener(this.getViewState());
		return () => { this.listeners.delete(listener); };
	}

	getViewState(): SyncViewState {
		return {
			status: this.status,
			message: this.message,
			pendingCount: this.outbox.length,
			conflictCount: this.conflicts.length,
			conflicts: [...this.conflicts],
			storeMismatch: this.storeMismatch,
			config: { ...this.config },
			localService: { ...this.localService },
		};
	}

	private emit(): void {
		const snapshot = this.getViewState();
		for (const listener of this.listeners) listener(snapshot);
	}

	private async persistState(): Promise<void> {
		await Promise.all([
			this.storage.set(CONFIG_KEY, this.config),
			this.storage.set(OUTBOX_KEY, this.outbox),
			this.storage.set(REVISIONS_KEY, this.revisions),
			this.storage.set(CONFLICTS_KEY, this.conflicts),
		]);
	}

	private resolvedServerUrl(): string {
		if (this.config.mode === 'local') {
			return normalizeServerUrl('', this.fallbackOrigin);
		}
		return normalizeServerUrl(this.config.serverUrl, this.fallbackOrigin);
	}

	private activeAuth(): SyncAuth {
		if (this.config.mode === 'local') return { mode: 'local' };
		return { mode: 'token', token: this.config.token };
	}

	private modeLabel(): string {
		return this.config.mode === 'local' ? '本机存储' : '远程存储';
	}

	private refreshIdleStatus(): void {
		if (!this.config.enabled || this.config.mode === 'disabled') {
			this.status = 'disabled';
			this.message = this.localService.available && this.localService.authMode === 'token'
				? '同源存储需填写口令'
				: '仅浏览器缓存';
			return;
		}
		const label = this.modeLabel();
		if (this.storeMismatch) {
			this.status = 'store_mismatch';
			this.message = '检测到不同步存储库，请确认合并或覆盖方式';
			return;
		}
		if (this.conflicts.length > 0) {
			this.status = 'conflict';
			this.message = `${this.conflicts.length} 项同步冲突待处理`;
			return;
		}
		if (this.outbox.length > 0) {
			this.status = 'pending';
			this.message = `${label} · ${this.outbox.length} 项待同步`;
			return;
		}
		this.status = 'synced';
		this.message = this.config.lastSyncedAt
			? `${label} · 已同步 ${new Date(this.config.lastSyncedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
			: `${label} · 已连接`;
	}

	async testConnection(
		serverUrl: string,
		token: string,
		authMode: 'local' | 'token' = 'token',
	): Promise<{ storeId: string; staticWeb: boolean; authentication: 'local' | 'token' }> {
		const base = authMode === 'local'
			? normalizeServerUrl('', this.fallbackOrigin)
			: normalizeServerUrl(serverUrl, this.fallbackOrigin);
		const caps = await fetchCapabilities(base, this.fetcher);
		if (authMode === 'local') {
			if (caps.authentication !== 'local') {
				throw new SyncClientError('auth', '当前服务已开启访问口令保护，请选择远程/口令模式并填写 SYNC_TOKEN');
			}
			await fetchSnapshot(base, { mode: 'local' }, this.fetcher);
		} else {
			await fetchSnapshot(base, { mode: 'token', token: token.trim() }, this.fetcher);
		}
		return { storeId: caps.storeId, staticWeb: caps.staticWeb, authentication: caps.authentication };
	}

	async useLocalStorage(): Promise<void> {
		const probe = await this.probeLocalService();
		if (!probe.available) {
			throw new SyncClientError('network', '未检测到同源本机存储服务，请通过 pnpm dev:terminal 或 pnpm start:terminal 启动');
		}
		if (probe.authMode !== 'local') {
			throw new SyncClientError('auth', '当前同源服务已开启访问口令保护，请在自定义存储服务中填写访问口令（地址留空即可）');
		}
		await this.configure({ serverUrl: '', token: this.config.token, enabled: true, mode: 'local' });
	}

	async configure(next: { serverUrl: string; token: string; enabled: boolean; mode?: SyncStorageMode }): Promise<void> {
		const trimmedToken = next.token.trim();
		const nextMode: SyncStorageMode = !next.enabled
			? 'disabled'
			: (next.mode ?? 'remote');
		const cleanedUrl = nextMode === 'local' ? '' : next.serverUrl.trim().replace(/\/+$/, '');
		if (next.enabled) {
			if (nextMode === 'local') {
				normalizeServerUrl('', this.fallbackOrigin);
			} else {
				normalizeServerUrl(cleanedUrl, this.fallbackOrigin);
				if (trimmedToken.length < 8) {
					throw new SyncClientError('invalid', '访问口令长度至少为 8 位');
				}
			}
		}
		const targetChanged = cleanedUrl !== this.config.serverUrl || nextMode !== this.config.mode;
		this.config = {
			...this.config,
			mode: nextMode,
			serverUrl: cleanedUrl,
			token: trimmedToken,
			enabled: next.enabled,
		};
		if (!next.enabled) {
			this.storeMismatch = null;
			clearTimeout(this.scheduledSync);
			this.scheduledSync = undefined;
		} else if (targetChanged) {
			this.storeMismatch = null;
		}
		this.refreshIdleStatus();
		await this.persistState();
		this.emit();
		if (this.config.enabled) {
			await this.syncNow();
		}
	}

	async enqueuePreference(instrumentKey: string, timeframe: Timeframe): Promise<void> {
		if (!this.config.enabled) return;
		const key = `pref:${instrumentKey}`;
		const existing = this.outbox.find(item => entityKey(item) === key);
		const baseRevision = existing ? existing.baseRevision : (this.revisions.instruments[instrumentKey] ?? 0);
		this.outbox = this.outbox.filter(item => entityKey(item) !== key);
		this.outbox.push({
			mutationId: makeId(),
			kind: 'preference',
			instrumentKey,
			baseRevision,
			timeframe,
			queuedAt: Date.now(),
		});
		this.conflicts = this.conflicts.filter(item => item.id !== key);
		this.refreshIdleStatus();
		await this.persistState();
		this.emit();
		this.scheduleSync();
	}

	async enqueueDrawing(document: DrawingDocument): Promise<void> {
		if (!this.config.enabled) return;
		const key = `drawing:${document.instrumentKey}:${document.id}`;
		const existing = this.outbox.find(item => entityKey(item) === key);
		const knownRev = this.revisions.drawings[document.id] ?? document.revision ?? 0;
		const baseRevision = existing ? existing.baseRevision : knownRev;
		this.outbox = this.outbox.filter(item => entityKey(item) !== key);
		this.outbox.push({
			mutationId: makeId(),
			kind: 'drawing',
			instrumentKey: document.instrumentKey,
			drawingId: document.id,
			baseRevision,
			document: structuredClone(document),
			queuedAt: Date.now(),
		});
		this.conflicts = this.conflicts.filter(item => item.id !== key);
		this.refreshIdleStatus();
		await this.persistState();
		this.emit();
		this.scheduleSync();
	}

	async enqueueSetting(settingKey: SyncSettingKey, value: Record<string, unknown>): Promise<void> {
		if (!this.config.enabled) return;
		const key = `setting:${settingKey}`;
		const existing = this.outbox.find(item => entityKey(item) === key);
		const baseRevision = existing ? existing.baseRevision : (this.revisions.settings[settingKey] ?? 0);
		this.outbox = this.outbox.filter(item => entityKey(item) !== key);
		this.outbox.push({
			mutationId: makeId(),
			kind: 'setting',
			key: settingKey,
			baseRevision,
			value: structuredClone(value),
			queuedAt: Date.now(),
		});
		this.conflicts = this.conflicts.filter(item => item.id !== key);
		this.refreshIdleStatus();
		await this.persistState();
		this.emit();
		this.scheduleSync();
	}

	private scheduleSync(delayMs = 500): void {
		if (!this.config.enabled || this.storeMismatch) return;
		clearTimeout(this.scheduledSync);
		this.scheduledSync = setTimeout(() => {
			this.scheduledSync = undefined;
			void this.syncNow();
		}, delayMs);
	}

	startPolling(intervalMs = 30000): void {
		this.stopPolling();
		this.pollTimer = setInterval(() => {
			if (this.config.enabled && !this.storeMismatch && (typeof document === 'undefined' || !document.hidden)) {
				void this.syncNow();
			}
		}, intervalMs);
	}

	stopPolling(): void {
		clearInterval(this.pollTimer);
		this.pollTimer = undefined;
		clearTimeout(this.scheduledSync);
		this.scheduledSync = undefined;
	}

	syncNow(): Promise<void> {
		if (!this.config.enabled) return Promise.resolve();
		if (this.activeSync) return this.activeSync;
		clearTimeout(this.scheduledSync);
		this.scheduledSync = undefined;
		if (this.storeMismatch) {
			this.refreshIdleStatus();
			this.emit();
			return Promise.resolve();
		}
		const run = this.runSync().finally(() => {
			if (this.activeSync === run) this.activeSync = undefined;
		});
		this.activeSync = run;
		return run;
	}

	private async runSync(): Promise<void> {
		this.status = 'syncing';
		this.message = `${this.modeLabel()} · 同步中…`;
		this.emit();

		try {
			const baseUrl = this.resolvedServerUrl();
			const auth = this.activeAuth();
			const snapshot = await fetchSnapshot(baseUrl, auth, this.fetcher);

			// Detect server DB switch (e.g. switched between local SQLite and remote server DB).
			if (this.config.lastStoreId && this.config.lastStoreId !== snapshot.storeId) {
				this.storeMismatch = {
					reason: 'store_changed',
					expectedStoreId: this.config.lastStoreId,
					actualStoreId: snapshot.storeId,
					serverSnapshot: snapshot,
				};
				this.refreshIdleStatus();
				await this.persistState();
				this.emit();
				return;
			}

			// First-time link: seed an empty server automatically, or ask user when both sides already have data.
			if (!this.config.lastStoreId) {
				const localSnapshot = this.host.exportLocalSnapshot();
				if (isSnapshotEmpty(snapshot)) {
					const seeded = await importRemoteSnapshot(baseUrl, auth, localSnapshot, 'merge', this.fetcher);
					this.applySnapshotToLocal(seeded, false);
					this.config.lastStoreId = seeded.storeId;
					this.config.lastSyncedAt = new Date().toISOString();
					this.outbox = [];
					this.conflicts = [];
					this.refreshIdleStatus();
					await this.persistState();
					this.emit();
					return;
				}
				if (hasMeaningfulLocalData(localSnapshot)) {
					this.storeMismatch = {
						reason: 'initial_both_non_empty',
						actualStoreId: snapshot.storeId,
						serverSnapshot: snapshot,
					};
					this.refreshIdleStatus();
					await this.persistState();
					this.emit();
					return;
				}
				this.config.lastStoreId = snapshot.storeId;
			}

			// Step 1: Apply remote state for entities without pending local edits or conflicts.
			const changed = this.applySnapshotToLocal(snapshot, true);

			// Step 2: Push pending local mutations with optimistic concurrency & mutationId idempotency.
			const remaining: PendingSyncMutation[] = [];
			for (let i = 0; i < this.outbox.length; i++) {
				const item = this.outbox[i];
				try {
					if (item.kind === 'preference') {
						const res = await pushPreference(baseUrl, auth, item.instrumentKey, {
							mutationId: item.mutationId,
							deviceId: this.config.deviceId,
							baseRevision: item.baseRevision,
							timeframe: item.timeframe,
						}, this.fetcher);
						if (res.ok) {
							this.revisions.instruments[item.instrumentKey] = res.data.revision;
						} else {
							this.recordConflict(item, res.conflict);
						}
					} else if (item.kind === 'drawing') {
						const res = await pushDrawing(baseUrl, auth, item.instrumentKey, item.drawingId, {
							mutationId: item.mutationId,
							deviceId: this.config.deviceId,
							baseRevision: item.baseRevision,
							document: item.document,
						}, this.fetcher);
						if (res.ok) {
							this.revisions.drawings[item.drawingId] = res.data.revision;
							this.host.confirmDrawingRevision(item.instrumentKey, item.drawingId, res.data.revision);
						} else {
							this.recordConflict(item, res.conflict);
						}
					} else {
						const res = await pushSetting(baseUrl, auth, item.key, {
							mutationId: item.mutationId,
							deviceId: this.config.deviceId,
							baseRevision: item.baseRevision,
							value: item.value,
						}, this.fetcher);
						if (res.ok) {
							this.revisions.settings[item.key] = res.data.revision;
						} else {
							this.recordConflict(item, res.conflict);
						}
					}
				} catch (error) {
					// Keep this and all remaining items in the persistent outbox for safe idempotent retry.
					remaining.push(...this.outbox.slice(i));
					this.outbox = remaining;
					throw error;
				}
			}
			this.outbox = remaining;
			if (this.conflicts.length === 0 && this.outbox.length === 0) {
				this.config.lastSyncedAt = new Date().toISOString();
			}
			if (changed) this.host.onRemoteApplied();
			this.refreshIdleStatus();
			await this.persistState();
			this.emit();
		} catch (error) {
			if (error instanceof SyncClientError) {
				if (error.kind === 'auth') {
					this.status = 'auth_error';
					this.message = error.message;
				} else if (error.kind === 'network') {
					this.status = 'offline';
					this.message = this.outbox.length > 0
						? `${this.modeLabel()}离线 · ${this.outbox.length} 项待同步`
						: `${this.modeLabel()}离线 · 使用浏览器缓存`;
				} else {
					this.status = 'error';
					this.message = error.message;
				}
			} else {
				this.status = 'error';
				this.message = error instanceof Error ? error.message : '同步失败';
			}
			await this.persistState();
			this.emit();
		}
	}

	private recordConflict(
		mutation: PendingSyncMutation,
		serverLatest: SyncedInstrumentState | SyncedDrawingRecord | SyncedSettingRecord | null,
	): void {
		const id = entityKey(mutation);
		this.conflicts = this.conflicts.filter(item => item.id !== id);
		this.conflicts.push({
			id,
			label: describeMutation(mutation),
			mutation,
			serverLatest,
		});
	}

	private applySnapshotToLocal(snapshot: SyncSnapshot, respectPending: boolean): boolean {
		const pendingKeys = respectPending
			? new Set([...this.outbox.map(entityKey), ...this.conflicts.map(c => c.id)])
			: new Set<string>();
		let changed = false;

		for (const item of snapshot.instruments) {
			const key = `pref:${item.instrumentKey}`;
			if (pendingKeys.has(key)) continue;
			const known = this.revisions.instruments[item.instrumentKey] ?? 0;
			if (item.revision > known || !respectPending) {
				this.host.applyRemotePreference(item);
				this.revisions.instruments[item.instrumentKey] = item.revision;
				changed = true;
			}
		}

		const drawingsByInstrument = new Map<string, SyncedDrawingRecord[]>();
		for (const record of snapshot.drawings) {
			const key = `drawing:${record.instrumentKey}:${record.id}`;
			if (pendingKeys.has(key)) continue;
			const known = this.revisions.drawings[record.id] ?? 0;
			if (record.revision > known || !respectPending) {
				const list = drawingsByInstrument.get(record.instrumentKey) ?? [];
				list.push(record);
				drawingsByInstrument.set(record.instrumentKey, list);
				this.revisions.drawings[record.id] = record.revision;
				changed = true;
			}
		}
		for (const [instrumentKey, records] of drawingsByInstrument) {
			this.host.applyRemoteDrawings(instrumentKey, records);
		}

		for (const [settingKey, record] of Object.entries(snapshot.settings)) {
			const key = `setting:${settingKey}`;
			if (pendingKeys.has(key)) continue;
			const known = this.revisions.settings[settingKey] ?? 0;
			if (record.revision > known || !respectPending) {
				this.host.applyRemoteSetting(record);
				this.revisions.settings[settingKey] = record.revision;
				changed = true;
			}
		}
		return changed;
	}

	async resolveConflict(conflictId: string, choice: 'local' | 'server'): Promise<void> {
		const conflict = this.conflicts.find(item => item.id === conflictId);
		if (!conflict) return;
		this.conflicts = this.conflicts.filter(item => item.id !== conflictId);

		if (choice === 'local') {
			const nextBaseRevision = conflict.serverLatest?.revision ?? 0;
			const updated: PendingSyncMutation = {
				...conflict.mutation,
				mutationId: makeId(),
				baseRevision: nextBaseRevision,
				queuedAt: Date.now(),
			};
			this.outbox = this.outbox.filter(item => entityKey(item) !== conflictId);
			this.outbox.push(updated);
			this.refreshIdleStatus();
			await this.persistState();
			this.emit();
			await this.syncNow();
			return;
		}

		// choice === 'server'
		const latest = conflict.serverLatest;
		if (latest) {
			if (conflict.mutation.kind === 'preference') {
				const pref = latest as SyncedInstrumentState;
				this.host.applyRemotePreference(pref);
				this.revisions.instruments[pref.instrumentKey] = pref.revision;
			} else if (conflict.mutation.kind === 'drawing') {
				const drawing = latest as SyncedDrawingRecord;
				this.host.applyRemoteDrawings(drawing.instrumentKey, [drawing]);
				this.revisions.drawings[drawing.id] = drawing.revision;
			} else {
				const setting = latest as SyncedSettingRecord;
				this.host.applyRemoteSetting(setting);
				this.revisions.settings[setting.key] = setting.revision;
			}
			this.host.onRemoteApplied();
		}
		this.refreshIdleStatus();
		await this.persistState();
		this.emit();
	}

	async resolveStoreMismatch(choice: 'merge' | 'push_replace' | 'pull_replace'): Promise<void> {
		const mismatch = this.storeMismatch;
		if (!mismatch) return;
		this.status = 'syncing';
		this.message = '正在应用迁移选择…';
		this.emit();

		try {
			const baseUrl = this.resolvedServerUrl();
			const auth = this.activeAuth();
			if (choice === 'pull_replace') {
				this.host.replaceLocalFromSnapshot(mismatch.serverSnapshot);
				this.resetRevisionsFromSnapshot(mismatch.serverSnapshot);
				this.config.lastStoreId = mismatch.serverSnapshot.storeId;
			} else {
				const localSnapshot = this.host.exportLocalSnapshot();
				const mode = choice === 'push_replace' ? 'replace' : 'merge';
				const result = await importRemoteSnapshot(baseUrl, auth, localSnapshot, mode, this.fetcher);
				this.host.replaceLocalFromSnapshot(result);
				this.resetRevisionsFromSnapshot(result);
				this.config.lastStoreId = result.storeId;
			}
			this.storeMismatch = null;
			this.outbox = [];
			this.conflicts = [];
			this.config.lastSyncedAt = new Date().toISOString();
			this.host.onRemoteApplied();
			this.refreshIdleStatus();
			await this.persistState();
			this.emit();
		} catch (error) {
			this.status = 'error';
			this.message = error instanceof Error ? error.message : '处理存储库切换失败';
			this.emit();
			throw error;
		}
	}

	private resetRevisionsFromSnapshot(snapshot: SyncSnapshot): void {
		const next: SyncRevisions = { instruments: {}, drawings: {}, settings: {} };
		for (const item of snapshot.instruments) next.instruments[item.instrumentKey] = item.revision;
		for (const drawing of snapshot.drawings) next.drawings[drawing.id] = drawing.revision;
		for (const [key, setting] of Object.entries(snapshot.settings)) next.settings[key] = setting.revision;
		this.revisions = next;
	}

	/** Always available offline: exports full portable JSON snapshot of local state. */
	exportPortableJson(): SyncSnapshot {
		return this.host.exportLocalSnapshot();
	}

	/** Imports a portable JSON snapshot into local state (and optionally pushes to connected server). */
	async importPortableJson(raw: unknown, mode: 'merge' | 'replace'): Promise<void> {
		const snapshot = parseSyncSnapshot(raw);
		if (this.config.enabled && !this.storeMismatch) {
			try {
				const updated = await importRemoteSnapshot(this.resolvedServerUrl(), this.activeAuth(), snapshot, mode, this.fetcher);
				this.host.replaceLocalFromSnapshot(updated);
				this.resetRevisionsFromSnapshot(updated);
				this.config.lastStoreId = updated.storeId;
				this.config.lastSyncedAt = new Date().toISOString();
				this.outbox = [];
				this.conflicts = [];
				this.host.onRemoteApplied();
				this.refreshIdleStatus();
				await this.persistState();
				this.emit();
				return;
			} catch (error) {
				if (!(error instanceof SyncClientError && error.kind === 'network')) {
					throw error;
				}
				// Offline fallback: apply locally below.
			}
		}

		if (mode === 'replace') {
			this.host.replaceLocalFromSnapshot(snapshot);
		} else {
			this.applySnapshotToLocal(snapshot, false);
		}
		this.host.onRemoteApplied();
		this.refreshIdleStatus();
		await this.persistState();
		this.emit();
	}

	async downloadBackup(): Promise<{ blob: Blob; filename: string }> {
		if (!this.config.enabled) {
			throw new SyncClientError('invalid', '请先启用本机存储或连接远程存储服务');
		}
		if (this.config.mode === 'remote' && !this.config.token) {
			throw new SyncClientError('invalid', '请先填写存储服务访问口令');
		}
		return downloadSqliteBackup(this.resolvedServerUrl(), this.activeAuth(), this.fetcher);
	}
}
