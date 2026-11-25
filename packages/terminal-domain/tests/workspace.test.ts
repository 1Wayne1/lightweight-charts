import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closeTab, emptyWorkspace, instrumentKey, moveTab, openInstrument, parseInstrumentKey, parseSyncSnapshot, parseWorkspace, parseWorkspaceTabsSnapshot, setTimeframe } from '../src/index';

const btc = { venue: 'demo', market: 'spot', symbol: 'BTC-USDT' } as const;
const eth = { ...btc, symbol: 'ETH-USDT' };

void test('changing BTC timeframe preserves ETH and the previous state', () => {
	const state = openInstrument(openInstrument(emptyWorkspace(), btc), eth);
	const changed = setTimeframe(state, instrumentKey(btc), '4h');
	assert.equal(changed.preferences[instrumentKey(btc)].timeframe, '4h');
	assert.equal(changed.preferences[instrumentKey(eth)].timeframe, '1h');
	assert.equal(state.preferences[instrumentKey(btc)].timeframe, '1h');
	assert.equal(changed.activeTabId, instrumentKey(eth));
});

void test('closing and reopening restores instrument preferences; duplicate opens focus', () => {
	const state = setTimeframe(openInstrument(emptyWorkspace(), btc), instrumentKey(btc), '15m');
	const closed = closeTab(state, instrumentKey(btc));
	assert.equal(closed.activeTabId, null);
	const restored = openInstrument(parseWorkspace(JSON.parse(JSON.stringify(closed))), btc);
	assert.equal(restored.preferences[instrumentKey(btc)].timeframe, '15m');
	assert.equal(openInstrument(restored, btc).tabs.length, 1);
});

void test('same symbol on different venues or markets has isolated preferences', () => {
	const otherVenue = { ...btc, venue: 'another' };
	const perpetual = { ...btc, market: 'perpetual' } as const;
	let state = openInstrument(openInstrument(openInstrument(emptyWorkspace(), btc), otherVenue), perpetual);
	state = setTimeframe(state, instrumentKey(btc), '1d');
	assert.equal(state.tabs.length, 3);
	assert.equal(state.preferences[instrumentKey(otherVenue)].timeframe, '1h');
	assert.equal(state.preferences[instrumentKey(perpetual)].timeframe, '1h');
});

void test('closing inactive tab keeps focus; closing active tab picks its neighbor', () => {
	const state = openInstrument(openInstrument(emptyWorkspace(), btc), eth);
	assert.equal(closeTab(state, instrumentKey(btc)).activeTabId, instrumentKey(eth));
	assert.equal(closeTab(state, instrumentKey(eth)).activeTabId, instrumentKey(btc));
});

void test('reordering keeps chart identity and isolated preferences through persistence, close and reopen', () => {
	const perpetual = { ...btc, market: 'perpetual' } as const;
	let state = openInstrument(openInstrument(openInstrument(emptyWorkspace(), btc), eth), perpetual);
	state = setTimeframe(setTimeframe(state, instrumentKey(btc), '4h'), instrumentKey(eth), '15m');
	const originalIds = state.tabs.map(tab => tab.id);
	const moved = moveTab(state, instrumentKey(perpetual), 0);
	assert.deepEqual(moved.tabs.map(tab => tab.id), [originalIds[2], originalIds[0], originalIds[1]]);
	assert.deepEqual(state.tabs.map(tab => tab.id), originalIds, 'Input is immutable');
	assert.equal(moved.activeTabId, state.activeTabId);
	assert.equal(moved.preferences, state.preferences);
	const restored = parseWorkspace(JSON.parse(JSON.stringify(moved)));
	assert.deepEqual(restored, moved);
	assert.deepEqual(moveTab(restored, originalIds[2], 2).tabs.map(tab => tab.id), originalIds);
	const duplicate = openInstrument(restored, btc);
	assert.deepEqual(duplicate.tabs, restored.tabs);
	assert.equal(duplicate.activeTabId, instrumentKey(btc));
	const reopened = openInstrument(closeTab(duplicate, instrumentKey(btc)), btc);
	assert.equal(reopened.preferences[instrumentKey(btc)].timeframe, '4h');
	assert.equal(reopened.preferences[instrumentKey(eth)].timeframe, '15m');
	assert.equal(reopened.preferences[instrumentKey(perpetual)].timeframe, '1h');
	assert.equal(closeTab(restored, instrumentKey(perpetual)).activeTabId, instrumentKey(btc));
});

