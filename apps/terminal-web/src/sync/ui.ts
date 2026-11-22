import { element, iconButton } from '../ui';
import type { SyncEngine, SyncViewState } from './engine';
import './sync.css';

function triggerDownload(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	document.body.append(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createSyncDialog(app: HTMLElement, engine: SyncEngine) {
	const dialog = element('dialog', 'sync-dialog');
	dialog.setAttribute('aria-label', '云同步与数据迁移');

	const head = element('div', 'dialog-heading');
	head.append(element('h2', '', '云同步与数据迁移'), iconButton('close', '关闭同步设置', () => dialog.close()));

	const body = element('div', 'sync-dialog-body');
	dialog.append(head, body);
	app.append(dialog);

	let feedbackText = '';
	let feedbackError = false;
	let busy = false;
	let draftUrl = '';
	let draftToken = '';
	let draftSyncedFromConfig = false;
	let importMode: 'merge' | 'replace' = 'merge';
	let latestView: SyncViewState = engine.getViewState();

	const fileInput = document.createElement('input');
	fileInput.type = 'file';
	fileInput.accept = '.json,application/json';
	fileInput.hidden = true;
	dialog.append(fileInput);

	fileInput.onchange = async () => {
		const file = fileInput.files?.[0];
		fileInput.value = '';
		if (!file) return;
		setFeedback('正在校验并导入 JSON 快照…', false);
		busy = true;
		render();
		try {
			const text = await file.text();
			await engine.importPortableJson(JSON.parse(text), importMode);
			setFeedback(importMode === 'replace' ? '已替换并恢复快照数据' : '已合并导入快照数据', false);
		} catch (error) {
			setFeedback(`导入失败：${error instanceof Error ? error.message : '文件格式无效'}`, true);
		} finally {
			busy = false;
			render();
		}
	};

	function setFeedback(text: string, isError: boolean): void {
		feedbackText = text;
		feedbackError = isError;
	}

	function render(): void {
		if (!dialog.open) return;
		const view = latestView;
		if (!draftSyncedFromConfig) {
			draftUrl = view.config.serverUrl;
			draftToken = view.config.token;
			draftSyncedFromConfig = true;
		}
		body.replaceChildren();

		// 1. Status Card
		const statusCard = element('section', 'sync-card');
		const statusHead = element('div', 'sync-card-head');
		statusHead.append(element('h3', '', `状态：${view.message}`));
		const syncNowBtn = element('button', 'sync-btn', '立即同步');
		syncNowBtn.type = 'button';
		syncNowBtn.disabled = busy || !view.config.enabled || view.status === 'syncing';
		syncNowBtn.onclick = () => {
			setFeedback('', false);
			void engine.syncNow();
		};
		statusHead.append(syncNowBtn);
		statusCard.append(statusHead);
		statusCard.append(element('p', 'sync-desc', '同步内容包含：自选列表、打开的标签页、各交易对周期、全部画线（含删除同步）、指标与常用周期。本机修改优先落盘，仅服务端确认后显示已同步。'));
		if (view.config.lastStoreId) {
			statusCard.append(element('div', 'sync-meta', `Store ID: ${view.config.lastStoreId.slice(0, 12)} · 待同步: ${view.pendingCount} · 冲突: ${view.conflictCount}`));
		}
		body.append(statusCard);

		// 2. Store Mismatch Card (when server switched / migrated to a fresh PC DB)
		if (view.storeMismatch) {
			const mismatchCard = element('section', 'sync-card warning');
			mismatchCard.append(element('h3', '', view.storeMismatch.reason === 'store_changed'
				? '检测到服务端存储库已变化'
				: '首次连接：本机与服务端均有数据'));
			mismatchCard.append(element('p', 'sync-desc', view.storeMismatch.reason === 'store_changed'
				? '可能是从服务器切换到了电脑本地新库，或服务器恢复了旧库。为防止覆盖画线，请选择处理方式：'
				: '为避免覆盖已有画线和周期设置，请选择首次同步方式：'));
			const actions = element('div', 'sync-actions');
			const runChoice = (choice: 'merge' | 'push_replace' | 'pull_replace', label: string) => {
				const btn = element('button', choice === 'merge' ? 'sync-btn primary' : 'sync-btn', label);
				btn.type = 'button';
				btn.disabled = busy;
				btn.onclick = async () => {
					busy = true;
					setFeedback('正在处理存储库同步…', false);
					render();
					try {
						await engine.resolveStoreMismatch(choice);
						setFeedback('已完成存储库同步', false);
					} catch (error) {
						setFeedback(error instanceof Error ? error.message : '操作失败', true);
					} finally {
						busy = false;
						render();
					}
				};
				return btn;
			};
			actions.append(
				runChoice('merge', '合并两端数据（推荐）'),
				runChoice('push_replace', '以本机覆盖服务端'),
				runChoice('pull_replace', '以服务端覆盖本机'),
			);
			mismatchCard.append(actions);
			body.append(mismatchCard);
		}

		// 3. Conflict Resolution Card
		if (view.conflicts.length > 0) {
			const conflictCard = element('section', 'sync-card danger');
			conflictCard.append(element('h3', '', `同步冲突（${view.conflicts.length}）`));
			conflictCard.append(element('p', 'sync-desc', '以下项目在另一设备已被修改，请逐项决定保留哪一版：'));
			for (const conflict of view.conflicts) {
				const row = element('div', 'sync-conflict-row');
				row.append(element('span', 'sync-conflict-label', conflict.label));
				const btns = element('div', 'sync-actions');
				const keepLocal = element('button', 'sync-btn primary', '保留本机');
				keepLocal.type = 'button';
				keepLocal.disabled = busy;
				keepLocal.onclick = () => { void engine.resolveConflict(conflict.id, 'local'); };
				const useServer = element('button', 'sync-btn', '采用服务端');
				useServer.type = 'button';
				useServer.disabled = busy;
				useServer.onclick = () => { void engine.resolveConflict(conflict.id, 'server'); };
				btns.append(keepLocal, useServer);
				row.append(btns);
				conflictCard.append(row);
			}
			body.append(conflictCard);
		}

		// 4. Connection Configuration Card
		const configCard = element('section', 'sync-card');
		configCard.append(element('h3', '', '自托管同步服务（单人 SQLite）'));

		const urlField = element('div', 'sync-field');
		const urlLabel = element('label');
		urlLabel.htmlFor = 'sync-server-url';
		urlLabel.append(element('span', '', '服务地址（Docker 同源部署可留空）'));
		const useOriginBtn = element('button', 'sync-link-btn', '填入当前地址');
		useOriginBtn.type = 'button';
		useOriginBtn.onclick = () => {
			draftUrl = window.location.origin;
			urlInput.value = draftUrl;
		};
		urlLabel.append(useOriginBtn);
		const urlInput = element('input');
		urlInput.id = 'sync-server-url';
		urlInput.type = 'url';
		urlInput.placeholder = '例如 https://charts.example.com 或 http://192.168.1.10:8080';
		urlInput.value = draftUrl;
		urlInput.oninput = () => { draftUrl = urlInput.value; };
		urlField.append(urlLabel, urlInput);

		const tokenField = element('div', 'sync-field');
		const tokenLabel = element('label');
		tokenLabel.htmlFor = 'sync-access-token';
		tokenLabel.textContent = '访问口令（SYNC_TOKEN，仅存于本机）';
		const tokenInput = element('input');
		tokenInput.id = 'sync-access-token';
		tokenInput.type = 'password';
		tokenInput.autocomplete = 'current-password';
		tokenInput.placeholder = '至少 8 位，与服务端 .env 中 SYNC_TOKEN 一致';
		tokenInput.value = draftToken;
		tokenInput.oninput = () => { draftToken = tokenInput.value; };
		tokenField.append(tokenLabel, tokenInput);

		const cfgActions = element('div', 'sync-actions');
		const testBtn = element('button', 'sync-btn', '测试连接');
		testBtn.type = 'button';
		testBtn.disabled = busy;
		testBtn.onclick = async () => {
			busy = true;
			setFeedback('正在测试连接…', false);
			render();
			try {
				const res = await engine.testConnection(draftUrl, draftToken);
				setFeedback(`连接成功（SQLite Store: ${res.storeId.slice(0, 8)}）`, false);
			} catch (error) {
				setFeedback(error instanceof Error ? error.message : '连接失败', true);
			} finally {
				busy = false;
				render();
			}
		};

		const saveBtn = element('button', 'sync-btn primary', view.config.enabled ? '保存并同步' : '启用云同步');
		saveBtn.type = 'button';
		saveBtn.disabled = busy;
		saveBtn.onclick = async () => {
			busy = true;
			setFeedback('正在保存并同步…', false);
			render();
			try {
				await engine.configure({ serverUrl: draftUrl, token: draftToken, enabled: true });
				setFeedback('已启用云同步', false);
			} catch (error) {
				setFeedback(error instanceof Error ? error.message : '保存失败', true);
			} finally {
				busy = false;
				render();
			}
		};

		cfgActions.append(testBtn, saveBtn);
		if (view.config.enabled) {
			const disableBtn = element('button', 'sync-btn danger', '停用同步');
			disableBtn.type = 'button';
			disableBtn.disabled = busy;
			disableBtn.onclick = async () => {
				busy = true;
				try {
					await engine.configure({ serverUrl: draftUrl, token: draftToken, enabled: false });
					setFeedback('已停用云同步，当前继续使用本机数据', false);
				} finally {
					busy = false;
					render();
				}
			};
			cfgActions.append(disableBtn);
		}
		configCard.append(urlField, tokenField, cfgActions);
		body.append(configCard);

		// 5. Portability & Migration Card (Server <-> PC)
		const backupCard = element('section', 'sync-card');
		backupCard.append(element('h3', '', '数据迁移与备份（服务器 ↔ 电脑）'));
		backupCard.append(element('p', 'sync-desc', '服务器关机前可下载单个 SQLite 备份文件放到电脑运行；若服务器已关机，可直接导出本机 JSON 快照并导入电脑新库。'));

		const backupActions = element('div', 'sync-actions');
		const sqliteBtn = element('button', 'sync-btn', '下载 SQLite 备份 (.db)');
		sqliteBtn.type = 'button';
		sqliteBtn.disabled = busy || !view.config.enabled;
		sqliteBtn.title = view.config.enabled ? '通过 VACUUM INTO 在线热备完整单文件数据库' : '连接同步服务后可用';
		sqliteBtn.onclick = async () => {
			busy = true;
			setFeedback('正在生成 SQLite 热备份…', false);
			render();
			try {
				const { blob, filename } = await engine.downloadBackup();
				triggerDownload(blob, filename);
				setFeedback(`已下载 ${filename}`, false);
			} catch (error) {
				setFeedback(error instanceof Error ? error.message : '下载备份失败', true);
			} finally {
				busy = false;
				render();
			}
		};

		const exportJsonBtn = element('button', 'sync-btn', '导出本机 JSON 快照');
		exportJsonBtn.type = 'button';
		exportJsonBtn.disabled = busy;
		exportJsonBtn.onclick = () => {
			const snapshot = engine.exportPortableJson();
			const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
			const stamp = new Date().toISOString().slice(0, 10);
			triggerDownload(blob, `crypto-terminal-snapshot-${stamp}.json`);
			setFeedback('已导出完整本机 JSON 快照（含交易对周期、画线与指标设置）', false);
			render();
		};
		backupActions.append(sqliteBtn, exportJsonBtn);

		const importRow = element('div', 'sync-import-row');
		const modeSelect = element('select');
		modeSelect.setAttribute('aria-label', 'JSON 导入模式');
		const mergeOpt = document.createElement('option');
		mergeOpt.value = 'merge';
		mergeOpt.textContent = '合并导入';
		const replaceOpt = document.createElement('option');
		replaceOpt.value = 'replace';
		replaceOpt.textContent = '替换覆盖';
		modeSelect.append(mergeOpt, replaceOpt);
		modeSelect.value = importMode;
		modeSelect.onchange = () => { importMode = modeSelect.value === 'replace' ? 'replace' : 'merge'; };

		const importBtn = element('button', 'sync-btn', '导入 JSON 快照…');
		importBtn.type = 'button';
		importBtn.disabled = busy;
		importBtn.onclick = () => fileInput.click();
		importRow.append(modeSelect, importBtn);

		backupCard.append(backupActions, importRow);
		body.append(backupCard);

		if (feedbackText) {
			const fb = element('p', `sync-feedback${feedbackError ? ' error' : ''}`, feedbackText);
			fb.setAttribute('role', 'status');
			body.append(fb);
		}
	}

	const unsubscribe = engine.subscribe(view => {
		latestView = view;
		if (dialog.open) render();
	});

	return {
		open(): void {
			draftSyncedFromConfig = false;
			feedbackText = '';
			feedbackError = false;
			if (!dialog.open) dialog.showModal();
			render();
		},
		close(): void {
			if (dialog.open) dialog.close();
		},
		destroy(): void {
			unsubscribe();
			dialog.remove();
		},
	};
}
