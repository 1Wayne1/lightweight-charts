import { getToolDefinition, type DrawingStyleOptions, type DrawingToolType } from '@tradingview/lwc-plugin-drawing-tools';
import { parseDrawingStyle } from './storage';

export const DRAWING_DEFAULTS_STORAGE_KEY = 'crypto-terminal.drawing-defaults.v1';

export interface DrawingStyleDefaultsStore {
	schemaVersion: 1;
	styles: Partial<Record<DrawingToolType, Partial<DrawingStyleOptions>>>;
}

const EXCLUDED_KEYS = new Set<string>(['locked', 'visible', 'text', 'attachedText', 'anchorX', 'anchorY']);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Filter a drawing style patch to reusable per-tool defaults,
 * stripping instance-only properties like lock/visibility/text/coordinates.
 */
export function extractRememberableStyle(options: Partial<DrawingStyleOptions>): Partial<DrawingStyleOptions> {
	const filtered: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(options)) {
		if (value === undefined || EXCLUDED_KEYS.has(key)) continue;
		if (key === 'fibLevels' && Array.isArray(value)) {
			filtered.fibLevels = value.map(level => ({
				value: level.value,
				color: level.color,
				visible: level.visible,
			}));
			continue;
		}
		filtered[key] = value;
	}
	return Object.keys(filtered).length ? parseDrawingStyle(filtered) : {};
}

export function parseDrawingStyleDefaultsStore(input: unknown): DrawingStyleDefaultsStore {
	if (!isRecord(input) || input.schemaVersion !== 1 || !isRecord(input.styles)) {
		throw new Error('Invalid drawing style defaults');
	}
	const styles: Partial<Record<DrawingToolType, Partial<DrawingStyleOptions>>> = {};
	for (const [tool, raw] of Object.entries(input.styles)) {
		if (!isRecord(raw)) throw new Error('Invalid drawing style entry');
		const definition = getToolDefinition(tool as DrawingToolType);
		const rememberable = extractRememberableStyle(parseDrawingStyle(raw));
		if (Object.keys(rememberable).length) {
			styles[definition.type] = rememberable;
		}
	}
	return { schemaVersion: 1, styles };
}

export class DrawingStyleDefaultsRepository {
	private styles: Partial<Record<DrawingToolType, Partial<DrawingStyleOptions>>> = {};
	private loaded = false;

	constructor(private readonly storage?: Pick<Storage, 'getItem' | 'setItem'>) {}

	private ensureLoaded(): void {
		if (this.loaded) return;
		this.loaded = true;
		if (!this.storage) return;
		try {
			const raw = this.storage.getItem(DRAWING_DEFAULTS_STORAGE_KEY);
			if (!raw) return;
			this.styles = parseDrawingStyleDefaultsStore(JSON.parse(raw)).styles;
		} catch {
			this.styles = {};
		}
	}

	get(type: DrawingToolType): Partial<DrawingStyleOptions> | undefined {
		this.ensureLoaded();
		const saved = this.styles[type];
		return saved ? structuredClone(saved) : undefined;
	}

	exportStore(): DrawingStyleDefaultsStore {
		this.ensureLoaded();
		return { schemaVersion: 1, styles: structuredClone(this.styles) };
	}

	reload(): void {
		this.loaded = false;
		this.styles = {};
		this.ensureLoaded();
	}

	remember(type: DrawingToolType, patch: Partial<DrawingStyleOptions>): void {
		this.ensureLoaded();
		const filtered = extractRememberableStyle(patch);
		if (!Object.keys(filtered).length) return;
		const next = { ...(this.styles[type] ?? {}), ...filtered };
		this.styles[type] = next;
		if (!this.storage) return;
		try {
			const payload: DrawingStyleDefaultsStore = { schemaVersion: 1, styles: this.styles };
			this.storage.setItem(DRAWING_DEFAULTS_STORAGE_KEY, JSON.stringify(payload));
		} catch {
			// Ignore storage quota / privacy mode failures for convenience defaults.
		}
	}
}
