export const CUSTOM_COLORS_STORAGE_KEY = 'crypto-terminal.custom-colors.v1';
export const MAX_CUSTOM_COLORS = 20;

/**
 * TradingView 10-column palette:
 * - Primary block (2 rows): 10 grayscales + 10 base hues
 * - Shades block (6 rows): lightest tint to deepest shade per hue column
 */
export const TV_PRIMARY_COLORS: readonly string[] = [
	// Grayscale (white -> black)
	'#ffffff', '#d1d4dc', '#b2b5be', '#9598a1', '#787b86',
	'#5d606b', '#434651', '#2a2e39', '#131722', '#000000',
	// Base hues (red -> pink)
	'#f23645', '#ff9800', '#ffeb3b', '#4caf50', '#089981',
	'#00bcd4', '#2962ff', '#673ab7', '#9c27b0', '#e91e63',
];

export const TV_SHADE_COLORS: readonly string[] = [
	// Row 1 (lightest)
	'#fccbcd', '#ffe0b2', '#fff9c4', '#c8e6c9', '#ace5dc',
	'#b2ebf2', '#bbd9fb', '#d1c4e9', '#e1bee7', '#f8bbd0',
	// Row 2
	'#faa1a4', '#ffcc80', '#fff59d', '#a5d6a7', '#70ccbd',
	'#80deea', '#90bff9', '#b39ddb', '#ce93d8', '#f48fb1',
	// Row 3
	'#f77c80', '#ffb74d', '#fff176', '#81c784', '#42bda8',
	'#4dd0e1', '#5b9cf6', '#9575cd', '#ba68c8', '#f06292',
	// Row 4
	'#f7525f', '#ffa726', '#ffee58', '#66bb6a', '#22ab94',
	'#26c6da', '#3179f5', '#7e57c2', '#ab47bc', '#ec407a',
	// Row 5 (dark)
	'#b22833', '#f57c00', '#fbc02d', '#388e3c', '#056656',
	'#0097a7', '#1848cc', '#512da8', '#7b1fa2', '#c2185b',
	// Row 6 (deepest)
	'#801922', '#e65100', '#f57f17', '#1b5e20', '#00332a',
	'#006064', '#0c3299', '#311b92', '#4a148c', '#880e4f',
];

export interface HsvColor {
	/** Hue in [0, 360). */
	h: number;
	/** Saturation in [0, 1]. */
	s: number;
	/** Value (brightness) in [0, 1]. */
	v: number;
}

export interface ParsedHexColor {
	/** Normalized 6-digit lowercase hex (#rrggbb). */
	hex: string;
	/** Alpha in [0, 1]. */
	alpha: number;
}

export const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function toHexByte(value: number): string {
	return clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
}

export function parseHexColor(input: string, fallback = '#2962ff'): ParsedHexColor {
	const raw = input.trim();
	if (/^#[0-9a-fA-F]{6}$/.test(raw)) {
		return { hex: raw.toLowerCase(), alpha: 1 };
	}
	if (/^#[0-9a-fA-F]{8}$/.test(raw)) {
		const alphaByte = parseInt(raw.slice(7, 9), 16);
		return { hex: raw.slice(0, 7).toLowerCase(), alpha: alphaByte / 255 };
	}
	if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
		return {
			hex: `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`.toLowerCase(),
			alpha: 1,
		};
	}
	return { hex: fallback, alpha: 1 };
}

export function formatHexWithAlpha(hex6: string, alpha: number): string {
	const { hex } = parseHexColor(hex6);
	const clamped = clamp(alpha, 0, 1);
	if (clamped >= 0.996) return hex;
	return `${hex}${toHexByte(clamped * 255)}`;
}

