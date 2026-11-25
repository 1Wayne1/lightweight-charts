import assert from 'node:assert/strict';
import test from 'node:test';
import type { IChartApi, ISeriesApi, Logical, SeriesType } from 'lightweight-charts';
import { FibRetracementDrawing } from '../src/tools/fib-retracement.ts';
import { FibExtensionDrawing, TrendFibTimeDrawing } from '../src/tools/fib-extension.ts';
import { formatWaveLabels, PatternDrawing, vertexLabelDirection } from '../src/tools/patterns.ts';
import { buildPositionDefaultAnchors, flipPosition, PositionDrawing } from '../src/tools/position.ts';
import { decodeExternalId, encodeExternalId, type AnchorPoint, type WaveDegree } from '../src/types.ts';

function createMockTarget(width = 800, height = 500) {
	const fillTexts: Array<{ text: string; x: number; y: number }> = [];
	const strokeTexts: Array<{ text: string; x: number; y: number }> = [];
	let fillCalls = 0;

	const ctx = {
		fillStyle: '',
		strokeStyle: '',
		lineWidth: 1,
		font: '',
		textBaseline: 'alphabetic',
		textAlign: 'start',
		lineCap: 'butt',
		lineJoin: 'miter',
		save() {},
		restore() {},
		beginPath() {},
		closePath() {},
		rect() {},
		clip() {},
		moveTo() {},
		lineTo() {},
		quadraticCurveTo() {},
		fill() { fillCalls++; },
		stroke() {},
		fillRect() {},
		strokeRect() {},
		setLineDash() {},
		arc() {},
		roundRect() {},
		measureText: (text: string) => ({ width: text.length * 7 }),
		fillText(text: string, x: number, y: number) { fillTexts.push({ text, x, y }); },
		strokeText(text: string, x: number, y: number) { strokeTexts.push({ text, x, y }); },
	};

	const target = {
		useMediaCoordinateSpace(cb: (scope: { context: typeof ctx; mediaSize: { width: number; height: number } }) => void) {
			cb({ context: ctx, mediaSize: { width, height } });
		},
	};

	return {
		target: target as never,
		fillTexts,
		strokeTexts,
		get fillCalls() { return fillCalls; },
		reset() {
			fillTexts.length = 0;
			strokeTexts.length = 0;
			fillCalls = 0;
		},
	};
}

function createMockChartAndSeries() {
	const timescale = {
		coordinateToLogical: (x: number) => (x / 20) as Logical,
		logicalToCoordinate: (logical: number) => logical * 20,
		coordinateToTime: (x: number) => 1000 + Math.round(x / 20) * 60,
		timeToCoordinate: (t: number) => ((t - 1000) / 60) * 20,
		getVisibleLogicalRange: () => ({ from: 0 as Logical, to: 100 as Logical }),
		width: () => 800,
	};
	const paneApi = {
		getHeight: () => 500,
	};
	const chart = {
		timeScale: () => timescale,
		horzBehaviour: () => ({
			formatHorzItem: (t: unknown) => String(t),
			convertHorzItemToInternal: (t: unknown) => t,
		}),
	} as unknown as IChartApi;
	const series = {
		// Invert Y cleanly like real charts: higher price -> smaller Y pixel
		priceToCoordinate: (price: number) => 500 - price,
		coordinateToPrice: (y: number) => 500 - y,
		getPane: () => paneApi,
		priceFormatter: () => ({ format: (p: number) => p.toFixed(2) }),
		subscribeDataChanged() {},
		unsubscribeDataChanged() {},
	} as unknown as ISeriesApi<SeriesType>;
	return { chart, series };
}

function attachDrawing<T extends { attached: (p: never) => void; updateAllViews: () => void }>(
	drawing: T,
	chart: IChartApi,
	series: ISeriesApi<SeriesType>
): T {
	drawing.attached({ chart, series, requestUpdate() {} } as never);
	drawing.updateAllViews();
	return drawing;
}

test('externalId round-trips semantic handle hit parts alongside anchor and body', () => {
	const encoded = encodeExternalId({ drawingId: 'pos_1', part: 'handle', handleId: 'target' });
	assert.equal(encoded, 'dt:pos_1:handle:target');
	assert.deepEqual(decodeExternalId(encoded), {
		drawingId: 'pos_1',
		part: 'handle',
		handleId: 'target',
	});
	const compound = encodeExternalId({ drawingId: 'fib_1', part: 'handle', handleId: 'corner:1' });
	assert.deepEqual(decodeExternalId(compound), {
		drawingId: 'fib_1',
		part: 'handle',
		handleId: 'corner:1',
	});
});

