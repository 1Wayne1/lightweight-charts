import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HoldSwitcher } from '../src/hold-switcher.ts';

test('short taps and horizontal swipes do not switch; immediate vertical slide activates without waiting', () => {
	const gesture = new HoldSwitcher();
	gesture.begin(1, 30, 700, 2, 8);
	assert.equal(gesture.end(1), null);
	// Sideways swipe cancels cleanly without opening the wheel.
	gesture.begin(2, 30, 700, 2, 8);
	assert.equal(gesture.move(2, 50, 700), null);
	assert.equal(gesture.activate(2), null);
	assert.equal(gesture.end(2), null);
	// Immediate vertical drag activates right away with zero hold delay and commits on release.
	gesture.begin(3, 30, 700, 2, 8);
	assert.equal(gesture.move(3, 30, 690), 2);
	assert.equal(gesture.move(3, 30, 650), 3);
	assert.equal(gesture.end(3), 3);
});

test('holding then sliding selects next/previous and commits only on release', () => {
	const gesture = new HoldSwitcher();
	gesture.begin(1, 30, 700, 1, 8);
	assert.equal(gesture.activate(1), 1);
	assert.equal(gesture.move(1, 30, 663), 2);
	assert.equal(gesture.move(1, 30, 737), 0);
	assert.equal(gesture.end(1), 0);
	assert.equal(gesture.end(1), null);
});

test('wheel wraps infinitely in both directions and reverses immediately', () => {
	const gesture = new HoldSwitcher();
	gesture.begin(1, 30, 700, 6, 8);
	gesture.activate(1);
	// Sliding up 2 steps from index 6 wraps around 7 -> 0.
	assert.equal(gesture.move(1, 30, 628), 0);
	// Reversing downward 1 step wraps back to 7 immediately.
	assert.equal(gesture.move(1, 30, 665), 7);
	// Sliding down 10 steps continues wrapping without ever hitting a floor.
	assert.equal(gesture.move(1, 30, 1025), 5);
	assert.equal(gesture.end(1), 5);
});

test('cancellation and other pointers never commit a pending selection', () => {
	const gesture = new HoldSwitcher();
	gesture.begin(1, 30, 700, 0, 8);
	assert.equal(gesture.begin(2, 50, 700, 0, 8), false);
	gesture.activate(1);
	assert.equal(gesture.move(2, 30, 600), null);
	assert.equal(gesture.end(2), null);
	gesture.cancel();
	assert.equal(gesture.end(1), null);
	assert.equal(gesture.activate(1), null);
	assert.equal(gesture.begin(3, 30, 700, 0, 0), false);
});

test('continuous position advances smoothly across wrap boundaries without jumps and matches committed item', () => {
	const gesture = new HoldSwitcher();
	gesture.begin(1, 30, 700, 4, 5);
	gesture.activate(1);
	assert.equal(gesture.position(), 4);
	// Sub-half step stays on index 4; crossing 0.5 step matches the visually centered next item (0).
	assert.equal(gesture.move(1, 30, 686), 4);
	assert.ok(gesture.position() > 4.3 && gesture.position() < 4.45);
	assert.equal(gesture.move(1, 30, 678), 0);
	assert.ok(gesture.position() > 4.55 && gesture.position() < 4.7);
	// Crossing from index 4 -> 0 keeps continuous position moving forward past 5.0.
	assert.equal(gesture.move(1, 30, 650), 0);
	assert.ok(gesture.position() > 5.2 && gesture.position() < 5.5);
	// Sliding 2 visual steps (1.65 steps) commits +2 (index 1), not +1.
	assert.equal(gesture.move(1, 30, 640), 1);
	// Pulling downward past index 0 continues smoothly into negative continuous positions.
	assert.equal(gesture.move(1, 30, 880), 4);
	assert.ok(gesture.position() < 0);
});
