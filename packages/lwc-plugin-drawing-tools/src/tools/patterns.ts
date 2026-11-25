import { CanvasRenderingTarget2D } from 'fancy-canvas';
import { DrawingUtils, LineStyle } from 'lightweight-charts';
import {
	applyCanvasLineStyle,
	BaseDrawing,
	BodyHitResult,
	LINE_HIT_TOLERANCE,
} from '../base-drawing';
import {
	clipLineToViewport,
	colorWithAlpha,
	distancePointToPoint,
	distancePointToSegment,
	pointInPolygon,
} from '../geometry';
import {
	AnchorPoint,
	DrawingStyleOptions,
	DrawingToolType,
	ScreenPoint,
	WaveDegree,
} from '../types';

export type PatternToolType =
	| 'elliott-impulse'
	| 'elliott-correction'
	| 'elliott-triangle'
	| 'elliott-double'
	| 'elliott-triple'
	| 'xabcd'
	| 'cypher'
	| 'abcd'
	| 'triangle-pattern'
	| 'three-drives'
	| 'head-shoulders';

export const PATTERN_TOOL_TYPES: readonly PatternToolType[] = [
	'elliott-impulse',
	'elliott-correction',
	'elliott-triangle',
	'elliott-double',
	'elliott-triple',
	'xabcd',
	'cypher',
	'abcd',
	'triangle-pattern',
	'three-drives',
	'head-shoulders',
];

type ElliottToolType =
	| 'elliott-impulse'
	| 'elliott-correction'
	| 'elliott-triangle'
	| 'elliott-double'
	| 'elliott-triple';

const ELLIOTT_DEGREE_MAP: Record<ElliottToolType, Record<WaveDegree, readonly string[]>> = {
	'elliott-impulse': {
		primary: ['⓪', '①', '②', '③', '④', '⑤'],
		intermediate: ['(0)', '(1)', '(2)', '(3)', '(4)', '(5)'],
		minor: ['0', '1', '2', '3', '4', '5'],
		minute: ['[0]', '[i]', '[ii]', '[iii]', '[iv]', '[v]'],
		minuette: ['(0)', '(i)', '(ii)', '(iii)', '(iv)', '(v)'],
		subminuette: ['0', 'i', 'ii', 'iii', 'iv', 'v'],
	},
	'elliott-correction': {
		primary: ['⓪', 'Ⓐ', 'Ⓑ', 'Ⓒ'],
		intermediate: ['(0)', '(A)', '(B)', '(C)'],
		minor: ['0', 'A', 'B', 'C'],
		minute: ['[0]', '[a]', '[b]', '[c]'],
		minuette: ['(0)', '(a)', '(b)', '(c)'],
		subminuette: ['0', 'a', 'b', 'c'],
	},
	'elliott-triangle': {
		primary: ['⓪', 'Ⓐ', 'Ⓑ', 'Ⓒ', 'Ⓓ', 'Ⓔ'],
		intermediate: ['(0)', '(A)', '(B)', '(C)', '(D)', '(E)'],
		minor: ['0', 'A', 'B', 'C', 'D', 'E'],
		minute: ['[0]', '[a]', '[b]', '[c]', '[d]', '[e]'],
		minuette: ['(0)', '(a)', '(b)', '(c)', '(d)', '(e)'],
		subminuette: ['0', 'a', 'b', 'c', 'd', 'e'],
	},
	'elliott-double': {
		primary: ['⓪', 'Ⓦ', 'Ⓧ', 'Ⓨ'],
		intermediate: ['(0)', '(W)', '(X)', '(Y)'],
		minor: ['0', 'W', 'X', 'Y'],
		minute: ['[0]', '[w]', '[x]', '[y]'],
		minuette: ['(0)', '(w)', '(x)', '(y)'],
		subminuette: ['0', 'w', 'x', 'y'],
	},
	'elliott-triple': {
		primary: ['⓪', 'Ⓦ', 'Ⓧ', 'Ⓨ', 'Ⓧ', 'Ⓩ'],
		intermediate: ['(0)', '(W)', '(X)', '(Y)', '(X)', '(Z)'],
		minor: ['0', 'W', 'X', 'Y', 'X', 'Z'],
		minute: ['[0]', '[w]', '[x]', '[y]', '[x]', '[z]'],
		minuette: ['(0)', '(w)', '(x)', '(y)', '(x)', '(z)'],
		subminuette: ['0', 'w', 'x', 'y', 'x', 'z'],
	},
};

