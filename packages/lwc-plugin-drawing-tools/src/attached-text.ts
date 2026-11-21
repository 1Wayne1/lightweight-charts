import { clipLineToViewport, computeParallelChannel } from './geometry';
import type { AnchorPoint, DrawingStyleOptions, DrawingToolType, ScreenPoint } from './types';

/** Custom notes are separate from primary annotations and calculated statistics. */
export function attachedTextKind(type: DrawingToolType): 'line' | 'vertical' | 'shape' | 'center' | 'channel' | 'range' | 'mark' | 'levels' | null {
	switch (type) {
		case 'trend-line': case 'ray': case 'extended-line': case 'horizontal-line': case 'horizontal-ray': case 'arrow': case 'double-arrow': return 'line';
		case 'vertical-line': return 'vertical';
		case 'rectangle': return 'shape';
		case 'circle': case 'ellipse': return 'center';
		case 'parallel-channel': case 'flat-channel': case 'disjoint-channel': return 'channel';
		case 'price-range': case 'date-range': case 'price-date-range': return 'range';
		case 'arrow-up': case 'arrow-down': return 'mark';
		case 'fib-retracement': case 'fib-extension': return 'levels';
		default: return null;
	}
}

export interface AttachedTextPlacement extends ScreenPoint {
	text: string;
	color: string;
	angle: number;
	align: 'left' | 'center' | 'right';
	position: 'top' | 'middle' | 'bottom';
	placeholder: boolean;
	levelIndex?: number;
}
export interface AttachedTextTarget extends AttachedTextPlacement { width: number; height: number; }
interface TextContext {
	points: readonly (ScreenPoint | null)[];
	anchors: readonly AnchorPoint[];
	options: DrawingStyleOptions;
	width: number;
	height: number;
	selected: boolean;
	priceToY: (price: number) => number | null;
}
const mix = (a: ScreenPoint, b: ScreenPoint, t: number): ScreenPoint => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Pane-local geometry, recalculated after pan, scale, timeframe or history changes. */
export function attachedTextPlacements(type: DrawingToolType, context: TextContext): AttachedTextPlacement[] {
	const kind = attachedTextKind(type); const { points, anchors, options: o, width, height, selected, priceToY } = context;
	const [a, b, c, d] = points;
	if (!kind || !a || !o.showText) return [];
	const result: AttachedTextPlacement[] = [];
	const add = (point: ScreenPoint, angle = 0, text = o.attachedText, color = o.textColor, levelIndex?: number, align = o.textAlign, position = o.textPosition) => {
		const placeholder = !text.trim();
		if (placeholder && (!selected || o.locked)) return;
		result.push({ ...point, angle, text: placeholder ? '添加文字' : text, color, placeholder, levelIndex, align, position });
	};
	const line = (start: ScreenPoint, end: ScreenPoint, left = false, right = false) => {
		const clip = clipLineToViewport(start, end, width, height, left, right); if (!clip) return;
		let [p, q] = clip; if (p.x > q.x) [p, q] = [q, p];
		let angle = Math.atan2(q.y - p.y, q.x - p.x); if (angle > Math.PI / 2) angle -= Math.PI; if (angle < -Math.PI / 2) angle += Math.PI;
		const point = mix(p, q, o.textAlign === 'left' ? 0 : o.textAlign === 'right' ? 1 : .5);
		add(point, angle);
	};
	if (kind === 'levels') {
		if (!b || !anchors[1] || (type === 'fib-extension' && (!c || !anchors[2]))) return [];
		const left = Math.max(0, o.extendLeft ? 0 : Math.min(a.x, type === 'fib-extension' ? c!.x : b.x));
		const right = Math.min(width, o.extendRight ? width : type === 'fib-extension' ? Math.max(b.x, c!.x) + 60 : Math.max(a.x, b.x));
		if (right < left) return [];
		o.fibLevels.forEach((level, levelIndex) => {
			if (!level.visible) return;
			const price = type === 'fib-extension' ? anchors[2].price + (anchors[1].price - anchors[0].price) * level.value : anchors[1].price + (anchors[0].price - anchors[1].price) * level.value;
			const y = priceToY(price); if (y === null || y < 0 || y > height) return;
			add({ x: o.textAlign === 'left' ? left + 6 : o.textAlign === 'right' ? right - 6 : (left + right) / 2, y }, 0, level.text ?? '', level.color, levelIndex);
		});
	} else if (kind === 'vertical') {
		const textHeight = (o.attachedText || '添加文字').split('\n').length * o.fontSize * 1.4 + 4;
		const topInset = o.textOrientation === 'horizontal' ? (o.textPosition === 'top' ? textHeight + 5 : o.textPosition === 'middle' ? textHeight / 2 : 0) : 0;
		const bottomInset = o.textOrientation === 'horizontal' ? (o.textPosition === 'bottom' ? textHeight + 5 : o.textPosition === 'middle' ? textHeight / 2 : 0) : 0;
		const y = o.textAlign === 'left' ? 12 + topInset : o.textAlign === 'right' ? height - 12 - bottomInset : height / 2;
		add({ x: a.x, y }, o.textOrientation === 'vertical' ? -Math.PI / 2 : 0, o.attachedText, o.textColor, undefined, o.textOrientation === 'vertical' ? (o.textAlign === 'left' ? 'right' : o.textAlign === 'right' ? 'left' : 'center') : 'center');
	} else if (kind === 'mark') {
		add({ x: a.x + 32, y: a.y }, 0, o.attachedText, o.textColor, undefined, 'left', 'middle');
	} else if (type === 'horizontal-line' || type === 'horizontal-ray') {
		line({ x: type === 'horizontal-line' || o.extendLeft ? 0 : a.x, y: a.y }, { x: width, y: a.y });
	} else if (kind === 'center') {
		if (b) add(type === 'circle' ? a : mix(a, b, .5), 0, o.attachedText, o.textColor, undefined, 'center', 'middle');
	} else if (b && (kind === 'shape' || kind === 'range')) {
		const left = Math.min(a.x, b.x), right = Math.max(a.x, b.x), top = Math.min(a.y, b.y), bottom = Math.max(a.y, b.y);
		add({ x: o.textAlign === 'left' ? left + 8 : o.textAlign === 'right' ? right - 8 : (left + right) / 2, y: o.textPosition === 'top' ? top - 4 : o.textPosition === 'bottom' ? bottom + 4 : (top + bottom) / 2 });
	} else if (b && c && kind === 'channel') {
		let p = a, q = b, r = c, s = d ?? c;
		if (type === 'parallel-channel') { const g = computeParallelChannel(a, b, c); p = g.baseStart; q = g.baseEnd; r = g.parallelStart; s = g.parallelEnd; }
		if (type === 'flat-channel') { q = { x: b.x, y: a.y }; r = { x: a.x, y: b.y }; s = c; }
		if ((p.y + q.y) > (r.y + s.y)) [p, q, r, s] = [r, s, p, q];
		const t = o.textPosition === 'top' ? 0 : o.textPosition === 'bottom' ? 1 : .5;
		line(mix(p, r, t), mix(q, s, t), o.extendLeft, o.extendRight);
	} else if (b && kind === 'line') {
		line(a, b, type === 'extended-line' || o.extendLeft, type === 'extended-line' || type === 'ray' || o.extendRight);
	}
	return result;
}

