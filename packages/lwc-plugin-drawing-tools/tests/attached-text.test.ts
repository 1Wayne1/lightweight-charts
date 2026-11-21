import assert from 'node:assert/strict';
import test from 'node:test';
import { attachedTextKind, attachedTextPlacements, paintAttachedText, textTargetContains } from '../src/attached-text.ts';
import { BASE_DRAWING_OPTIONS, type AnchorPoint, type DrawingToolType } from '../src/types.ts';
const anchors = [{ logical: 1, price: 400 }, { logical: 3, price: 300 }, { logical: 5, price: 350 }, { logical: 7, price: 200 }] as AnchorPoint[];
const context = { points: [{ x: 100, y: 400 }, { x: 400, y: 300 }, { x: 100, y: 350 }, { x: 400, y: 200 }], anchors, options: { ...BASE_DRAWING_OPTIONS, attachedText: '支撑\n等待确认' }, width: 800, height: 600, selected: false, priceToY: (price: number) => price };

test('custom notes are opt-in by tool; old unused annotation text stays invisible', () => {
	for (const type of ['info-line', 'trend-angle', 'rotated-rectangle', 'triangle', 'cross-line', 'flag'] as DrawingToolType[]) assert.equal(attachedTextKind(type), null);
	assert.deepEqual(attachedTextPlacements('trend-line', { ...context, options: { ...BASE_DRAWING_OPTIONS, text: 'Text' } }), []);
	const selected = attachedTextPlacements('trend-line', { ...context, options: BASE_DRAWING_OPTIONS, selected: true });
	assert.equal(selected[0].placeholder, true);
	assert.deepEqual(attachedTextPlacements('trend-line', { ...context, options: { ...context.options, showText: false }, selected: true }), []);
	assert.deepEqual(attachedTextPlacements('trend-line', { ...context, options: { ...BASE_DRAWING_OPTIONS, locked: true }, selected: true }), []);
});
test('notes follow line slope, shape center, channel midline and viewport resize', () => {
	const line = attachedTextPlacements('trend-line', context)[0]; assert.equal(line.x, 250); assert.equal(line.y, 350); assert.equal(line.angle, Math.atan2(-100, 300));
	assert.deepEqual(attachedTextPlacements('circle', context)[0], { ...line, x: 100, y: 400, angle: 0, position: 'middle' });
	const channel = attachedTextPlacements('parallel-channel', { ...context, options: { ...context.options, textPosition: 'middle' } })[0]; assert.equal(channel.y, 325); assert.equal(channel.angle, line.angle);
	const horizontal = attachedTextPlacements('horizontal-line', { ...context, width: 400 })[0]; assert.equal(horizontal.x, 200); assert.equal(horizontal.y, 400);
	const vertical = attachedTextPlacements('vertical-line', context)[0]; assert.equal(vertical.y, 300); assert.equal(vertical.angle, -Math.PI / 2);
	const upright = attachedTextPlacements('vertical-line', { ...context, options: { ...context.options, textOrientation: 'horizontal' } })[0]; assert.equal(upright.angle, 0);
	const top = attachedTextPlacements('vertical-line', { ...context, options: { ...context.options, textOrientation: 'horizontal', textAlign: 'left' } })[0]; assert.ok(top.y > context.options.fontSize * 2);
});
test('Fibonacci notes use canonical level price and original index, independently of statistics', () => {
	const options = { ...context.options, showLabels: false, fibLevels: [{ value: .618, visible: true, color: '#ff0000', text: '回踩' }, { value: 1, visible: false, color: '#ffffff', text: '隐藏' }, { value: 1.618, visible: true, color: '#00ff00', text: '目标' }] };
	const retracement = attachedTextPlacements('fib-retracement', { ...context, options });
	assert.deepEqual(retracement.map(p => p.levelIndex), [0, 2]); assert.equal(retracement[0].y, 361.8); assert.equal(retracement[0].text, '回踩'); assert.equal(retracement[0].color, '#ff0000');
	const extension = attachedTextPlacements('fib-extension', { ...context, options }); assert.equal(extension[0].y, 288.2); assert.equal(extension[1].text, '目标');
});
test('rotated multiline text rendering and hit testing share the same bounds', () => {
	const painted: string[] = [];
	const ctx = { save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, setLineDash() {}, translate() {}, rotate() {}, measureText: (s: string) => ({ width: s.length * 10 }), fillText: (s: string) => painted.push(s) } as unknown as CanvasRenderingContext2D;
	const targets = paintAttachedText(ctx, attachedTextPlacements('trend-line', context), context.options, 800, 600);
	assert.deepEqual(painted, ['支撑', '等待确认']);
	const t = targets[0]; const point = { x: t.x + t.width / 2 * Math.cos(t.angle) - t.height / 2 * Math.sin(t.angle), y: t.y + t.width / 2 * Math.sin(t.angle) + t.height / 2 * Math.cos(t.angle) };
	assert.ok(textTargetContains(t, point)); assert.equal(textTargetContains(t, { x: 799, y: 599 }), false);
});
