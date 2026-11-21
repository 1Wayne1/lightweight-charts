import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExtendedScene, linearRegression, volumeProfile, type DrawingBar } from '../src/tools/extended-geometry.ts';
import { EXTENDED_TOOLS } from '../src/tools/catalog.ts';
import { BASE_DRAWING_OPTIONS } from '../src/types.ts';
const bars: DrawingBar[] = Array.from({ length: 20 }, (_, logical) => ({ logical, time: 1000 + logical * 60, open: 100 + logical, high: 103 + logical, low: 99 + logical, close: 102 + logical, volume: 100 }));
const project = (logical: number, price: number) => ({ x: logical * 20 + 20, y: 500 - price * 2 });
const anchors = [{ logical: 2, price: 104 }, { logical: 8, price: 114 }, { logical: 14, price: 106 }, { logical: 18, price: 120 }, { logical: 20, price: 100 }, { logical: 23, price: 118 }, { logical: 26, price: 108 }].map(p => ({ ...p, logical: p.logical as never }));
const context = { width: 800, height: 600, anchors, points: anchors.map(p => project(p.logical, p.price)), options: BASE_DRAWING_OPTIONS, bars, project };

test('least-squares channel uses actual closes and residual standard deviation', () => {
	const fit = linearRegression(bars)!; assert.equal(fit.slope, 1); assert.equal(fit.intercept, 102); assert.equal(fit.deviation, 0);
	assert.equal(linearRegression(bars.slice(0, 1)), null);
	const noisy = bars.map((b, i) => ({ ...b, close: b.close + (i % 2 ? 2 : -2) })); assert.ok(linearRegression(noisy)!.deviation > 1.9);
});
test('volume profile conserves volume and handles zero-range candles', () => {
	const profile = volumeProfile([...bars, { ...bars[0], high: 110, low: 110, volume: 50 }], 24)!;
	assert.ok(Math.abs(profile.volumes.reduce((s, v) => s + v, 0) - 2050) < 1e-8);
	assert.equal(volumeProfile([], 20), null);
});
test('three-anchor Fibonacci extension uses the third anchor as projection origin', () => {
	const scene = buildExtendedScene('fib-extension', { ...context, options: { ...BASE_DRAWING_OPTIONS, fibLevels: [{ value: 1.618, color: '#fff', visible: true }] } });
	const expected = project(14, 106 + (114 - 104) * 1.618).y;
	assert.equal(scene.paths[1].points[0].y, expected);
});
test('position risk/reward and VWAP are calculated from prices and volume', () => {
	const position = buildExtendedScene('long-position', context); assert.ok(position.labels.some(l => l.text.includes('R:R 0.2')));
	const vwap = buildExtendedScene('anchored-vwap', context);
	const selected = bars.slice(2); const expected = selected.reduce((s, b) => s + (b.high + b.low + b.close) / 3 * b.volume, 0) / 1800;
	assert.ok(Math.abs(vwap.paths[0].points.at(-1)!.y - project(19, expected).y) < 1e-8);
});
test('all tools produce finite geometry; incomplete/collinear drafts are safe', () => {
	for (const [type, , , count] of EXTENDED_TOOLS) {
		const points = anchors.slice(0, count || 7);
		const scene = buildExtendedScene(type, { ...context, anchors: points, points: points.map(p => project(p.logical, p.price)) });
		assert.ok(scene.paths.length + scene.labels.length > 0, type);
		assert.ok(scene.paths.every(path => path.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))), type);
		const draft = buildExtendedScene(type, { ...context, anchors: [anchors[0]], points: [context.points[0]] });
		assert.ok(draft.paths.every(path => path.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))), `${type} draft`);
	}
});
