import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closeTab, emptyWorkspace, instrumentKey, openInstrument, parseWorkspace, setTimeframe } from '../src/index';

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

void test('untrusted snapshots reject unsupported versions, dangling references and duplicates', () => {
	const state = openInstrument(emptyWorkspace(), btc);
	assert.deepEqual(parseWorkspace(JSON.parse(JSON.stringify(state))), state);
	assert.throws(() => parseWorkspace({ ...state, schemaVersion: 2 }));
	assert.throws(() => parseWorkspace({ ...state, activeTabId: 'missing' }));
	assert.throws(() => parseWorkspace({ ...state, preferences: {} }));
	assert.throws(() => parseWorkspace({ ...state, tabs: [...state.tabs, ...state.tabs] }));
	assert.throws(() => parseWorkspace({ ...state, preferences: { [instrumentKey(btc)]: { instrument: btc, timeframe: '2s' } } }));
});
