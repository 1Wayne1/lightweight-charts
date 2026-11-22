import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	CUSTOM_COLORS_STORAGE_KEY,
	CustomColorRepository,
	MAX_CUSTOM_COLORS,
	TV_PRIMARY_COLORS,
	TV_SHADE_COLORS,
	formatHexWithAlpha,
	hexToHsv,
	hsvToHex,
	parseCustomColorsStore,
	parseHexColor,
} from '../src/drawings/color-palette';

function memoryStorage() {
	const map = new Map();
	return {
		getItem: key => map.get(key) ?? null,
		setItem: (key, value) => { map.set(key, value); },
	};
}

test('TradingView palette has 20 primary + 60 shade swatches of valid 6-digit hex colors', () => {
	assert.equal(TV_PRIMARY_COLORS.length, 20);
	assert.equal(TV_SHADE_COLORS.length, 60);
	for (const color of [...TV_PRIMARY_COLORS, ...TV_SHADE_COLORS]) {
		assert.match(color, /^#[0-9a-f]{6}$/);
	}
	// Verify core colors used by existing drawing flows exist in the palette.
	assert.ok(TV_PRIMARY_COLORS.includes('#089981'));
	assert.ok(TV_PRIMARY_COLORS.includes('#9c27b0'));
	assert.ok(TV_PRIMARY_COLORS.includes('#ff9800'));
});

test('HEX <-> HSV conversions and alpha encoding round trip accurately', () => {
	for (const hex of ['#ff0000', '#00ff00', '#0000ff', '#ffa726', '#2962ff', '#ffffff', '#000000', '#4f82bd']) {
		const hsv = hexToHsv(hex);
		const back = hsvToHex(hsv);
		assert.equal(back, hex);
	}
	assert.deepEqual(parseHexColor('#abc'), { hex: '#aabbcc', alpha: 1 });
	const half = formatHexWithAlpha('#ffeb3b', 0.5);
	assert.equal(half, '#ffeb3b80');
	const parsedHalf = parseHexColor(half);
	assert.equal(parsedHalf.hex, '#ffeb3b');
	assert.ok(Math.abs(parsedHalf.alpha - 0.5) < 0.01);
	assert.equal(formatHexWithAlpha('#ffeb3b', 1), '#ffeb3b');
});

test('CustomColorRepository persists, deduplicates, caps and removes custom colors safely', () => {
	const storage = memoryStorage();
	const repo = new CustomColorRepository(storage);
	assert.deepEqual(repo.list(), []);

	repo.add('#FFA726');
	repo.add('#4f82bd');
	repo.add('#ffa726');
	assert.deepEqual(repo.list(), ['#4f82bd', '#ffa726']);

	// Reload from persisted storage.
	const reloaded = new CustomColorRepository(storage);
	assert.deepEqual(reloaded.list(), ['#4f82bd', '#ffa726']);

	reloaded.remove('#4f82bd');
	assert.deepEqual(reloaded.list(), ['#ffa726']);

	// Cap at MAX_CUSTOM_COLORS.
	for (let i = 0; i < MAX_CUSTOM_COLORS + 5; i++) {
		reloaded.add(`#${i.toString(16).padStart(6, '0')}`);
	}
	assert.equal(reloaded.list().length, MAX_CUSTOM_COLORS);
	assert.ok(storage.getItem(CUSTOM_COLORS_STORAGE_KEY));

	assert.throws(() => parseCustomColorsStore({ schemaVersion: 2, colors: [] }));
	assert.throws(() => parseCustomColorsStore({ schemaVersion: 1, colors: ['not-a-color'] }));
});
