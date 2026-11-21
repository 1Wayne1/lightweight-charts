import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HoldSwitcher } from '../src/hold-switcher.ts';

test('short taps and pre-hold scrolling do not switch instruments', () => {
	const gesture = new HoldSwitcher();
	gesture.begin(1, 30, 700, 2, 8);
	assert.equal(gesture.end(1), null);
	gesture.begin(2, 30, 700, 2, 8);
	gesture.move(2, 30, 680);
	assert.equal(gesture.activate(2), null);
	assert.equal(gesture.end(2), null);
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

test('boundaries clamp and direction reverses immediately', () => {
	const gesture = new HoldSwitcher();
	gesture.begin(1, 30, 700, 6, 8);
	gesture.activate(1);
	assert.equal(gesture.move(1, 30, 100), 7);
	assert.equal(gesture.move(1, 30, 137), 6);
	assert.equal(gesture.end(1), 6);
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