const STATIC_PATTERN_LABELS: Record<Exclude<PatternToolType, ElliottToolType>, readonly string[]> = {
	xabcd: ['X', 'A', 'B', 'C', 'D'],
	cypher: ['X', 'A', 'B', 'C', 'D'],
	abcd: ['A', 'B', 'C', 'D'],
	'triangle-pattern': ['A', 'B', 'C', 'D', 'E'],
	'three-drives': ['0', '1', 'A', '2', 'B', '3', 'C'],
	'head-shoulders': ['', '左肩', '', '头部', '', '右肩', ''],
};

const HEAD_SHOULDERS_STEP_NAMES = ['左肩起点', '左肩峰', '左颈线', '头部', '右颈线', '右肩峰', '形态终点'];

export function isElliottTool(type: DrawingToolType): type is ElliottToolType {
	return type in ELLIOTT_DEGREE_MAP;
}

export function formatWaveLabels(type: PatternToolType, degree: WaveDegree): readonly string[] {
	if (isElliottTool(type)) {
		return ELLIOTT_DEGREE_MAP[type][degree] ?? ELLIOTT_DEGREE_MAP[type].intermediate;
	}
	return STATIC_PATTERN_LABELS[type];
}

/**
 * Returns -1 to place vertex label ABOVE a local peak (smaller screen Y),
 * or +1 to place it BELOW a local trough (larger screen Y).
 */
export function vertexLabelDirection(pts: readonly ScreenPoint[], index: number): -1 | 1 {
	const cur = pts[index];
	const prev = index > 0 ? pts[index - 1] : null;
	const next = index < pts.length - 1 ? pts[index + 1] : null;
	if (!cur) return -1;
	if (prev && next) {
		const dyPrev = cur.y - prev.y;
		const dyNext = cur.y - next.y;
		if (dyPrev <= 0 && dyNext <= 0) return -1;
		if (dyPrev >= 0 && dyNext >= 0) return 1;
		return dyPrev + dyNext <= 0 ? -1 : 1;
	}
	if (next) return cur.y <= next.y ? -1 : 1;
	if (prev) return cur.y <= prev.y ? -1 : 1;
	return -1;
}

export function patternStepHint(
	type: PatternToolType,
	draftCount: number,
	degree: WaveDegree = 'intermediate'
): string {
	const labels = formatWaveLabels(type, degree);
	const total = labels.length;
	const clamped = Math.max(0, Math.min(total - 1, draftCount));
	const stepName =
		type === 'head-shoulders'
			? HEAD_SHOULDERS_STEP_NAMES[clamped]
			: isElliottTool(type)
				? `浪 ${labels[clamped]}`
				: `点 ${labels[clamped]}`;
	const title =
		type === 'elliott-impulse'
			? '艾略特推动浪'
			: type === 'elliott-correction'
				? '艾略特修正浪'
				: type === 'elliott-triangle'
					? '艾略特三角浪'
					: type === 'elliott-double'
						? '艾略特双重组合'
						: type === 'elliott-triple'
							? '艾略特三重组合'
							: type === 'xabcd'
								? 'XABCD 形态'
								: type === 'cypher'
									? '赛福形态'
									: type === 'abcd'
										? 'ABCD 形态'
										: type === 'triangle-pattern'
											? '三角形形态'
											: type === 'three-drives'
												? '三驱动形态'
												: '头肩形态';
	return `${title} (${Math.min(draftCount + 1, total)}/${total}) · 点击放置${stepName}`;
}

function drawRoundedRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number
): void {
	const radius = Math.min(r, w / 2, h / 2);
	ctx.beginPath();
	ctx.moveTo(x + radius, y);
	ctx.lineTo(x + w - radius, y);
	ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
	ctx.lineTo(x + w, y + h - radius);
	ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
	ctx.lineTo(x + radius, y + h);
	ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
	ctx.lineTo(x, y + radius);
	ctx.quadraticCurveTo(x, y, x + radius, y);
	ctx.closePath();
}

const formatRatio = (num: number, den: number): string => {
	if (!Number.isFinite(num) || !Number.isFinite(den) || Math.abs(den) < 1e-12) return '';
	const ratio = Math.abs(num / den);
	if (!Number.isFinite(ratio)) return '';
	return ratio.toFixed(3).replace(/\.?0+$/, '');
};

export class PatternDrawing extends BaseDrawing {
	public readonly type: PatternToolType;
	private _labelHitRects: Array<{ x: number; y: number; w: number; h: number }> = [];

	public constructor(
		type: PatternToolType,
		id: string,
		points: AnchorPoint[],
		options: Partial<DrawingStyleOptions> = {}
	) {
		super(id, points, options);
		this.type = type;
	}