export function drawingTextFont(options: DrawingStyleOptions): string {
	return `${options.textItalic ? 'italic ' : ''}${options.textBold ? '700' : '400'} ${options.fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
}

export function paintAttachedText(ctx: CanvasRenderingContext2D, placements: AttachedTextPlacement[], o: DrawingStyleOptions, width: number, height: number): AttachedTextTarget[] {
	const targets: AttachedTextTarget[] = [];
	ctx.save(); ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.clip(); ctx.font = drawingTextFont(o); ctx.textBaseline = 'top'; ctx.setLineDash([]);
	for (const p of placements) {
		const lines = p.text.split('\n'), lineHeight = o.fontSize * 1.4;
		const w = Math.max(1, ...lines.map(line => ctx.measureText(line).width)) + 8, h = lines.length * lineHeight + 4;
		const dx = p.align === 'left' ? 0 : p.align === 'right' ? -w : -w / 2;
		const dy = p.position === 'top' ? -h - 5 : p.position === 'bottom' ? 5 : -h / 2;
		const x = p.x + dx * Math.cos(p.angle) - dy * Math.sin(p.angle), y = p.y + dx * Math.sin(p.angle) + dy * Math.cos(p.angle);
		const target = { ...p, x, y, width: w, height: h }; targets.push(target);
	}
	// Keep empty edit hints from covering real notes or each other in dense levels.
	const bounds = (t: AttachedTextTarget) => {
		const corners = [{ x: 0, y: 0 }, { x: t.width, y: 0 }, { x: 0, y: t.height }, { x: t.width, y: t.height }].map(p => ({ x: t.x + p.x * Math.cos(t.angle) - p.y * Math.sin(t.angle), y: t.y + p.x * Math.sin(t.angle) + p.y * Math.cos(t.angle) }));
		return { left: Math.min(...corners.map(p => p.x)), right: Math.max(...corners.map(p => p.x)), top: Math.min(...corners.map(p => p.y)), bottom: Math.max(...corners.map(p => p.y)) };
	};
	const visible = targets.filter(t => !t.placeholder);
	for (const t of targets.filter(t => t.placeholder)) {
		const a = bounds(t);
		if (!visible.some(other => { const b = bounds(other); return a.left < b.right + 4 && a.right > b.left - 4 && a.top < b.bottom + 4 && a.bottom > b.top - 4; })) visible.push(t);
	}
	for (const t of visible) {
		ctx.save(); ctx.translate(t.x, t.y); ctx.rotate(t.angle); ctx.globalAlpha = t.placeholder ? .7 : o.textOpacity; ctx.fillStyle = t.placeholder ? '#9598a1' : t.color;
		ctx.textAlign = t.align;
		t.text.split('\n').forEach((line, i) => ctx.fillText(line, t.align === 'left' ? 4 : t.align === 'right' ? t.width - 4 : t.width / 2, i * o.fontSize * 1.4 + 2));
		ctx.restore();
	}
	ctx.restore(); return visible;
}

export function textTargetContains(target: AttachedTextTarget, point: ScreenPoint, padding = 3): boolean {
	const dx = point.x - target.x, dy = point.y - target.y;
	const x = dx * Math.cos(target.angle) + dy * Math.sin(target.angle), y = -dx * Math.sin(target.angle) + dy * Math.cos(target.angle);
	return x >= -padding && x <= target.width + padding && y >= -padding && y <= target.height + padding;
}
