import assert from 'node:assert/strict';
import test from 'node:test';
import {
	clipLineToViewport,
	colorWithAlpha,
	computeParallelChannel,
	distancePointToInfiniteLine,
	distancePointToRay,
	distancePointToSegment,
	distanceToRectBorder,
	pointInPolygon,
	pointInRect,
	snapAngle45,
} from '../src/geometry.ts';
import { DrawingHistory } from '../src/history.ts';
import { decodeExternalId, encodeExternalId, type SerializedDrawing } from '../src/types.ts';

test('externalId round-trips body and anchor hit parts', () => {
	const bodyId = encodeExternalId({ drawingId: 'drw_1', part: 'body' });
	assert.deepEqual(decodeExternalId(bodyId), { drawingId: 'drw_1', part: 'body' });

	const anchorId = encodeExternalId({
		drawingId: 'drw_2',
		part: 'anchor',
		anchorIndex: 2,
	});
	assert.deepEqual(decodeExternalId(anchorId), {
		drawingId: 'drw_2',
		part: 'anchor',
		anchorIndex: 2,
	});

	assert.equal(decodeExternalId('other:id'), null);
	assert.equal(decodeExternalId(undefined), null);
});

test('segment, ray, and infinite line distance calculations', () => {
	const a = { x: 0, y: 0 };
	const b = { x: 100, y: 0 };

	assert.equal(distancePointToSegment({ x: 50, y: 10 }, a, b), 10);
	assert.equal(distancePointToSegment({ x: 130, y: 0 }, a, b), 30);

	// Ray extends beyond b, but not before a
	assert.equal(distancePointToRay({ x: 130, y: 5 }, a, b), 5);
	assert.equal(distancePointToRay({ x: -20, y: 0 }, a, b), 20);

	// Infinite line extends in both directions
	assert.equal(distancePointToInfiniteLine({ x: -20, y: 7 }, a, b), 7);
});

test('clipLineToViewport clips ray and infinite line to viewport bounds', () => {
	const clippedRay = clipLineToViewport(
		{ x: 100, y: 100 },
		{ x: 200, y: 100 },
		500,
		400,
		false,
		true
	);
	assert.ok(clippedRay);
	assert.equal(clippedRay[0].x, 100);
	assert.equal(clippedRay[0].y, 100);
	assert.ok(clippedRay[1].x >= 500);
	assert.equal(clippedRay[1].y, 100);

	const clippedInf = clipLineToViewport(
		{ x: 100, y: 100 },
		{ x: 200, y: 100 },
		500,
		400,
		true,
		true
	);
	assert.ok(clippedInf);
	assert.ok(clippedInf[0].x <= 0);
	assert.ok(clippedInf[1].x >= 500);
});

test('rectangle & parallel channel geometry', () => {
	const a = { x: 10, y: 20 };
	const b = { x: 110, y: 80 };
	assert.equal(pointInRect({ x: 50, y: 50 }, a, b), true);
	assert.equal(pointInRect({ x: 5, y: 50 }, a, b), false);
	assert.equal(distanceToRectBorder({ x: 10, y: 50 }, a, b), 0);
	assert.equal(distanceToRectBorder({ x: 14, y: 50 }, a, b), 4);

	const channel = computeParallelChannel(
		{ x: 0, y: 100 },
		{ x: 100, y: 50 },
		{ x: 50, y: 115 }
	);
	// At x=50, baseline y is 75, so offsetY = 115 - 75 = 40
	assert.equal(channel.offsetY, 40);
	assert.deepEqual(channel.parallelStart, { x: 0, y: 140 });
	assert.deepEqual(channel.parallelEnd, { x: 100, y: 90 });
	assert.deepEqual(channel.midStart, { x: 0, y: 120 });
	assert.deepEqual(channel.midEnd, { x: 100, y: 70 });

	const poly = [
		channel.baseStart,
		channel.baseEnd,
		channel.parallelEnd,
		channel.parallelStart,
	];
	assert.equal(pointInPolygon({ x: 50, y: 95 }, poly), true);
	assert.equal(pointInPolygon({ x: 50, y: 10 }, poly), false);
});

test('snapAngle45 and colorWithAlpha', () => {
	const snapped = snapAngle45({ x: 0, y: 0 }, { x: 100, y: 8 });
	assert.ok(Math.abs(snapped.y) < 1e-6);
	assert.ok(snapped.x > 99);

	assert.equal(colorWithAlpha('#2962FF', 0.2), 'rgba(41, 98, 255, 0.2)');
	assert.equal(colorWithAlpha('#fff', 0.5), 'rgba(255, 255, 255, 0.5)');
	assert.equal(colorWithAlpha('rgb(10, 20, 30)', 0.4), 'rgba(10, 20, 30, 0.4)');
});

test('DrawingHistory supports undo, redo, and deep-clone isolation', () => {
	const history = new DrawingHistory(10);
	const s0: SerializedDrawing[] = [];
	const s1: SerializedDrawing[] = [
		{
			id: 'd1',
			type: 'horizontal-line',
			points: [{ logical: 10 as never, price: 100 }],
			options: { color: '#2962FF' },
		},
	];
	const s2: SerializedDrawing[] = [
		...s1,
		{
			id: 'd2',
			type: 'vertical-line',
			points: [{ logical: 20 as never, price: 105 }],
			options: { color: '#089981' },
		},
	];

	history.push(s0);
	history.push(s1);
	assert.equal(history.canUndo(), true);
	assert.equal(history.canRedo(), false);

	const afterUndo1 = history.undo(s2);
	assert.ok(afterUndo1);
	assert.equal(afterUndo1.length, 1);
	assert.equal(afterUndo1[0].id, 'd1');

	// Mutating returned array must not corrupt redo/undo stacks
	afterUndo1[0].points[0].price = 9999;

	const afterRedo = history.redo(afterUndo1);
	assert.ok(afterRedo);
	assert.equal(afterRedo.length, 2);
	assert.equal(afterRedo[0].points[0].price, 100);
});