	public override previewStepLabel(draftCount: number): string {
		return patternStepHint(this.type, draftCount, this._options.waveDegree);
	}

	public draw(target: CanvasRenderingTarget2D, utils?: DrawingUtils): void {
		const pts = this._screenPoints.filter((p): p is ScreenPoint => p !== null);
		if (pts.length === 0) return;

		const opts = this._options;
		const elliott = isElliottTool(this.type);
		const labels = formatWaveLabels(this.type, opts.waveDegree);
		const showMainLines = !elliott || opts.waveShowLines;
		const active = this.isHovered() || this.isSelected() || this.isPreview();
		const fillAlpha = active ? opts.fillOpacity : Math.min(opts.fillOpacity, opts.fillOpacity * 0.72);

		target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
			this._labelHitRects = [];
			ctx.save();
			ctx.beginPath();
			ctx.rect(0, 0, mediaSize.width, mediaSize.height);
			ctx.clip();
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';

			// 1. Translucent fills for harmonic / classic patterns
			if (this.type === 'xabcd' || this.type === 'cypher' || this.type === 'abcd') {
				if (pts.length >= 3) {
					ctx.fillStyle = colorWithAlpha(opts.fillColor, fillAlpha);
					ctx.beginPath();
					ctx.moveTo(pts[0].x, pts[0].y);
					ctx.lineTo(pts[1].x, pts[1].y);
					ctx.lineTo(pts[2].x, pts[2].y);
					ctx.closePath();
					ctx.fill();
				}
				if (pts.length >= 5) {
					ctx.fillStyle = colorWithAlpha(opts.fillColor, fillAlpha);
					ctx.beginPath();
					ctx.moveTo(pts[2].x, pts[2].y);
					ctx.lineTo(pts[3].x, pts[3].y);
					ctx.lineTo(pts[4].x, pts[4].y);
					ctx.closePath();
					ctx.fill();
				}
			} else if (this.type === 'head-shoulders') {
				ctx.fillStyle = colorWithAlpha(opts.fillColor, fillAlpha);
				for (const [i0, i1, i2] of [[0, 1, 2], [2, 3, 4], [4, 5, 6]] as const) {
					if (pts.length > i2) {
						ctx.beginPath();
						ctx.moveTo(pts[i0].x, pts[i0].y);
						ctx.lineTo(pts[i1].x, pts[i1].y);
						ctx.lineTo(pts[i2].x, pts[i2].y);
						ctx.closePath();
						ctx.fill();
					}
				}
			} else if (this.type === 'triangle-pattern' && pts.length >= 4) {
				ctx.fillStyle = colorWithAlpha(opts.fillColor, fillAlpha);
				ctx.beginPath();
				ctx.moveTo(pts[0].x, pts[0].y);
				ctx.lineTo(pts[2].x, pts[2].y);
				if (pts.length >= 5) ctx.lineTo(pts[4].x, pts[4].y);
				ctx.lineTo(pts[3].x, pts[3].y);
				ctx.lineTo(pts[1].x, pts[1].y);
				ctx.closePath();
				ctx.fill();
			}

			// 2. Main polyline (solid for committed legs, dashed for active preview trailing leg)
			if (pts.length >= 2) {
				const committedEnd = this.isPreview() && pts.length >= 2 ? pts.length - 1 : pts.length;
				const shouldStroke = showMainLines || this.isSelected() || this.isHovered() || this.isPreview();
				if (shouldStroke) {
					ctx.strokeStyle = showMainLines ? opts.color : colorWithAlpha(opts.color, 0.45);
					ctx.lineWidth = showMainLines ? opts.lineWidth : Math.max(1, opts.lineWidth - 0.5);
					if (committedEnd >= 2) {
						applyCanvasLineStyle(
							ctx,
							showMainLines ? opts.lineStyle : LineStyle.Dashed,
							ctx.lineWidth,
							utils
						);
						ctx.beginPath();
						ctx.moveTo(pts[0].x, pts[0].y);
						for (let i = 1; i < committedEnd; i++) {
							ctx.lineTo(pts[i].x, pts[i].y);
						}
						ctx.stroke();
					}
					if (this.isPreview() && pts.length >= 2) {
						const tailStart = pts[pts.length - 2];
						const tailEnd = pts[pts.length - 1];
						ctx.strokeStyle = colorWithAlpha(opts.color, 0.85);
						ctx.lineWidth = Math.max(1, opts.lineWidth);
						applyCanvasLineStyle(ctx, LineStyle.Dashed, ctx.lineWidth, utils);
						ctx.beginPath();
						ctx.moveTo(tailStart.x, tailStart.y);
						ctx.lineTo(tailEnd.x, tailEnd.y);
						ctx.stroke();
					}
				}
			}

			// 3. Structural guides (harmonic diagonals & ratios, H&S neckline, triangle rails, three-drives)
			const drawDashedConnector = (a: ScreenPoint, b: ScreenPoint, extendL = false, extendR = false): void => {
				const seg = clipLineToViewport(a, b, mediaSize.width, mediaSize.height, extendL, extendR);
				if (!seg) return;
				ctx.strokeStyle = colorWithAlpha(opts.color, active ? 0.8 : 0.42);
				ctx.lineWidth = Math.max(1, opts.lineWidth - 0.5);
				applyCanvasLineStyle(ctx, LineStyle.Dashed, ctx.lineWidth, utils);
				ctx.beginPath();
				ctx.moveTo(seg[0].x, seg[0].y);
				ctx.lineTo(seg[1].x, seg[1].y);
				ctx.stroke();
			};

			const drawRatioPill = (mid: ScreenPoint, text: string): void => {
				if (!opts.showLabels || !text) return;
				const fSize = Math.max(10, Math.min(13, opts.fontSize - 1));
				ctx.font = `600 ${fSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
				ctx.textAlign = 'center';
				ctx.textBaseline = 'middle';
				ctx.setLineDash([]);
				const tw = ctx.measureText(text).width;
				const pw = tw + 10;
				const ph = fSize + 6;
				const px = mid.x - pw / 2;
				const py = mid.y - ph / 2;
				if (active) {
					drawRoundedRect(ctx, px, py, pw, ph, 4);
					ctx.fillStyle = colorWithAlpha(opts.backgroundColor || '#1E222D', 0.86);
					ctx.fill();
					ctx.fillStyle = opts.textColor || '#FFFFFF';
					ctx.fillText(text, mid.x, mid.y + 0.5);
				} else {
					ctx.strokeStyle = 'rgba(14, 17, 23, 0.88)';
					ctx.lineWidth = 3.5;
					ctx.strokeText(text, mid.x, mid.y + 0.5);
					ctx.fillStyle = opts.textColor && opts.textColor !== '#FFFFFF' ? opts.textColor : opts.color;
					ctx.fillText(text, mid.x, mid.y + 0.5);
				}
				this._labelHitRects.push({ x: px, y: py, w: pw, h: ph });
			};

			if (this.type === 'xabcd' || this.type === 'cypher' || this.type === 'abcd') {
				const pairs: Array<[number, number, number, number]> =
					this.type === 'abcd'
						? [[0, 2, 1, 0], [1, 3, 2, 1]]
						: [[0, 2, 1, 0], [1, 3, 2, 1], [2, 4, 3, 2], [0, 4, 3, 0]];
				for (const [fromIdx, toIdx, numEndIdx, denStartIdx] of pairs) {
					if (pts.length > toIdx && this._points[fromIdx] && this._points[toIdx] && this._points[numEndIdx] && this._points[denStartIdx]) {
						drawDashedConnector(pts[fromIdx], pts[toIdx]);
						const mid = { x: (pts[fromIdx].x + pts[toIdx].x) / 2, y: (pts[fromIdx].y + pts[toIdx].y) / 2 };
						let ratio = '';
						if (fromIdx === 0 && toIdx === 4 && this._points.length >= 5) {
							// XD / XA (or XC / XA for cypher)
							const refIdx = this.type === 'cypher' ? 3 : 1;
							ratio = formatRatio(
								this._points[4].price - this._points[0].price,
								this._points[refIdx].price - this._points[0].price
							);
						} else {
							ratio = formatRatio(
								this._points[toIdx].price - this._points[numEndIdx].price,
								this._points[numEndIdx].price - this._points[denStartIdx].price
							);
						}
						drawRatioPill(mid, ratio);
					}
				}
			} else if (this.type === 'head-shoulders' && pts.length >= 5) {
				drawDashedConnector(pts[2], pts[4], true, true);
			} else if (this.type === 'triangle-pattern' && pts.length >= 4) {
				drawDashedConnector(pts[0], pts[2], false, true);
				drawDashedConnector(pts[1], pts[3], false, true);
			} else if (this.type === 'three-drives') {
				for (const [i, j] of [[1, 3], [3, 5], [2, 4]] as const) {
					if (pts.length > j && this._points[i] && this._points[j]) {
						drawDashedConnector(pts[i], pts[j]);
						if (this._points[i - 1] && this._points[j - 1]) {
							const ratio = formatRatio(
								this._points[j].price - this._points[j - 1].price,
								this._points[i].price - this._points[i - 1].price
							);
							drawRatioPill({ x: (pts[i].x + pts[j].x) / 2, y: (pts[i].y + pts[j].y) / 2 }, ratio);
						}
					}
				}
			}

			// 4. Peak / trough adaptive centered labels
			if (opts.showLabels) {
				const fontSize = Math.max(11, opts.fontSize);
				ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, sans-serif`;
				ctx.textAlign = 'center';
				ctx.textBaseline = 'middle';
				ctx.setLineDash([]);
				const offset = Math.max(15, fontSize * 0.9 + 6);

				for (let i = 0; i < pts.length; i++) {
					const labelText = labels[i] ?? '';
					if (!labelText) continue;
					const pt = pts[i];
					const isActiveTip = this.isPreview() && i === pts.length - 1;
					const dir = vertexLabelDirection(pts, i);
					const lx = isActiveTip ? pt.x + 16 : pt.x;
					const ly = isActiveTip ? pt.y - 16 : Math.max(12, Math.min(mediaSize.height - 12, pt.y + dir * offset));
					const tw = ctx.measureText(labelText).width;
					const lh = fontSize + 6;
					this._labelHitRects.push({ x: lx - tw / 2 - 4, y: ly - lh / 2, w: tw + 8, h: lh });

					if (isActiveTip) {
						const pw = tw + 10;
						const ph = fontSize + 8;
						drawRoundedRect(ctx, lx - pw / 2, ly - ph / 2, pw, ph, 4);
						ctx.fillStyle = '#2962FF';
						ctx.fill();
						ctx.fillStyle = '#FFFFFF';
						ctx.fillText(labelText, lx, ly + 0.5);
					} else {
						ctx.strokeStyle = 'rgba(14, 17, 23, 0.92)';
						ctx.lineWidth = 4;
						ctx.strokeText(labelText, lx, ly);
						ctx.fillStyle = opts.textColor && opts.textColor !== '#FFFFFF' ? opts.textColor : opts.color;
						ctx.fillText(labelText, lx, ly);
					}
				}
			}

			ctx.restore();
		});
	}

	protected hitTestBody(point: ScreenPoint, hitSlop: number = 0): BodyHitResult | null {
		const pts = this._screenPoints.filter((p): p is ScreenPoint => p !== null);
		if (pts.length === 0) return null;

		for (const rect of this._labelHitRects) {
			if (
				point.x >= rect.x - hitSlop &&
				point.x <= rect.x + rect.w + hitSlop &&
				point.y >= rect.y - hitSlop &&
				point.y <= rect.y + rect.h + hitSlop
			) {
				return { distance: 0, priority: 1, cursorStyle: 'grab' };
			}
		}

		const tol = LINE_HIT_TOLERANCE + hitSlop + this._options.lineWidth / 2;
		let minDist = Infinity;
		for (let i = 1; i < pts.length; i++) {
			minDist = Math.min(minDist, distancePointToSegment(point, pts[i - 1], pts[i]));
		}
		if (pts.length === 1) {
			minDist = distancePointToPoint(point, pts[0]);
		}
		if (minDist <= tol) {
			return { distance: minDist, priority: 1, cursorStyle: 'grab' };
		}

		if (this.type === 'xabcd' || this.type === 'cypher' || this.type === 'abcd') {
			if (pts.length >= 3 && pointInPolygon(point, [pts[0], pts[1], pts[2]])) {
				return { distance: 0, priority: 0, cursorStyle: 'grab' };
			}
			if (pts.length >= 5 && pointInPolygon(point, [pts[2], pts[3], pts[4]])) {
				return { distance: 0, priority: 0, cursorStyle: 'grab' };
			}
		} else if (this.type === 'head-shoulders') {
			for (const [i0, i1, i2] of [[0, 1, 2], [2, 3, 4], [4, 5, 6]] as const) {
				if (pts.length > i2 && pointInPolygon(point, [pts[i0], pts[i1], pts[i2]])) {
					return { distance: 0, priority: 0, cursorStyle: 'grab' };
				}
			}
		} else if (this.type === 'triangle-pattern' && pts.length >= 4) {
			const poly = pts.length >= 5 ? [pts[0], pts[2], pts[4], pts[3], pts[1]] : [pts[0], pts[2], pts[3], pts[1]];
			if (pointInPolygon(point, poly)) {
				return { distance: 0, priority: 0, cursorStyle: 'grab' };
			}
		}

		return null;
	}
}
