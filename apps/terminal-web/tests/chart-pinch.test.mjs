import assert from 'node:assert/strict';
import test from 'node:test';
import { computePinchRange, createPinchSnapshot } from '../src/chart-pinch.ts';

test('pinch-out zooms in and keeps the candle under the midpoint anchored', () => {
	const snap = createPinchSnapshot(100, 200, 200, 200, { from: 100, to: 200 }, 0, 400);
	assert.ok(snap);
	// Midpoint is x=150 (ratio=0.375 -> logical 137.5). Spread fingers 2x wider at same midpoint.
	const zoomedIn = computePinchRange(snap, 50, 200, 250, 200);
	assert.ok(zoomedIn);
	assert.ok(Math.abs((zoomedIn.to - zoomedIn.from) - 50) < 1e-6);
	const anchored = zoomedIn.from + 0.375 * (zoomedIn.to - zoomedIn.from);
	assert.ok(Math.abs(anchored - 137.5) < 1e-6);
});

test('pinch-in zooms out and tracks midpoint translation smoothly', () => {
	const snap = createPinchSnapshot(100, 200, 300, 200, { from: 100, to: 200 }, 0, 400);
	assert.ok(snap);
	// Initial midpoint is x=200 (ratio=0.5 -> logical 150). Pinch to half width, shifted right to x=300 (ratio=0.75).
	const zoomedOut = computePinchRange(snap, 250, 200, 350, 200);
	assert.ok(zoomedOut);
	assert.ok(Math.abs((zoomedOut.to - zoomedOut.from) - 200) < 1e-6);
	const anchored = zoomedOut.from + 0.75 * (zoomedOut.to - zoomedOut.from);
	assert.ok(Math.abs(anchored - 150) < 1e-6);
});

test('pinch rejects degenerate finger spacing and clamps extreme zoom scales', () => {
	assert.equal(createPinchSnapshot(100, 100, 105, 105, { from: 0, to: 100 }, 0, 400), null);
	const snap = createPinchSnapshot(100, 200, 200, 200, { from: 100, to: 200 }, 0, 400);
	assert.ok(snap);
	assert.equal(computePinchRange(snap, 150, 200, 154, 200), null);
	const maxZoomIn = computePinchRange(snap, -5000, 200, 5000, 200);
	assert.ok(maxZoomIn && maxZoomIn.to - maxZoomIn.from >= 6);
	const maxZoomOut = computePinchRange(snap, 140, 200, 155, 200);
	assert.ok(maxZoomOut && maxZoomOut.to - maxZoomOut.from <= 800);
});
