import { clipLineToViewport } from '../geometry';
import type { AnchorPoint, DrawingStyleOptions, ScreenPoint } from '../types';
import type { ExtendedToolType } from './catalog';

export interface DrawingBar { logical: number; time: number; open: number; high: number; low: number; close: number; volume: number; }
export interface ScenePath { points: ScreenPoint[]; closed?: boolean; fill?: string; color?: string; width?: number; opacity?: number; }
export interface SceneLabel { point: ScreenPoint; text: string; color?: string; background?: boolean; fontSize?: number; }
export interface DrawingScene { paths: ScenePath[]; labels: SceneLabel[]; }
export interface GeometryContext {
	width: number; height: number;
	anchors: readonly AnchorPoint[];
	points: readonly ScreenPoint[];
	options: DrawingStyleOptions;
	bars: readonly DrawingBar[];
	project(logical: number, price: number): ScreenPoint | null;
}
const mix = (a: ScreenPoint, b: ScreenPoint, t: number): ScreenPoint => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const plus = (a: ScreenPoint, b: ScreenPoint): ScreenPoint => ({ x: a.x + b.x, y: a.y + b.y });
const minus = (a: ScreenPoint, b: ScreenPoint): ScreenPoint => ({ x: a.x - b.x, y: a.y - b.y });
const length = (a: ScreenPoint, b: ScreenPoint): number => Math.hypot(a.x - b.x, a.y - b.y);
const compact = (n: number): string => Number.isFinite(n) ? new Intl.NumberFormat('en', { maximumFractionDigits: 4, notation: Math.abs(n) > 1e6 ? 'compact' : 'standard' }).format(n) : '—';

/** Least squares on the actual bar indices; deviation is the population residual deviation. */
export function linearRegression(bars: readonly DrawingBar[]): { slope: number; intercept: number; deviation: number } | null {
	if (bars.length < 2) return null;
	const x = bars.reduce((s, b) => s + b.logical, 0) / bars.length;
	const y = bars.reduce((s, b) => s + b.close, 0) / bars.length;
	let xy = 0; let xx = 0;
	for (const b of bars) { xy += (b.logical - x) * (b.close - y); xx += (b.logical - x) ** 2; }
	if (!xx) return null;
	const slope = xy / xx; const intercept = y - slope * x;
	const deviation = Math.sqrt(bars.reduce((s, b) => s + (b.close - slope * b.logical - intercept) ** 2, 0) / bars.length);
	return { slope, intercept, deviation };
}

/** Candle-volume estimate, distributed uniformly through each candle's high/low range. */
export function volumeProfile(bars: readonly DrawingBar[], rows: number): { low: number; step: number; volumes: number[] } | null {
	if (!bars.length) return null;
	const low = Math.min(...bars.map(b => b.low)); const high = Math.max(...bars.map(b => b.high));
	const step = (high - low) / rows;
	if (step <= 0) return null;
	const volumes = Array<number>(rows).fill(0);
	for (const b of bars) {
		const start = Math.max(0, Math.min(rows - 1, Math.floor((b.low - low) / step)));
		const end = Math.max(start, Math.min(rows - 1, Math.floor((b.high - low) / step)));
		if (b.high === b.low) { volumes[start] += b.volume; continue; }
		for (let i = start; i <= end; i++) volumes[i] += b.volume * Math.max(0, Math.min(b.high, low + (i + 1) * step) - Math.max(b.low, low + i * step)) / (b.high - b.low);
	}
	return { low, step, volumes };
}

