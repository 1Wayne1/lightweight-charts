import type { ScreenPoint } from './types';

export function distancePointToPoint(a: ScreenPoint, b: ScreenPoint): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distancePointToSegment(
	p: ScreenPoint,
	a: ScreenPoint,
	b: ScreenPoint
): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const lenSq = dx * dx + dy * dy;
	if (lenSq < 1e-9) {
		return Math.hypot(p.x - a.x, p.y - a.y);
	}
	let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
	t = Math.max(0, Math.min(1, t));
	const projX = a.x + t * dx;
	const projY = a.y + t * dy;
	return Math.hypot(p.x - projX, p.y - projY);
}

export function distancePointToRay(
	p: ScreenPoint,
	origin: ScreenPoint,
	through: ScreenPoint
): number {
	const dx = through.x - origin.x;
	const dy = through.y - origin.y;
	const lenSq = dx * dx + dy * dy;
	if (lenSq < 1e-9) {
		return Math.hypot(p.x - origin.x, p.y - origin.y);
	}
	const t = Math.max(0, ((p.x - origin.x) * dx + (p.y - origin.y) * dy) / lenSq);
	return Math.hypot(p.x - (origin.x + t * dx), p.y - (origin.y + t * dy));
}

export function distancePointToInfiniteLine(
	p: ScreenPoint,
	a: ScreenPoint,
	b: ScreenPoint
): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len = Math.hypot(dx, dy);
	if (len < 1e-9) {
		return Math.hypot(p.x - a.x, p.y - a.y);
	}
	return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
}

/**
 * Clips a segment, ray, or infinite line passing through `a` and `b`
 * against the viewport `[0, width] x [0, height]` using Liang-Barsky.
 */
export function clipLineToViewport(
	a: ScreenPoint,
	b: ScreenPoint,
	width: number,
	height: number,
	extendLeft: boolean,
	extendRight: boolean
): [ScreenPoint, ScreenPoint] | null {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) {
		return [a, b];
	}

	let tMin = extendLeft ? -Infinity : 0;
	let tMax = extendRight ? Infinity : 1;

	const clip = (p: number, q: number): boolean => {
		if (Math.abs(p) < 1e-9) {
			return q >= 0;
		}
		const r = q / p;
		if (p < 0) {
			if (r > tMax) return false;
			if (r > tMin) tMin = r;
		} else {
			if (r < tMin) return false;
			if (r < tMax) tMax = r;
		}
		return true;
	};

	const margin = 4;
	if (
		!clip(-dx, a.x + margin) ||
		!clip(dx, width + margin - a.x) ||
		!clip(-dy, a.y + margin) ||
		!clip(dy, height + margin - a.y)
	) {
		return null;
	}

	if (!Number.isFinite(tMin) || !Number.isFinite(tMax) || tMin > tMax) {
		return null;
	}

	return [
		{ x: a.x + tMin * dx, y: a.y + tMin * dy },
		{ x: a.x + tMax * dx, y: a.y + tMax * dy },
	];
}

export function pointInRect(
	p: ScreenPoint,
	a: ScreenPoint,
	b: ScreenPoint,
	padding: number = 0
): boolean {
	const minX = Math.min(a.x, b.x) - padding;
	const maxX = Math.max(a.x, b.x) + padding;
	const minY = Math.min(a.y, b.y) - padding;
	const maxY = Math.max(a.y, b.y) + padding;
	return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
}

export function distanceToRectBorder(
	p: ScreenPoint,
	a: ScreenPoint,
	b: ScreenPoint
): number {
	const minX = Math.min(a.x, b.x);
	const maxX = Math.max(a.x, b.x);
	const minY = Math.min(a.y, b.y);
	const maxY = Math.max(a.y, b.y);
	const tl: ScreenPoint = { x: minX, y: minY };
	const tr: ScreenPoint = { x: maxX, y: minY };
	const br: ScreenPoint = { x: maxX, y: maxY };
	const bl: ScreenPoint = { x: minX, y: maxY };
	return Math.min(
		distancePointToSegment(p, tl, tr),
		distancePointToSegment(p, tr, br),
		distancePointToSegment(p, br, bl),
		distancePointToSegment(p, bl, tl)
	);
}

