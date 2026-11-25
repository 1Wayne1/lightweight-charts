import type { DrawingDocument } from '@terminal/domain';
import { BASE_DRAWING_OPTIONS, getToolDefinition, type DrawingStyleOptions, type DrawingToolType, type SerializedDrawing } from '@tradingview/lwc-plugin-drawing-tools';
import { DrawingTimeScale } from './coordinates';

export interface DrawingStore { schemaVersion: 1; instrumentKey: string; documents: DrawingDocument[]; }
export const drawingStorageKey = (key: string): string => `crypto-terminal.drawings.v1.${key}`;
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const color = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v);

/** Strict versioned parsing. Unknown fields/options are preserved by blocking writes, never dropped. */
export function parseDrawingStore(input: unknown, key: string): DrawingStore {
	if (!record(input) || input.schemaVersion !== 1 || input.instrumentKey !== key || !Array.isArray(input.documents) || input.documents.length > 10000) throw new Error('画线数据版本或交易对不匹配');
	const ids = new Set<string>();
	const documents = input.documents.map((value: unknown): DrawingDocument => {
		if (!record(value) || value.schemaVersion !== 1 || value.instrumentKey !== key || typeof value.id !== 'string' || !/^[\w-]{1,128}$/.test(value.id) || ids.has(value.id) || typeof value.kind !== 'string' || !Array.isArray(value.anchors) || !record(value.style) || typeof value.deleted !== 'boolean' || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0) throw new Error('画线记录无效');
		ids.add(value.id);
		const definition = getToolDefinition(value.kind as DrawingToolType);
		if (definition.pointCount > 0 ? value.anchors.length !== definition.pointCount : value.anchors.length < 2 || value.anchors.length > 2000) throw new Error('画线锚点数量无效');
		const anchors = value.anchors.map((anchor: unknown) => {
			if (!record(anchor) || !finite(anchor.time) || Math.abs(anchor.time) > 8e12 || !finite(anchor.price) || Math.abs(anchor.price) > 1e15) throw new Error('画线时间或价格无效');
			return { time: anchor.time, price: anchor.price };
		});
		const style = parseDrawingStyle(value.style);
		return { schemaVersion: 1, id: value.id, instrumentKey: key, kind: definition.type, anchors, style: { ...style }, revision: Number(value.revision), deleted: value.deleted };
	});
	return { schemaVersion: 1, instrumentKey: key, documents };
}

export function parseDrawingStyle(value: Record<string, unknown>): Partial<DrawingStyleOptions> {
	for (const [key, option] of Object.entries(value)) {
		if (!Object.hasOwn(BASE_DRAWING_OPTIONS, key) && !['anchorX', 'anchorY'].includes(key)) throw new Error(`不支持的画线属性 ${key}`);
		if (['color', 'fillColor', 'textColor', 'backgroundColor'].includes(key)) { if (!color(option)) throw new Error('画线颜色无效'); }
		else if (['text', 'attachedText'].includes(key)) { if (typeof option !== 'string' || option.length > 10000) throw new Error('画线文字无效'); }
		else if (['textAlign', 'textPosition', 'textOrientation'].includes(key)) {
			const choices: Record<string, string[]> = { textAlign: ['left', 'center', 'right'], textPosition: ['top', 'middle', 'bottom'], textOrientation: ['horizontal', 'vertical'] };
			if (typeof option !== 'string' || !choices[key].includes(option)) throw new Error('文字对齐方式无效');
		}
		else if (key === 'waveDegree') {
			if (typeof option !== 'string' || !['primary', 'intermediate', 'minor', 'minute', 'minuette', 'subminuette'].includes(option)) throw new Error('波浪级别无效');
		}
		else if (key === 'zOrder') { if (!['top', 'normal', 'bottom'].includes(String(option))) throw new Error('画线层次无效'); }
		else if (key === 'fibLevels') {
			if (!Array.isArray(option) || option.length > 100 || !option.every((level: unknown) => record(level) && finite(level.value) && Math.abs(level.value) <= 1000 && color(level.color) && typeof level.visible === 'boolean' && (level.text === undefined || (typeof level.text === 'string' && level.text.length <= 10000)))) throw new Error('斐波那契比例无效');
		} else if (typeof BASE_DRAWING_OPTIONS[key as keyof DrawingStyleOptions] === 'boolean') {
			if (typeof option !== 'boolean') throw new Error('画线开关无效');
		} else {
			if (!finite(option)) throw new Error('画线数值无效');
			const bounds: Record<string, [number, number]> = { lineWidth: [0.5, 32], fontSize: [8, 72], fillOpacity: [0, 1], textOpacity: [0, 1], lineStyle: [0, 4], accountSize: [1, 1e12], riskPercent: [0.01, 100], deviations: [0.1, 10], profileRows: [4, 100], anchorX: [-10, 10], anchorY: [-10, 10] };
			const limit = bounds[key];
			if (!limit || option < limit[0] || option > limit[1] || (['lineStyle', 'profileRows'].includes(key) && !Number.isInteger(option))) throw new Error('画线属性超出范围');
		}
	}
	return structuredClone(value) as Partial<DrawingStyleOptions>;
}

export function restoreDrawings(store: DrawingStore, scale: DrawingTimeScale): SerializedDrawing[] {
	return store.documents.filter(d => !d.deleted).map(d => ({ id: d.id, type: d.kind as DrawingToolType, points: d.anchors.map(a => scale.project(a)), options: parseDrawingStyle(d.style) }));
}

/** Keep deletion tombstones and server revisions. Undo revives the same ID. */
export function reconcileDrawings(previous: DrawingStore, drawings: readonly SerializedDrawing[], scale: DrawingTimeScale): DrawingStore {
	const old = new Map(previous.documents.map(d => [d.id, d]));
	const ids = new Set(drawings.map(d => d.id));
	const documents: DrawingDocument[] = drawings.map(d => ({
		schemaVersion: 1, id: d.id, instrumentKey: previous.instrumentKey, kind: d.type,
		anchors: d.points.map(p => ({ time: typeof p.time === 'number' ? p.time : scale.toTime(p.logical), price: p.price })),
		style: structuredClone(d.options) as Record<string, unknown>, revision: old.get(d.id)?.revision ?? 0, deleted: false,
	}));
	for (const document of previous.documents) if (!ids.has(document.id)) documents.push({ ...document, deleted: true });
	return { ...previous, documents };
}

/** Compare before writing to avoid overwriting another browser tab's changes. */
export class DrawingRepository {
	private baseline: string | null = null;
	private blocked = false;
	constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'>, readonly key: string) {}
	load(): DrawingStore {
		try {
			this.baseline = this.storage.getItem(drawingStorageKey(this.key));
			return this.baseline === null ? { schemaVersion: 1, instrumentKey: this.key, documents: [] } : parseDrawingStore(JSON.parse(this.baseline), this.key);
		} catch (error) { this.blocked = true; throw error; }
	}
	save(store: DrawingStore): void {
		if (this.blocked) throw new Error('原始画线数据已保留，请导出备份后处理');
		const current = this.storage.getItem(drawingStorageKey(this.key));
		if (current !== this.baseline) throw new Error('另一窗口已修改画线；请导出当前修改并刷新');
		const json = JSON.stringify(store);
		parseDrawingStore(JSON.parse(json), this.key);
		this.storage.setItem(drawingStorageKey(this.key), json);
		this.baseline = json;
	}
}
