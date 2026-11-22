/** Asynchronous key-value persistence used by the local-first sync engine. */
export interface SyncStorageAdapter {
	get<T>(key: string): Promise<T | undefined>;
	set(key: string, value: unknown): Promise<void>;
	delete(key: string): Promise<void>;
}

const DB_NAME = 'crypto-terminal-sync';
const STORE_NAME = 'kv';
const FALLBACK_PREFIX = 'crypto-terminal.sync-kv.v1.';

/** In-memory adapter for deterministic unit tests; clones values like IndexedDB. */
export class MemorySyncStorage implements SyncStorageAdapter {
	private readonly data = new Map<string, unknown>();

	get<T>(key: string): Promise<T | undefined> {
		if (!this.data.has(key)) return Promise.resolve(undefined);
		return Promise.resolve(structuredClone(this.data.get(key)) as T);
	}

	set(key: string, value: unknown): Promise<void> {
		this.data.set(key, structuredClone(value));
		return Promise.resolve();
	}

	delete(key: string): Promise<void> {
		this.data.delete(key);
		return Promise.resolve();
	}
}

/** Browser IndexedDB storage with automatic localStorage fallback when IDB is unavailable. */
export class IndexedDbSyncStorage implements SyncStorageAdapter {
	private dbPromise: Promise<IDBDatabase | null> | undefined;

	private open(): Promise<IDBDatabase | null> {
		if (this.dbPromise) return this.dbPromise;
		if (typeof indexedDB === 'undefined') {
			this.dbPromise = Promise.resolve(null);
			return this.dbPromise;
		}
		this.dbPromise = new Promise<IDBDatabase | null>(resolve => {
			try {
				const request = indexedDB.open(DB_NAME, 1);
				request.onupgradeneeded = () => {
					const db = request.result;
					if (!db.objectStoreNames.contains(STORE_NAME)) {
						db.createObjectStore(STORE_NAME);
					}
				};
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => resolve(null);
			} catch {
				resolve(null);
			}
		});
		return this.dbPromise;
	}

	async get<T>(key: string): Promise<T | undefined> {
		const db = await this.open();
		if (!db) {
			try {
				const raw = localStorage.getItem(`${FALLBACK_PREFIX}${key}`);
				return raw ? JSON.parse(raw) as T : undefined;
			} catch {
				return undefined;
			}
		}
		return new Promise<T | undefined>(resolve => {
			try {
				const tx = db.transaction(STORE_NAME, 'readonly');
				const req = tx.objectStore(STORE_NAME).get(key);
				req.onsuccess = () => resolve(req.result as T | undefined);
				req.onerror = () => resolve(undefined);
			} catch {
				resolve(undefined);
			}
		});
	}

	async set(key: string, value: unknown): Promise<void> {
		const db = await this.open();
		if (!db) {
			try {
				localStorage.setItem(`${FALLBACK_PREFIX}${key}`, JSON.stringify(value));
			} catch {
				// Ignore fallback storage errors.
			}
			return;
		}
		await new Promise<void>((resolve, reject) => {
			try {
				const tx = db.transaction(STORE_NAME, 'readwrite');
				tx.objectStore(STORE_NAME).put(structuredClone(value), key);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
			} catch (error) {
				reject(error);
			}
		});
	}

	async delete(key: string): Promise<void> {
		const db = await this.open();
		if (!db) {
			try {
				localStorage.removeItem(`${FALLBACK_PREFIX}${key}`);
			} catch {
				// Ignore fallback errors.
			}
			return;
		}
		await new Promise<void>(resolve => {
			try {
				const tx = db.transaction(STORE_NAME, 'readwrite');
				tx.objectStore(STORE_NAME).delete(key);
				tx.oncomplete = () => resolve();
				tx.onerror = () => resolve();
			} catch {
				resolve();
			}
		});
	}
}