test('position 1-click defaults, 4 semantic handles, clamping and flipPosition', () => {
	const { chart, series } = createMockChartAndSeries();
	const entry: AnchorPoint = { logical: 20 as Logical, time: (1000 + 20 * 60) as never, price: 200 };

	const longDefaults = buildPositionDefaultAnchors('long-position', entry, chart, series);
	assert.equal(longDefaults.length, 3);
	assert.equal(longDefaults[0].price, 200);
	assert.ok(longDefaults[1].price < 200, 'long stop is below entry');
	assert.ok(longDefaults[2].price > 200, 'long target is above entry');
	assert.equal(longDefaults[1].logical, longDefaults[2].logical);
	assert.ok(longDefaults[1].logical > entry.logical);

	const shortDefaults = buildPositionDefaultAnchors('short-position', entry, chart, series);
	assert.ok(shortDefaults[1].price > 200, 'short stop is above entry');
	assert.ok(shortDefaults[2].price < 200, 'short target is below entry');

	const pos = attachDrawing(new PositionDrawing('long-position', 'p1', longDefaults), chart, series);
	const handles = pos.editHandles();
	assert.deepEqual(handles.map(h => h.id), ['entry', 'right', 'target', 'stop']);
	assert.deepEqual(handles.map(h => h.cursor), ['move', 'ew-resize', 'ns-resize', 'ns-resize']);

	// Clamping: target cannot cross below entry; stop cannot cross above entry; right cannot move left of entry
	const clampedTarget = pos.applyHandleDrag('target', { logical: 25 as Logical, price: 120 }, longDefaults)!;
	assert.equal(clampedTarget[2].price, 200);
	const clampedStop = pos.applyHandleDrag('stop', { logical: 25 as Logical, price: 290 }, longDefaults)!;
	assert.equal(clampedStop[1].price, 200);
	const draggedRight = pos.applyHandleDrag('right', { logical: 5 as Logical, price: 200 }, longDefaults)!;
	assert.equal(draggedRight[1].logical, 21);
	assert.equal(draggedRight[2].logical, 21);

	const axisLabels = pos.customAxisLabels(chart, series)!;
	assert.equal(axisLabels.price.length, 3);
	assert.equal(axisLabels.price[0].color, '#089981');
	assert.equal(axisLabels.price[2].color, '#F23645');
	assert.equal(axisLabels.time.length, 2);

	// Flipping long -> short preserves risk/reward distances and mirrors around entry
	const flipped = flipPosition('long-position', longDefaults);
	assert.equal(flipped.type, 'short-position');
	assert.equal(flipped.points[0].price, 200);
	assert.ok(Math.abs((flipped.points[1].price - 200) - (200 - longDefaults[1].price)) < 1e-9);
	assert.ok(Math.abs((200 - flipped.points[2].price) - (longDefaults[2].price - 200)) < 1e-9);
});

test('pattern labels adapt to peaks/troughs, support all 6 wave degrees and de-clutter axis labels', () => {
	const { chart, series } = createMockChartAndSeries();

	// Upward impulse: 0 (low), 1 (peak), 2 (trough), 3 (peak), 4 (trough), 5 (peak)
	const upwardPts = [
		{ x: 0, y: 400 },
		{ x: 40, y: 300 },
		{ x: 80, y: 350 },
		{ x: 120, y: 200 },
		{ x: 160, y: 260 },
		{ x: 200, y: 120 },
	];
	assert.deepEqual(
		upwardPts.map((_, i) => vertexLabelDirection(upwardPts, i)),
		[1, -1, 1, -1, 1, -1]
	);

	// Downward impulse: 0 (high), 1 (trough), 2 (peak), 3 (trough), 4 (peak), 5 (trough)
	const downwardPts = upwardPts.map(pt => ({ x: pt.x, y: 500 - pt.y }));
	assert.deepEqual(
		downwardPts.map((_, i) => vertexLabelDirection(downwardPts, i)),
		[-1, 1, -1, 1, -1, 1]
	);

	const expectedDegrees: Record<WaveDegree, readonly string[]> = {
		primary: ['⓪', '①', '②', '③', '④', '⑤'],
		intermediate: ['(0)', '(1)', '(2)', '(3)', '(4)', '(5)'],
		minor: ['0', '1', '2', '3', '4', '5'],
		minute: ['[0]', '[i]', '[ii]', '[iii]', '[iv]', '[v]'],
		minuette: ['(0)', '(i)', '(ii)', '(iii)', '(iv)', '(v)'],
		subminuette: ['0', 'i', 'ii', 'iii', 'iv', 'v'],
	};
	for (const [degree, expected] of Object.entries(expectedDegrees) as Array<[WaveDegree, readonly string[]]>) {
		assert.deepEqual(formatWaveLabels('elliott-impulse', degree), expected);
	}

	const anchors: AnchorPoint[] = upwardPts.map((pt, i) => ({
		logical: (i * 2) as Logical,
		time: (1000 + i * 120) as never,
		price: 500 - pt.y,
	}));
	const wave = attachDrawing(
		new PatternDrawing('elliott-impulse', 'w1', anchors, { waveDegree: 'primary', waveShowLines: false }),
		chart,
		series
	);
	assert.equal(wave.previewStepLabel(2), '艾略特推动浪 (3/6) · 点击放置浪 ②');
	assert.equal(wave.options().waveShowLines, false);

	// Selected multi-point drawing shows only start & end axis labels until a middle handle is hovered
	wave.setSelected(true);
	assert.equal(wave.priceAxisViews().filter(v => v.visible()).length, 2);
	wave.setHoverState(true, 2, '2');
	assert.equal(wave.priceAxisViews().filter(v => v.visible()).length, 1);
	assert.equal(wave.priceAxisViews()[0].text(), anchors[2].price.toFixed(2));
});