void test('invalid or unchanged tab moves leave the workspace untouched', () => {
	const state = openInstrument(openInstrument(emptyWorkspace(), btc), eth);
	for (const index of [-1, 2, .5, NaN, Infinity, 0]) assert.equal(moveTab(state, instrumentKey(btc), index), state);
	assert.equal(moveTab(state, 'missing', 1), state);
	const empty = emptyWorkspace();
	assert.equal(moveTab(empty, instrumentKey(btc), 0), empty);
});

void test('untrusted snapshots reject unsupported versions, dangling references and duplicates', () => {
	const state = openInstrument(emptyWorkspace(), btc);
	assert.deepEqual(parseWorkspace(JSON.parse(JSON.stringify(state))), state);
	assert.throws(() => parseWorkspace({ ...state, schemaVersion: 2 }));
	assert.throws(() => parseWorkspace({ ...state, activeTabId: 'missing' }));
	assert.throws(() => parseWorkspace({ ...state, preferences: {} }));
	assert.throws(() => parseWorkspace({ ...state, tabs: [...state.tabs, ...state.tabs] }));
	assert.throws(() => parseWorkspace({ ...state, preferences: { [instrumentKey(btc)]: { instrument: btc, timeframe: '2s' } } }));
});

void test('parseInstrumentKey and parseSyncSnapshot validate and reject malformed snapshots', () => {
	assert.deepEqual(parseInstrumentKey('binance:perpetual:BTC-USDT'), { venue: 'binance', market: 'perpetual', symbol: 'BTC-USDT' });
	assert.throws(() => parseInstrumentKey('BTCUSDT'));
	assert.throws(() => parseInstrumentKey('binance:delivery:BTC-USDT'));

	const snapshot = {
		schemaVersion: 1,
		storeId: 'store-1',
		exportedAt: '2026-11-22T12:00:00.000Z',
		instruments: [{
			instrumentKey: 'binance:spot:BTC-USDT',
			instrument: { venue: 'binance', market: 'spot', symbol: 'BTC-USDT' },
			timeframe: '4h',
			revision: 2,
			updatedAt: '2026-11-22T12:00:00.000Z',
		}],
		drawings: [{
			schemaVersion: 1,
			id: 'line-1',
			instrumentKey: 'binance:spot:BTC-USDT',
			kind: 'trend-line',
			anchors: [{ time: 1700000000, price: 60000 }, { time: 1700086400, price: 62000 }],
			style: { color: '#2962ff' },
			revision: 3,
			deleted: true,
			updatedAt: '2026-11-22T12:00:00.000Z',
		}],
		settings: {
			timeframes: {
				key: 'timeframes',
				value: { schemaVersion: 1, favorites: ['1h', '4h'], collapsedGroups: [] },
				revision: 1,
				updatedAt: '2026-11-22T12:00:00.000Z',
			},
		},
	};
	const parsed = parseSyncSnapshot(snapshot);
	assert.equal(parsed.drawings[0].deleted, true);
	assert.equal(parsed.instruments[0].timeframe, '4h');
	assert.throws(() => parseSyncSnapshot({ ...snapshot, schemaVersion: 2 }));
	assert.throws(() => parseSyncSnapshot({ ...snapshot, settings: { unknown: { key: 'unknown', value: {}, revision: 1, updatedAt: '2026-11-22T12:00:00.000Z' } } }));

	const tabsSnap = parseWorkspaceTabsSnapshot({
		schemaVersion: 1,
		tabs: [{ id: 'binance:spot:BTC-USDT', instrumentKey: 'binance:spot:BTC-USDT' }],
		activeTabId: 'binance:spot:BTC-USDT',
	});
	assert.equal(tabsSnap.tabs.length, 1);
	assert.throws(() => parseWorkspaceTabsSnapshot({ schemaVersion: 1, tabs: [], activeTabId: 'missing' }));
	assert.throws(() => parseWorkspaceTabsSnapshot({ schemaVersion: 1, tabs: [{ id: 'bad', instrumentKey: 'BTCUSDT' }], activeTabId: 'bad' }));
});