export function hexToHsv(hexInput: string): HsvColor {
	const { hex } = parseHexColor(hexInput);
	const r = parseInt(hex.slice(1, 3), 16) / 255;
	const g = parseInt(hex.slice(3, 5), 16) / 255;
	const b = parseInt(hex.slice(5, 7), 16) / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const delta = max - min;

	let h = 0;
	if (delta > 0) {
		if (max === r) h = 60 * (((g - b) / delta) % 6);
		else if (max === g) h = 60 * ((b - r) / delta + 2);
		else h = 60 * ((r - g) / delta + 4);
		if (h < 0) h += 360;
	}
	const s = max === 0 ? 0 : delta / max;
	return { h: h % 360, s, v: max };
}

export function hsvToHex(hsv: HsvColor): string {
	const h = ((hsv.h % 360) + 360) % 360;
	const s = clamp(hsv.s, 0, 1);
	const v = clamp(hsv.v, 0, 1);
	const c = v * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = v - c;
	let r = 0;
	let g = 0;
	let b = 0;
	if (h < 60) { r = c; g = x; }
	else if (h < 120) { r = x; g = c; }
	else if (h < 180) { g = c; b = x; }
	else if (h < 240) { g = x; b = c; }
	else if (h < 300) { r = x; b = c; }
	else { r = c; b = x; }
	return `#${toHexByte((r + m) * 255)}${toHexByte((g + m) * 255)}${toHexByte((b + m) * 255)}`;
}

export interface CustomColorsStore {
	schemaVersion: 1;
	colors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseCustomColorsStore(input: unknown): CustomColorsStore {
	if (!isRecord(input) || input.schemaVersion !== 1 || !Array.isArray(input.colors)) {
		throw new Error('Invalid custom colors store');
	}
	const seen = new Set<string>();
	const colors: string[] = [];
	for (const entry of input.colors) {
		if (typeof entry !== 'string' || !HEX_COLOR_RE.test(entry.trim())) {
			throw new Error('Invalid custom color entry');
		}
		const normalized = parseHexColor(entry).hex;
		if (seen.has(normalized)) continue;
		seen.add(normalized);
		colors.push(normalized);
		if (colors.length >= MAX_CUSTOM_COLORS) break;
	}
	return { schemaVersion: 1, colors };
}

export class CustomColorRepository {
	private colors: string[] = [];
	private loaded = false;

	constructor(private readonly storage?: Pick<Storage, 'getItem' | 'setItem'>) {}

	private ensureLoaded(): void {
		if (this.loaded) return;
		this.loaded = true;
		if (!this.storage) return;
		try {
			const raw = this.storage.getItem(CUSTOM_COLORS_STORAGE_KEY);
			if (!raw) return;
			this.colors = parseCustomColorsStore(JSON.parse(raw)).colors;
		} catch {
			this.colors = [];
		}
	}

	private persist(): void {
		if (!this.storage) return;
		try {
			const payload: CustomColorsStore = { schemaVersion: 1, colors: this.colors };
			this.storage.setItem(CUSTOM_COLORS_STORAGE_KEY, JSON.stringify(payload));
		} catch {
			// Ignore storage quota or private mode errors.
		}
	}

	list(): string[] {
		this.ensureLoaded();
		return [...this.colors];
	}

	exportStore(): CustomColorsStore {
		this.ensureLoaded();
		return { schemaVersion: 1, colors: [...this.colors] };
	}

	reload(): void {
		this.loaded = false;
		this.colors = [];
		this.ensureLoaded();
	}

	add(hexInput: string): string[] {
		this.ensureLoaded();
		const normalized = parseHexColor(hexInput).hex;
		const filtered = this.colors.filter(item => item !== normalized);
		filtered.push(normalized);
		this.colors = filtered.slice(-MAX_CUSTOM_COLORS);
		this.persist();
		return [...this.colors];
	}

	remove(hexInput: string): string[] {
		this.ensureLoaded();
		const normalized = parseHexColor(hexInput).hex;
		this.colors = this.colors.filter(item => item !== normalized);
		this.persist();
		return [...this.colors];
	}
}