test('fib retracement exposes 4 corner handles and fib extension provides phased hints', () => {
	const { chart, series } = createMockChartAndSeries();
	const a0: AnchorPoint = { logical: 5 as Logical, time: (1000 + 300) as never, price: 100 };
	const a1: AnchorPoint = { logical: 15 as Logical, time: (1000 + 900) as never, price: 200 };
	const fib = attachDrawing(new FibRetracementDrawing('f1', [a0, a1]), chart, series);

	const handles = fib.editHandles();
	assert.deepEqual(handles.map(h => h.id), ['0', '1', 'c1', 'c2']);
	assert.deepEqual(handles[2].point, { x: 100, y: 300 }); // (p1.x, p2.y)
	assert.deepEqual(handles[3].point, { x: 300, y: 400 }); // (p2.x, p1.y)

	const draggedC1 = fib.applyHandleDrag('c1', { logical: 7 as Logical, price: 240 }, [a0, a1])!;
	assert.equal(draggedC1[0].logical, 7);
	assert.equal(draggedC1[0].price, 100);
	assert.equal(draggedC1[1].logical, 15);
	assert.equal(draggedC1[1].price, 240);

	const ext = attachDrawing(new FibExtensionDrawing('fe1', [a0, a1, { logical: 20 as Logical, price: 150 }]), chart, series);
	assert.equal(ext.previewStepLabel(0), '趋势斐波那契扩展 (1/3) · 点击放置趋势起点 A');
	assert.equal(ext.previewStepLabel(1), '趋势斐波那契扩展 (2/3) · 点击放置趋势终点 B');
	assert.equal(ext.previewStepLabel(2), '趋势斐波那契扩展 (3/3) · 点击放置回撤起点 C');
});

test('idle position hides canvas stat pills while keeping colored right price axis tags until hovered', () => {
	const { chart, series } = createMockChartAndSeries();
	const spy = createMockTarget();
	const entry: AnchorPoint = { logical: 10 as Logical, time: (1000 + 10 * 60) as never, price: 200 };
	const anchors = buildPositionDefaultAnchors('long-position', entry, chart, series);

	const pos = new PositionDrawing('long-position', 'pos_idle', anchors);
	const initialPriceArrayRef = pos.priceAxisViews();
	attachDrawing(pos, chart, series);

	// Reference replacement protects against Lightweight Charts SeriesPrimitiveWrapper array cache staleness
	assert.notEqual(pos.priceAxisViews(), initialPriceArrayRef);
	assert.equal(pos.options().alwaysShowStats, false);

	// 1. Idle (unselected, not hovered): 0 canvas text pills, 3 persistent colored price tags, 0 time tags
	pos.draw(spy.target);
	assert.equal(spy.fillTexts.length, 0);
	assert.equal(spy.fillCalls, 0);
	const priceViews = pos.priceAxisViews().filter(v => v.visible());
	assert.equal(priceViews.length, 3);
	assert.deepEqual(priceViews.map(v => v.backColor()), ['#089981', '#5D606B', '#F23645']);
	assert.equal(pos.timeAxisViews().filter(v => v.visible()).length, 0);

	// 2. Hover enter: reveals all 3 stat pills and 2 time axis labels
	spy.reset();
	pos.setHoverState(true, null, null);
	pos.draw(spy.target);
	assert.equal(spy.fillTexts.length, 3);
	assert.ok(spy.fillTexts.some(t => t.text.includes('盈亏比:')));
	assert.equal(pos.timeAxisViews().filter(v => v.visible()).length, 2);

	// 3. Hover leave: re-hides canvas stat pills and time labels, preserves right price axis tags
	spy.reset();
	pos.setHoverState(false, null, null);
	pos.draw(spy.target);
	assert.equal(spy.fillTexts.length, 0);
	assert.equal(pos.timeAxisViews().filter(v => v.visible()).length, 0);
	assert.equal(pos.priceAxisViews().filter(v => v.visible()).length, 3);

	// 4. alwaysShowStats: true renders pills even when idle; compactStats shrinks pill labels when shown
	spy.reset();
	pos.applyOptions({ alwaysShowStats: true });
	pos.draw(spy.target);
	assert.equal(spy.fillTexts.length, 3);
	assert.ok(spy.fillTexts.some(t => t.text.includes('目标:')));

	spy.reset();
	pos.applyOptions({ compactStats: true });
	pos.draw(spy.target);
	assert.equal(spy.fillTexts.length, 3);
	assert.ok(spy.fillTexts.some(t => t.text.startsWith('R:R ')));
});