/** Pure scene generation shared by rendering, hit testing, and numerical tests. */
export function buildExtendedScene(type: ExtendedToolType, context: GeometryContext): DrawingScene {
	const { width: w, height: h, points: p, anchors: anchors, options: o, bars, project } = context;
	const scene: DrawingScene = { paths: [], labels: [] };
	if (!p.length) return scene;
	const a = p[0]; const b = p[1] ?? a; const c = p[2] ?? b; const d = p[3] ?? c;
	const aa = anchors[0]; const ab = anchors[1] ?? aa; const ac = anchors[2] ?? ab;
	const path = (points: ScreenPoint[], closed = false, color?: string, fill?: string, width?: number, opacity?: number): void => {
		if (points.every(q => Number.isFinite(q.x) && Number.isFinite(q.y))) scene.paths.push({ points, closed, color, fill, width, opacity });
	};
	const line = (start: ScreenPoint, end: ScreenPoint, left = false, right = false, color?: string): void => {
		const clipped = clipLineToViewport(start, end, w, h, left, right);
		if (clipped) path(clipped, false, color);
	};
	const label = (point: ScreenPoint, text: string, color?: string): void => { if (o.showLabels && Number.isFinite(point.x) && Number.isFinite(point.y)) scene.labels.push({ point, text, color, background: true }); };
	const box = (start: ScreenPoint, end: ScreenPoint, color = o.fillColor): void => path([start, { x: end.x, y: start.y }, end, { x: start.x, y: end.y }], true, color, color);
	const arrow = (start: ScreenPoint, end: ScreenPoint): void => {
		line(start, end);
		const theta = Math.atan2(end.y - start.y, end.x - start.x);
		path([ { x: end.x - 11 * Math.cos(theta - 0.45), y: end.y - 11 * Math.sin(theta - 0.45) }, end,
			{ x: end.x - 11 * Math.cos(theta + 0.45), y: end.y - 11 * Math.sin(theta + 0.45) }]);
	};
	const ellipse = (center: ScreenPoint, rx: number, ry: number, start = 0, end = Math.PI * 2, fill = false): void => {
		const points = Array.from({ length: 97 }, (_, i) => { const t = start + (end - start) * i / 96; return { x: center.x + rx * Math.cos(t), y: center.y + ry * Math.sin(t) }; });
		path(points, fill, undefined, fill ? o.fillColor : undefined);
	};
	const levelValues = o.fibLevels.filter(l => l.visible);
	const rangeBars = bars.filter(bar => bar.logical >= Math.min(aa.logical, ab.logical) && bar.logical <= Math.max(aa.logical, ab.logical));
	const pricePoint = (logical: number, price: number): ScreenPoint => project(logical, price) ?? a;
	const priceChange = ab.price - aa.price;
	const measurement = `${compact(priceChange)} (${aa.price ? compact(priceChange / aa.price * 100) : '—'}%)`;
	switch (type) {
		case 'extended-line': line(a, b, o.extendLeft, o.extendRight); break;
		case 'horizontal-ray': line(a, { x: a.x + 1, y: a.y }, o.extendLeft, true); label(a, compact(aa.price)); break;
		case 'cross-line': line({ x: 0, y: a.y }, { x: w, y: a.y }); line({ x: a.x, y: 0 }, { x: a.x, y: h }); break;
		case 'arrow': arrow(a, b); break;
		case 'double-arrow': arrow(a, b); arrow(b, a); break;
		case 'trend-angle': {
			line(a, b, o.extendLeft, o.extendRight); line(a, { x: a.x + 50, y: a.y });
			const angle = Math.atan2(a.y - b.y, b.x - a.x);
			ellipse(a, 35, 35, -angle, 0); label(mix(a, b, 0.5), `${compact(angle * 180 / Math.PI)}°`); break;
		}
		case 'info-line': case 'forecast':
			if (type === 'forecast') arrow(a, b); else line(a, b, o.extendLeft, o.extendRight);
			label(mix(a, b, 0.5), `${measurement} · ${compact(Math.abs(ab.logical - aa.logical))} bars`); break;
		case 'flat-channel':
			path([a, { x: b.x, y: a.y }, c, { x: a.x, y: b.y }], true, undefined, o.fillColor);
			line(a, { x: b.x, y: a.y }, o.extendLeft, o.extendRight);
			line({ x: a.x, y: b.y }, c, o.extendLeft, o.extendRight); break;
		case 'pitchfan':
			for (const ratio of [0, 0.25, 0.5, 0.75, 1]) { const end = mix(b, c, ratio); line(a, end, o.extendLeft, true); label(end, String(ratio)); } break;
		case 'disjoint-channel':
			path([a, b, d, c], true, undefined, o.fillColor); line(a, b, o.extendLeft, o.extendRight); line(c, d, o.extendLeft, o.extendRight); break;
		case 'regression-channel': {
			const regression = linearRegression(rangeBars);
			if (!regression) { label(a, '所选范围至少需要 2 根 K 线'); break; }
			const { slope, intercept, deviation } = regression;
			const left = Math.min(aa.logical, ab.logical); const right = Math.max(aa.logical, ab.logical);
			const bounds: ScreenPoint[][] = [];
			for (const k of [-1, 0, 1]) {
				const points = [pricePoint(left, slope * left + intercept + k * deviation * o.deviations), pricePoint(right, slope * right + intercept + k * deviation * o.deviations)];
				bounds.push(points); line(points[0], points[1], o.extendLeft, o.extendRight);
			}
			path([...bounds[0], ...bounds[2].slice().reverse()], true, undefined, o.fillColor); label(a, `回归 · ±${o.deviations}σ`); break;
		}
		case 'pitchfork': case 'schiff-pitchfork': case 'modified-schiff': case 'inside-pitchfork': {
			const origin = type === 'schiff-pitchfork' ? { x: a.x, y: (a.y + b.y) / 2 } : type === 'modified-schiff' ? mix(a, b, 0.5) : a;
			const center = type === 'inside-pitchfork' ? mix(a, b, 0.5) : mix(b, c, 0.5);
			const delta = type === 'inside-pitchfork' ? minus(center, c) : minus(center, origin);
			line(b, c); line(origin, plus(origin, delta), o.extendLeft, o.extendRight);
			for (const start of [b, c]) line(start, plus(start, delta), o.extendLeft, o.extendRight);
			break;
		}
		case 'fib-extension':
			path([a, b, c]);
			for (const level of levelValues) {
				const y = pricePoint(ac.logical, ac.price + (ab.price - aa.price) * level.value).y;
				line({ x: Math.min(a.x, c.x), y }, { x: Math.max(b.x, c.x) + 60, y }, o.extendLeft, o.extendRight, level.color);
				if (o.showLabels) scene.labels.push({ point: { x: (o.extendLeft ? 0 : Math.max(0, Math.min(a.x, c.x))) - 4, y: y + (o.textPosition === 'bottom' ? -1 : 1) * ((o.fontSize + 12) / 2 + 3) }, text: `${level.value}  ${compact(ac.price + (ab.price - aa.price) * level.value)}`, color: level.color });
			} break;
		case 'fib-channel': {
			const baselineAtC = a.y + (b.y - a.y) * (c.x - a.x) / (b.x - a.x || 1);
			for (const level of levelValues) {
				const offset = (c.y - baselineAtC) * level.value;
				const start = { x: a.x, y: a.y + offset }; const end = { x: b.x, y: b.y + offset };
				line(start, end, o.extendLeft, o.extendRight, level.color); label(end, String(level.value), level.color);
			} break;
		}
		case 'fib-time-zone': case 'trend-fib-time': {
			const origin = type === 'trend-fib-time' ? c : a;
			const values = type === 'trend-fib-time' ? levelValues.map(l => l.value) : [0, 1, 2, 3, 5, 8, 13, 21, 34];
			for (const value of values) { const x = origin.x + (b.x - a.x) * value; line({ x, y: 0 }, { x, y: h }); label({ x, y: 20 }, String(value)); } break;
		}
		case 'fib-fan':
			for (const level of levelValues) {
				const end = pricePoint(ab.logical, aa.price + (ab.price - aa.price) * level.value);
				line(a, end, o.extendLeft, o.extendRight, level.color); label(end, String(level.value), level.color);
			} break;
		case 'fib-arcs': case 'fib-circles':
			line(a, b);
			for (const level of levelValues) { const radius = length(a, b) * Math.abs(level.value); ellipse(a, radius, radius, type === 'fib-arcs' ? Math.PI : 0); label({ x: a.x + radius, y: a.y }, String(level.value), level.color); } break;
		case 'fib-spiral': {
			const theta = Math.atan2(b.y - a.y, b.x - a.x); const radius = length(a, b);
			path(Array.from({ length: 241 }, (_, i) => { const t = i / 240 * 6 * Math.PI; const r = radius * Math.pow(1.61803398875, (t - 6 * Math.PI) / (Math.PI / 2)); return { x: a.x + r * Math.cos(t + theta), y: a.y + r * Math.sin(t + theta) }; })); break;
		}
		case 'fib-wedge': {
			const start = Math.atan2(b.y - a.y, b.x - a.x); let end = Math.atan2(c.y - a.y, c.x - a.x); if (end < start) end += Math.PI * 2;
			line(a, b); line(a, c);
			for (const level of levelValues) ellipse(a, length(a, b) * Math.abs(level.value), length(a, b) * Math.abs(level.value), start, end); break;
		}
		case 'gann-fan':
			for (const ratio of [1 / 8, 1 / 4, 1 / 3, 1 / 2, 1, 2, 3, 4, 8]) {
				const end = { x: b.x, y: a.y + (b.y - a.y) * ratio }; line(a, end, false, true); label(end, ratio >= 1 ? `1:${ratio}` : `${Math.round(1 / ratio)}:1`);
			} break;
		case 'gann-box': case 'gann-square': case 'gann-square-fixed':
			box(a, b);
			for (const ratio of [0.25, 0.5, 0.75]) { const q = mix(a, b, ratio); line({ x: q.x, y: a.y }, { x: q.x, y: b.y }); line({ x: a.x, y: q.y }, { x: b.x, y: q.y }); }
			if (type === 'gann-square' || type === 'gann-square-fixed') for (const end of [b, { x: b.x, y: a.y }, { x: a.x, y: b.y }, mix(a, { x: b.x, y: a.y }, 0.5), mix(b, { x: a.x, y: b.y }, 0.5)]) { line(a, end); line(b, end); }
			break;
		case 'brush': case 'highlighter': path([...p], false, undefined, undefined, o.lineWidth, type === 'highlighter' ? o.fillOpacity : 1); break;
		case 'path': case 'arrow-path': path([...p]); if (type === 'arrow-path' && p.length > 1) arrow(p[p.length - 2], p[p.length - 1]); break;
		case 'rotated-rectangle': {
			const dx = b.x - a.x; const dy = b.y - a.y; const len = Math.hypot(dx, dy) || 1;
			const offset = ((c.x - a.x) * -dy + (c.y - a.y) * dx) / len;
			const normal = { x: -dy / len * offset, y: dx / len * offset };
			path([a, b, plus(b, normal), plus(a, normal)], true, undefined, o.fillColor); break;
		}
		case 'ellipse': ellipse(mix(a, b, 0.5), Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, Math.PI * 2, true); break;
		case 'circle': ellipse(a, length(a, b), length(a, b), 0, Math.PI * 2, true); break;
		case 'triangle': path([a, b, c], true, undefined, o.fillColor); break;
		case 'curve': case 'double-curve': case 'arc': {
			if (type === 'arc') {
				// Circumcircle through start, midpoint, and end; collinear points reduce to a line.
				const det = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
				if (Math.abs(det) < 1e-6) { path([a, b, c]); break; }
				const sq = (q: ScreenPoint): number => q.x * q.x + q.y * q.y;
				const center = { x: (sq(a) * (b.y - c.y) + sq(b) * (c.y - a.y) + sq(c) * (a.y - b.y)) / det, y: (sq(a) * (c.x - b.x) + sq(b) * (a.x - c.x) + sq(c) * (b.x - a.x)) / det };
				const angle = (q: ScreenPoint): number => Math.atan2(q.y - center.y, q.x - center.x);
				const norm = (v: number): number => (v + Math.PI * 2) % (Math.PI * 2);
				const start = angle(a); let sweep = norm(angle(c) - start); if (norm(angle(b) - start) > sweep) sweep -= Math.PI * 2;
				ellipse(center, length(center, a), length(center, a), start, start + sweep); break;
			}
			path(Array.from({ length: 81 }, (_, i) => {
				const t = i / 80; const u = 1 - t;
				return type === 'curve' ? { x: u * u * a.x + 2 * u * t * b.x + t * t * c.x, y: u * u * a.y + 2 * u * t * b.y + t * t * c.y } : { x: u ** 3 * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t ** 3 * d.x, y: u ** 3 * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t ** 3 * d.y };
			})); break;
		}
		case 'xabcd': case 'cypher': case 'abcd': case 'triangle-pattern': case 'three-drives': case 'head-shoulders':
		case 'elliott-impulse': case 'elliott-correction': case 'elliott-triangle': case 'elliott-double': case 'elliott-triple': {
			path([...p]);
			const labels: Partial<Record<ExtendedToolType, string[]>> = {
				xabcd: ['X', 'A', 'B', 'C', 'D'], cypher: ['X', 'A', 'B', 'C', 'D'], abcd: ['A', 'B', 'C', 'D'],
				'triangle-pattern': ['A', 'B', 'C', 'D', 'E'], 'three-drives': ['0', '1', 'A', '2', 'B', '3', 'C'],
				'head-shoulders': ['', '左肩', '', '头', '', '右肩', ''], 'elliott-impulse': ['0', '1', '2', '3', '4', '5'],
				'elliott-correction': ['0', 'A', 'B', 'C'], 'elliott-triangle': ['0', 'A', 'B', 'C', 'D', 'E'],
				'elliott-double': ['0', 'W', 'X', 'Y'], 'elliott-triple': ['0', 'W', 'X', 'Y', 'X', 'Z'],
			};
			p.forEach((q, i) => label({ x: q.x, y: q.y + (i % 2 ? -14 : 20) }, labels[type]?.[i] ?? ''));
			if (['xabcd', 'cypher', 'abcd'].includes(type)) {
				if (p.length >= 3) path([a, b, c], true, undefined, o.fillColor);
				if (p.length >= 5) path([p[2], p[3], p[4]], true, undefined, o.fillColor);
				for (let i = 2; i < anchors.length; i++) { const previous = anchors[i - 1].price - anchors[i - 2].price; label(mix(p[i - 1], p[i], 0.5), previous ? compact(Math.abs((anchors[i].price - anchors[i - 1].price) / previous)) : '—'); }
			}
			if (type === 'triangle-pattern' && p.length >= 4) { line(p[0], p[2], false, true); line(p[1], p[3], false, true); }
			if (type === 'head-shoulders' && p.length >= 5) line(p[2], p[4], true, true);
			break;
		}
		case 'cycle-lines': case 'time-cycles': case 'sine-line': {
			const period = Math.max(8, Math.abs(b.x - a.x));
			const first = Math.max(-200, Math.floor(-a.x / period)); const last = Math.min(first + 400, Math.ceil((w - a.x) / period));
			if (type === 'sine-line') path(Array.from({ length: Math.min(2001, Math.ceil(w / 2) + 1) }, (_, i) => ({ x: i * 2, y: a.y + (b.y - a.y || 40) * Math.sin((i * 2 - a.x) / period * Math.PI * 2) })));
			else for (let i = first; i <= last; i++) { const x = a.x + period * i; if (type === 'cycle-lines') line({ x, y: 0 }, { x, y: h }); else ellipse({ x: x + period / 2, y: a.y }, period / 2, Math.abs(b.y - a.y) || period / 2, Math.PI, Math.PI * 2); }
			break;
		}
		case 'long-position': case 'short-position': {
			const direction = type === 'long-position' ? 1 : -1;
			const stop = aa.price - direction * Math.abs(ab.price - aa.price); const target = aa.price + direction * Math.abs(ac.price - aa.price);
			const endX = Math.max(a.x + 70, b.x, c.x);
			const stopY = pricePoint(aa.logical, stop).y; const targetY = pricePoint(aa.logical, target).y;
			box(a, { x: endX, y: stopY }, '#f23645'); box(a, { x: endX, y: targetY }, '#089981');
			line(a, { x: endX, y: a.y });
			const risk = Math.abs(stop - aa.price); const reward = Math.abs(target - aa.price); const qty = risk ? o.accountSize * o.riskPercent / 100 / risk : 0;
			label({ x: a.x, y: targetY - 10 }, `目标 ${compact(target)} · +${compact(qty * reward)}`);
			label(a, `R:R ${risk ? compact(reward / risk) : '—'} · 数量 ${compact(qty)}`);
			label({ x: a.x, y: stopY + 20 }, `止损 ${compact(stop)} · -${compact(qty * risk)}`); break;
		}
		case 'projection': {
			path([a, b, c]);
			const end = pricePoint(ac.logical + ab.logical - aa.logical, ac.price + ab.price - aa.price);
			arrow(c, end); label(end, `投射 ${compact(ac.price + ab.price - aa.price)}`); break;
		}
		case 'ghost-feed': {
			for (let i = 1; i < anchors.length; i++) {
				const start = anchors[i - 1]; const end = anchors[i]; const count = Math.min(300, Math.max(1, Math.round(Math.abs(end.logical - start.logical))));
				for (let j = 0; j < count; j++) {
					const t = (j + 1) / count; const previous = j / count; const logical = start.logical + (end.logical - start.logical) * t;
					const open = start.price + (end.price - start.price) * previous; const close = start.price + (end.price - start.price) * t;
					const upper = Math.max(open, close) + Math.abs(close - open) * 0.25; const lower = Math.min(open, close) - Math.abs(close - open) * 0.25;
					const color = close >= open ? '#089981' : '#f23645'; line(pricePoint(logical, upper), pricePoint(logical, lower), false, false, color);
					const q = pricePoint(logical, open); const r = pricePoint(logical, close); box({ x: q.x - 2, y: q.y }, { x: r.x + 2, y: r.y }, color);
				}
			} label(a, '幽灵 K 线 · 手动情景'); break;
		}
		case 'bars-pattern': {
			if (!rangeBars.length || anchors.length < 3) { label(a, '先选历史区间，再选目标位置'); break; }
			const origin = rangeBars[0];
			for (const bar of rangeBars.slice(0, 1000)) {
				const logical = ac.logical + bar.logical - origin.logical; const offset = ac.price - origin.open;
				const top = pricePoint(logical, bar.high + offset); const bottom = pricePoint(logical, bar.low + offset);
				const open = pricePoint(logical, bar.open + offset); const close = pricePoint(logical, bar.close + offset);
				const color = bar.close >= bar.open ? '#089981' : '#f23645'; line(top, bottom, false, false, color);
				path([{ x: open.x - 2, y: open.y }, { x: close.x + 2, y: open.y }, { x: close.x + 2, y: close.y }, { x: open.x - 2, y: close.y }], true, color, color);
			} break;
		}
		case 'price-range': box(a, b); arrow({ x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y }); label(b, measurement); break;
		case 'date-range': {
			box(a, b); arrow({ x: a.x, y: (a.y + b.y) / 2 }, { x: b.x, y: (a.y + b.y) / 2 });
			const seconds = typeof aa.time === 'number' && typeof ab.time === 'number' ? Math.abs(ab.time - aa.time) : 0;
			label(b, `${compact(Math.abs(ab.logical - aa.logical))} bars · ${compact(seconds / 3600)}h`); break;
		}
		case 'anchored-vwap': {
			let total = 0; let weighted = 0; const points: ScreenPoint[] = [];
			for (const bar of bars) if (bar.logical >= aa.logical) { total += bar.volume; weighted += (bar.high + bar.low + bar.close) / 3 * bar.volume; if (total) points.push(pricePoint(bar.logical, weighted / total)); }
			path(points); label(points.at(-1) ?? a, total ? `AVWAP ${compact(weighted / total)}` : '等待成交量'); break;
		}
		case 'fixed-volume-profile': case 'anchored-volume-profile': {
			const profile = volumeProfile(type === 'anchored-volume-profile' ? bars.filter(bar => bar.logical >= aa.logical) : rangeBars, o.profileRows);
			if (!profile) { label(a, '所选区间暂无成交量'); break; }
			const max = Math.max(...profile.volumes); const x = Math.min(a.x, b.x); const width = Math.max(30, Math.abs((type === 'anchored-volume-profile' ? w - 80 : b.x) - a.x) * 0.45);
			profile.volumes.forEach((v, i) => {
				const low = pricePoint(aa.logical, profile.low + i * profile.step).y; const high = pricePoint(aa.logical, profile.low + (i + 1) * profile.step).y;
				box({ x, y: low }, { x: x + width * v / (max || 1), y: high }, v === max ? '#ffb74d' : o.fillColor);
				if (v === max) { line({ x, y: (low + high) / 2 }, { x: Math.max(a.x, b.x), y: (low + high) / 2 }, false, false, '#ffb74d'); label({ x, y: (low + high) / 2 }, 'POC'); }
			}); label({ x, y: Math.min(a.y, b.y) - 18 }, '成交量分布 · K 线估算'); break;
		}
		case 'anchored-text': case 'note': case 'price-note': case 'pin': case 'callout': case 'comment': case 'price-label': case 'signpost': case 'flag': case 'arrow-up': case 'arrow-down': case 'emoji': {
			let position = type === 'anchored-text' ? { x: (o.anchorX ?? a.x / w) * w, y: (o.anchorY ?? a.y / h) * h } : a;
			let text = o.text;
			if (type === 'callout' || type === 'price-note') { line(a, b); position = b; }
			if (type === 'price-label' || type === 'price-note') text = `${compact(aa.price)}${type === 'price-note' ? ` · ${o.text}` : ''}`;
			if (type === 'pin' || type === 'signpost' || type === 'flag') { line(a, { x: a.x, y: a.y - 30 }); position = { x: a.x, y: a.y - 30 }; }
			if (type === 'flag') text = '⚑'; if (type === 'arrow-up') text = '↑'; if (type === 'arrow-down') text = '↓';
			if (type === 'comment') text = `▤ ${text}`;
			scene.labels.push({ point: position, text, background: !['emoji', 'arrow-up', 'arrow-down', 'flag'].includes(type), ...(['arrow-up', 'arrow-down'].includes(type) ? { fontSize: 24, color: o.color } : {}) }); break;
		}
	}
	return scene;
}
