import assert from 'node:assert/strict';
import test from 'node:test';
import { TIMEFRAMES, TIMEFRAME_SECONDS } from '@terminal/domain';
import {
	DEFAULT_FAVORITE_TIMEFRAMES, TIMEFRAME_GROUPS, TIMEFRAME_LONG_LABELS, TIMEFRAME_SHORT_LABELS,
	defaultTimeframePreferences, parseTimeframePreferences, toggleFavoriteTimeframe, toggleTimeframeGroup,
	visibleToolbarTimeframes,
} from '../src/data/timeframes.ts';

test('timeframe catalog covers all Binance spot/perpetual intervals with labels and seconds', () => {
	const grouped = TIMEFRAME_GROUPS.flatMap(group => group.timeframes);
	assert.deepEqual(grouped, [...TIMEFRAMES]);
	for (const tf of TIMEFRAMES) {
		assert.ok(TIMEFRAME_SECONDS[tf] > 0);
		assert.ok(TIMEFRAME_SHORT_LABELS[tf].length > 0);
		assert.ok(TIMEFRAME_LONG_LABELS[tf].length > 0);
	}
	assert.ok(DEFAULT_FAVORITE_TIMEFRAMES.includes('1h'));
	assert.ok(DEFAULT_FAVORITE_TIMEFRAMES.includes('4h'));
});

test('favorite timeframes toggle in canonical order and show unstarred active timeframe', () => {
	let prefs = defaultTimeframePreferences();
	assert.equal(prefs.favorites.includes('8h'), false);
	assert.deepEqual(visibleToolbarTimeframes(prefs, '8h'), ['8h', ...prefs.favorites]);
	assert.deepEqual(visibleToolbarTimeframes(prefs, '4h'), prefs.favorites);

	prefs = toggleFavoriteTimeframe(prefs, '8h');
	assert.equal(prefs.favorites.includes('8h'), true);
	assert.ok(prefs.favorites.indexOf('4h') < prefs.favorites.indexOf('8h'));
	assert.ok(prefs.favorites.indexOf('8h') < prefs.favorites.indexOf('1d'));

	prefs = toggleFavoriteTimeframe(prefs, '5m');
	assert.equal(prefs.favorites.includes('5m'), false);

	prefs = toggleTimeframeGroup(prefs, 'minutes');
	assert.deepEqual(prefs.collapsedGroups, ['minutes']);
	assert.deepEqual(parseTimeframePreferences(JSON.parse(JSON.stringify(prefs))), prefs);
});

test('timeframe preferences validation rejects unknown intervals, duplicates and bad schema', () => {
	const valid = defaultTimeframePreferences();
	assert.deepEqual(parseTimeframePreferences({ schemaVersion: 1, favorites: ['1m', '4h'] }), {
		schemaVersion: 1, favorites: ['1m', '4h'], collapsedGroups: [],
	});
	for (const bad of [
		{ ...valid, schemaVersion: 2 },
		{ ...valid, favorites: ['2s'] },
		{ ...valid, favorites: ['1m', '1m'] },
		{ ...valid, favorites: '1m' },
		{ ...valid, collapsedGroups: ['unknown'] },
		{ ...valid, collapsedGroups: ['minutes', 'minutes'] },
	]) {
		assert.throws(() => parseTimeframePreferences(bad));
	}
});
