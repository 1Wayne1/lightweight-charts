export const TIMEFRAMES = new Set([
	'1m', '3m', '5m', '15m', '30m',
	'1h', '2h', '4h', '6h', '8h', '12h',
	'1d', '3d', '1w', '1M',
]);

export const SETTING_KEYS = new Set([
	'indicators',
	'timeframes',
	'drawing-defaults',
	'watchlist',
	'workspace-tabs',
	'custom-colors',
]);

export function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isSafeId(value) {
	return typeof value === 'string' && /^[\w-]{1,128}$/.test(value);
}

export function parseInstrumentKey(key) {
	if (typeof key !== 'string') throw new Error('Invalid instrument key');
	const parts = key.split(':');
	if (parts.length !== 3) throw new Error('Invalid instrument key');
	const [venue, market, symbol] = parts;
	if (!/^[a-z0-9-]+$/.test(venue) || (market !== 'spot' && market !== 'perpetual') || !/^[A-Z0-9]+-[A-Z0-9]+$/.test(symbol)) {
		throw new Error('Invalid instrument key');
	}
	return { venue, market, symbol, instrumentKey: key };
}

export function validateMutationEnvelope(body) {
	if (!isRecord(body)) throw new Error('Request body must be an object');
	if (!isSafeId(body.mutationId)) throw new Error('Invalid mutationId');
	if (!isSafeId(body.deviceId)) throw new Error('Invalid deviceId');
	if (!Number.isSafeInteger(body.baseRevision) || body.baseRevision < 0) {
		throw new Error('Invalid baseRevision');
	}
	return {
		mutationId: body.mutationId,
		deviceId: body.deviceId,
		baseRevision: body.baseRevision,
	};
}

export function validatePreferenceMutation(body) {
	const envelope = validateMutationEnvelope(body);
	if (typeof body.timeframe !== 'string' || !TIMEFRAMES.has(body.timeframe)) {
		throw new Error('Unsupported timeframe');
	}
	return { ...envelope, timeframe: body.timeframe };
}

export function validateDrawingDocument(doc, expectedKey, expectedId) {
	if (!isRecord(doc)) throw new Error('Drawing document must be an object');
	if (doc.schemaVersion !== 1) throw new Error('Unsupported drawing schemaVersion');
	if (typeof doc.id !== 'string' || !isSafeId(doc.id)) throw new Error('Invalid drawing id');
	if (expectedId !== undefined && doc.id !== expectedId) throw new Error('Drawing id mismatch');
	if (typeof doc.instrumentKey !== 'string') throw new Error('Invalid drawing instrumentKey');
	if (expectedKey !== undefined && doc.instrumentKey !== expectedKey) throw new Error('Drawing instrumentKey mismatch');
	parseInstrumentKey(doc.instrumentKey);
	if (typeof doc.kind !== 'string' || !/^[\w-]{1,64}$/.test(doc.kind)) throw new Error('Invalid drawing kind');
	if (!Array.isArray(doc.anchors) || doc.anchors.length < 1 || doc.anchors.length > 2000) {
		throw new Error('Invalid drawing anchors');
	}
	const anchors = doc.anchors.map(anchor => {
		if (!isRecord(anchor) ||
			typeof anchor.time !== 'number' || !Number.isFinite(anchor.time) || Math.abs(anchor.time) > 8e12 ||
			typeof anchor.price !== 'number' || !Number.isFinite(anchor.price) || Math.abs(anchor.price) > 1e15) {
			throw new Error('Invalid drawing anchor point');
		}
		return { time: anchor.time, price: anchor.price };
	});
	if (!isRecord(doc.style)) throw new Error('Invalid drawing style');
	if (typeof doc.deleted !== 'boolean') throw new Error('Invalid drawing deleted flag');
	return {
		schemaVersion: 1,
		id: doc.id,
		instrumentKey: doc.instrumentKey,
		kind: doc.kind,
		anchors,
		style: doc.style,
		deleted: doc.deleted,
	};
}

export function validateDrawingMutation(body, expectedKey, expectedId) {
	const envelope = validateMutationEnvelope(body);
	const document = validateDrawingDocument(body.document, expectedKey, expectedId);
	return { ...envelope, document };
}

export function validateSettingMutation(key, body) {
	if (!SETTING_KEYS.has(key)) throw new Error('Unsupported setting key');
	const envelope = validateMutationEnvelope(body);
	if (!isRecord(body.value)) throw new Error('Setting value must be an object');
	return { ...envelope, value: body.value };
}

export function validateImportPayload(body) {
	if (!isRecord(body)) throw new Error('Import body must be an object');
	const mode = body.mode ?? 'merge';
	if (mode !== 'merge' && mode !== 'replace') throw new Error('Import mode must be merge or replace');
	const snapshot = body.snapshot;
	if (!isRecord(snapshot) || snapshot.schemaVersion !== 1 ||
		!Array.isArray(snapshot.instruments) || snapshot.instruments.length > 5000 ||
		!Array.isArray(snapshot.drawings) || snapshot.drawings.length > 50000) {
		throw new Error('Invalid snapshot structure');
	}
	const instruments = snapshot.instruments.map(item => {
		if (!isRecord(item) || typeof item.instrumentKey !== 'string' || !TIMEFRAMES.has(item.timeframe)) {
			throw new Error('Invalid instrument entry in snapshot');
		}
		const parsed = parseInstrumentKey(item.instrumentKey);
		const revision = Number.isSafeInteger(item.revision) && item.revision >= 1 ? item.revision : 1;
		return {
			...parsed,
			timeframe: item.timeframe,
			revision,
			updatedAt: typeof item.updatedAt === 'string' && item.updatedAt ? item.updatedAt : new Date().toISOString(),
		};
	});
	const seenDrawings = new Set();
	const drawings = snapshot.drawings.map(item => {
		const doc = validateDrawingDocument(item);
		if (seenDrawings.has(doc.id)) throw new Error('Duplicate drawing id in snapshot');
		seenDrawings.add(doc.id);
		const parsed = parseInstrumentKey(doc.instrumentKey);
		const revision = Number.isSafeInteger(item.revision) && item.revision >= 1 ? item.revision : 1;
		return {
			...doc,
			venue: parsed.venue,
			market: parsed.market,
			symbol: parsed.symbol,
			revision,
			updatedAt: typeof item.updatedAt === 'string' && item.updatedAt ? item.updatedAt : new Date().toISOString(),
		};
	});
	const settings = [];
	const rawSettings = snapshot.settings ?? {};
	if (!isRecord(rawSettings)) throw new Error('Invalid settings in snapshot');
	for (const [key, entry] of Object.entries(rawSettings)) {
		if (!SETTING_KEYS.has(key)) throw new Error(`Unsupported setting key: ${key}`);
		if (!isRecord(entry) || !isRecord(entry.value)) throw new Error(`Invalid setting entry: ${key}`);
		const revision = Number.isSafeInteger(entry.revision) && entry.revision >= 1 ? entry.revision : 1;
		settings.push({
			key,
			value: entry.value,
			revision,
			updatedAt: typeof entry.updatedAt === 'string' && entry.updatedAt ? entry.updatedAt : new Date().toISOString(),
		});
	}
	return { mode, snapshot: { instruments, drawings, settings } };
}