test('patterns and fibonacci tools keep idle canvas clean and expand telemetry on hover', () => {
	const { chart, series } = createMockChartAndSeries();
	const spy = createMockTarget();

	// XABCD harmonic pattern: idle draws ratio text via strokeText/fillText without pill boxes; hover draws pill boxes
	const xabcd = attachDrawing(
		new PatternDrawing('xabcd', 'pat_1', [
			{ logical: 2 as Logical, price: 100 },
			{ logical: 6 as Logical, price: 220 },
			{ logical: 10 as Logical, price: 150 },
			{ logical: 14 as Logical, price: 200 },
			{ logical: 18 as Logical, price: 120 },
		]),
		chart,
		series
	);
	xabcd.draw(spy.target);
	const idleFillCalls = spy.fillCalls; // only polygon fills
	const idleStrokeCount = spy.strokeTexts.length;
	assert.equal(idleFillCalls, 2);
	assert.equal(idleStrokeCount, 9); // 5 vertices + 4 harmonic ratios

	spy.reset();
	xabcd.setHoverState(true);
	xabcd.draw(spy.target);
	assert.equal(spy.fillCalls, 6); // 2 polygons + 4 ratio pills
	assert.equal(spy.strokeTexts.length, 5); // only 5 vertices use strokeText

	// TrendFibTime: idle draws bottom outlined text without pills; hover draws bottom pills
	const tftime = attachDrawing(
		new TrendFibTimeDrawing('tft_1', [
			{ logical: 2 as Logical, price: 120 },
			{ logical: 14 as Logical, price: 220 },
			{ logical: 10 as Logical, price: 150 },
		]),
		chart,
		series
	);
	spy.reset();
	tftime.draw(spy.target);
	assert.equal(spy.fillCalls, 0);
	assert.ok(spy.fillTexts.length >= 2);
	assert.ok(spy.fillTexts.every(t => t.y > 400)); // placed near bottom, not top

	spy.reset();
	tftime.setHoverState(true);
	tftime.draw(spy.target);
	assert.ok(spy.fillCalls >= 2);
	assert.equal(spy.strokeTexts.length, 0);

	// FibRetracement & FibExtension inside-span labels are concise when idle and include prices on hover
	const nearLeftAnchors: AnchorPoint[] = [
		{ logical: 1 as Logical, price: 100 },
		{ logical: 10 as Logical, price: 300 },
	];
	const fibRet = attachDrawing(new FibRetracementDrawing('fr_1', nearLeftAnchors), chart, series);
	spy.reset();
	fibRet.draw(spy.target);
	assert.ok(spy.fillTexts.length >= 3);
	assert.ok(spy.fillTexts.every(t => !t.text.includes('(')), 'inside-span idle fib retracement labels omit prices');

	spy.reset();
	fibRet.setHoverState(true);
	fibRet.draw(spy.target);
	assert.ok(spy.fillTexts.some(t => t.text.includes('(')), 'hovered fib retracement expands price details');

	const fibExt = attachDrawing(
		new FibExtensionDrawing('fe_2', [
			{ logical: 1 as Logical, price: 100 },
			{ logical: 6 as Logical, price: 260 },
			{ logical: 10 as Logical, price: 140 },
		]),
		chart,
		series
	);
	spy.reset();
	fibExt.draw(spy.target);
	assert.ok(spy.fillTexts.length >= 3);
	assert.ok(spy.fillTexts.every(t => !t.text.includes('(')), 'inside-span idle fib extension labels omit prices');

	spy.reset();
	fibExt.setHoverState(true);
	fibExt.draw(spy.target);
	assert.ok(spy.fillTexts.some(t => t.text.includes('(')), 'hovered fib extension expands price details');
});