export function pointInPolygon(p: ScreenPoint, polygon: readonly ScreenPoint[]): boolean {
	let inside = false;
	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		const xi = polygon[i].x;
		const yi = polygon[i].y;
		const xj = polygon[j].x;
		const yj = polygon[j].y;
		const intersect =
			yi > p.y !== yj > p.y &&
			p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi;
		if (intersect) {
			inside = !inside;
		}
	}
	return inside;
}

export interface ParallelChannelGeometry {
	/** Baseline segment: p1 -> p2 */
	baseStart: ScreenPoint;
	baseEnd: ScreenPoint;
	/** Parallel segment: p3Start -> p3End */
	parallelStart: ScreenPoint;
	parallelEnd: ScreenPoint;
	/** Midline segment */
	midStart: ScreenPoint;
	midEnd: ScreenPoint;
	/** Vertical pixel offset from baseline at p3.x */
	offsetY: number;
}

/**
 * Computes TradingView-style Parallel Channel geometry:
 * The second line is parallel to p1->p2 and shifted vertically in screen/price space
 * to pass through p3 (preserving identical horizontal span from p1.x to p2.x).
 */
export function computeParallelChannel(
	p1: ScreenPoint,
	p2: ScreenPoint,
	p3: ScreenPoint
): ParallelChannelGeometry {
	const dx = p2.x - p1.x;
	const dy = p2.y - p1.y;
	let offsetY: number;
	if (Math.abs(dx) > 1e-6) {
		const yOnBaseAtP3 = p1.y + ((p3.x - p1.x) / dx) * dy;
		offsetY = p3.y - yOnBaseAtP3;
	} else {
		offsetY = p3.y - p1.y;
	}

	const parallelStart: ScreenPoint = { x: p1.x, y: p1.y + offsetY };
	const parallelEnd: ScreenPoint = { x: p2.x, y: p2.y + offsetY };
	const midStart: ScreenPoint = { x: p1.x, y: p1.y + offsetY / 2 };
	const midEnd: ScreenPoint = { x: p2.x, y: p2.y + offsetY / 2 };

	return {
		baseStart: p1,
		baseEnd: p2,
		parallelStart,
		parallelEnd,
		midStart,
		midEnd,
		offsetY,
	};
}

/**
 * Snaps `target` relative to `origin` to the nearest 45-degree increment (0°, 45°, 90°, ...).
 */
export function snapAngle45(origin: ScreenPoint, target: ScreenPoint): ScreenPoint {
	const dx = target.x - origin.x;
	const dy = target.y - origin.y;
	const dist = Math.hypot(dx, dy);
	if (dist < 1e-6) {
		return target;
	}
	const angle = Math.atan2(dy, dx);
	const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
	return {
		x: origin.x + Math.cos(snapped) * dist,
		y: origin.y + Math.sin(snapped) * dist,
	};
}

/**
 * Converts a CSS hex or rgb/rgba color into an rgba string with the requested alpha.
 */
export function colorWithAlpha(color: string, alpha: number): string {
	const clamped = Math.max(0, Math.min(1, alpha));
	const trimmed = color.trim();
	const hexMatch = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(trimmed);
	if (hexMatch) {
		let hex = hexMatch[1];
		if (hex.length === 3) {
			hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
		}
		const r = parseInt(hex.slice(0, 2), 16);
		const g = parseInt(hex.slice(2, 4), 16);
		const b = parseInt(hex.slice(4, 6), 16);
		return `rgba(${r}, ${g}, ${b}, ${clamped})`;
	}
	const rgbMatch = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(trimmed);
	if (rgbMatch) {
		return `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${clamped})`;
	}
	return color;
}
