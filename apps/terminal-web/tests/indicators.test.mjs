import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	INDICATOR_CATALOG, createMaRunner, defaultParamsFor, histogramBarColor,
} from '../src/data/indicator-catalog.ts';
import {
	MAX_MA_LINES, activePaneOrder, calculateEmaSeries, calculateRsiSeries, calculateSmaSeries,
	defaultIndicatorSettings, movePaneOrder, moveVisiblePane,
	nextLinePreset, parseIndicatorSettings, setIndicatorEnabled,
} from '../src/data/indicators.ts';

const candles = Array.from({ length: 120 }, (_, i) => {
	const close = +(100 + Math.sin(i / 5) * 8 + i * 0.15).toFixed(2);
	return {
		time: 1700000000 + i * 60,
		open: +(close - Math.cos(i / 3)).toFixed(2),
		high: +(close + 2.5).toFixed(2),
		low: +(close - 2.5).toFixed(2),
		close,
		volume: 100 + (i % 25) * 10,
	};
});

test('trading-signals SMA, EMA, and Wilder RSI support live replace matching full calculation', () => {
	const sma5 = calculateSmaSeries(candles, 5);
	assert.equal(sma5[0], null);
	assert.equal(sma5[3], null);
	assert.ok(typeof sma5[4] === 'number');

	// Verify replace = true matches full recalculation for SMA and EMA
	const modified = [...candles.slice(0, -1), { ...candles.at(-1), close: 150 }];
	for (const kind of ['ma', 'ema']) {
		const runner = createMaRunner(kind, 10);
		for (const c of candles) runner.update(c.close, false);
		const replaced = runner.update(150, true);
		const full = (kind === 'ma' ? calculateSmaSeries : calculateEmaSeries)(modified, 10).at(-1);
		assert.ok(Math.abs(replaced - full) < 1e-9, `${kind} replace should match full calc`);
	}

	const rsi14 = calculateRsiSeries(candles, 14);
	assert.equal(rsi14[0], null);
	assert.ok(rsi14.at(-1) >= 0 && rsi14.at(-1) <= 100);
});

test('every catalog indicator powered by trading-signals computes finite values and supports live replace', () => {
	const popular = INDICATOR_CATALOG.filter(i => i.popular);
	assert.ok(popular.length >= 8, 'Should expose popular indicators');
	assert.ok(INDICATOR_CATALOG.length >= 30, 'Should expose full trading-signals catalog');

	const modifiedLast = { ...candles.at(-1), close: candles.at(-1).close + 3, high: candles.at(-1).high + 3 };
	const modifiedSeries = [...candles.slice(0, -1), modifiedLast];

	for (const item of INDICATOR_CATALOG) {
		if (item.special) continue;
		assert.ok(item.createRunner, `${item.id} must provide createRunner`);
		const params = defaultParamsFor(item);
		const liveRunner = item.createRunner(params, item.defaultColor ?? '#2962ff');
		let hasFinite = false;
		for (const c of candles) {
			const out = liveRunner.update(c, false);
			for (const plot of liveRunner.plots) {
				const v = out[plot.key];
				if (v !== null) {
					assert.ok(Number.isFinite(v), `${item.id}.${plot.key} must be finite`);
					hasFinite = true;
				}
			}
		}
		assert.ok(hasFinite, `${item.id} should produce finite output within 120 bars`);

		// Verify live replace on the final bar matches fresh full recalculation
		const replacedOut = liveRunner.update(modifiedLast, true);
		const freshRunner = item.createRunner(params, item.defaultColor ?? '#2962ff');
		let fullOut = {};
		for (const c of modifiedSeries) fullOut = freshRunner.update(c, false);
		for (const plot of liveRunner.plots) {
			const a = replacedOut[plot.key];
			const b = fullOut[plot.key];
			if (a === null || b === null) assert.equal(a, b, `${item.id}.${plot.key} null mismatch on replace`);
			else assert.ok(Math.abs(a - b) < 1e-6, `${item.id}.${plot.key} replace mismatch: ${a} vs ${b}`);
		}
	}
});

test('settings enforce 5-line MA/EMA limit, migrate v1 -> v2, and manage dynamic pane order', () => {
	const settings = defaultIndicatorSettings();
	while (settings.maLines.length < MAX_MA_LINES) settings.maLines.push(nextLinePreset('ma', settings.maLines));
	assert.equal(nextLinePreset('ma', settings.maLines), null);

	// Enabling RSI and KDJ appends them to bottom of paneOrder
	setIndicatorEnabled(settings, 'rsi', true);
	setIndicatorEnabled(settings, 'kdj', true);
	assert.deepEqual(activePaneOrder(settings), ['price', 'macd', 'rsi', 'kdj']);

	settings.paneOrder = movePaneOrder(activePaneOrder(settings), 'rsi', -1);
	assert.deepEqual(activePaneOrder(settings), ['price', 'rsi', 'macd', 'kdj']);
	assert.deepEqual(parseIndicatorSettings(JSON.parse(JSON.stringify(settings))), settings);

	// Migrate schemaVersion 1 -> 2 losslessly
	const v1 = {
		schemaVersion: 1,
		maEnabled: true,
		maLines: [{ id: 'ma-1', period: 7, color: '#f5c542', visible: true }],
		emaEnabled: false,
		emaLines: [{ id: 'ema-1', period: 20, color: '#83bd8c', visible: true }],
		volume: true,
		macd: true,
		rsi: { enabled: true, period: 10, color: '#a78bfa' },
		paneOrder: ['rsi', 'price', 'macd'],
	};
	const migrated = parseIndicatorSettings(v1);
	assert.equal(migrated.schemaVersion, 2);
	assert.equal(migrated.enabled.macd, true);
	assert.equal(migrated.enabled.rsi, true);
	assert.equal(migrated.params.rsi.period, 10);
	assert.deepEqual(migrated.paneOrder, ['rsi', 'price', 'macd']);

	// Reject malformed inputs
	assert.throws(() => parseIndicatorSettings({ ...settings, enabled: { unknown: true } }));
	assert.throws(() => parseIndicatorSettings({ ...settings, params: { rsi: { period: 1 } } }));
	assert.throws(() => parseIndicatorSettings({ ...settings, paneOrder: ['macd'] }));

	// moveVisiblePane skips hidden panes
	assert.deepEqual(moveVisiblePane(['price', 'macd', 'rsi'], new Set(['price', 'rsi']), 'rsi', -1), ['rsi', 'macd', 'price']);
});

test('MACD histogram uses TradingView 4-state colors for above/below zero and growing/falling', () => {
	assert.equal(histogramBarColor(10, 5), '#26A69A');
	assert.equal(histogramBarColor(8, 10), '#B2DFDB');
	assert.equal(histogramBarColor(-10, -5), '#FF5252');
	assert.equal(histogramBarColor(-6, -10), '#FFCDD2');
});
