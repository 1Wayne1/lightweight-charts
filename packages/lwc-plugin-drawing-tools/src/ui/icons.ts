import { DrawingToolType } from '../types';

const svg = (inner: string, size: number = 20): string =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

export const TOOL_ICONS: Partial<Record<DrawingToolType, string>> = {
	'trend-line': svg(
		`<line x1="5" y1="19" x2="19" y2="5"/><circle cx="5" cy="19" r="2" fill="currentColor"/><circle cx="19" cy="5" r="2" fill="currentColor"/>`
	),
	ray: svg(
		`<line x1="5" y1="19" x2="21" y2="3"/><circle cx="5" cy="19" r="2" fill="currentColor"/><circle cx="13" cy="11" r="2" fill="currentColor"/>`
	),
	'horizontal-line': svg(
		`<line x1="3" y1="12" x2="21" y2="12"/><circle cx="12" cy="12" r="2" fill="currentColor"/>`
	),
	'vertical-line': svg(
		`<line x1="12" y1="3" x2="12" y2="21"/><circle cx="12" cy="12" r="2" fill="currentColor"/>`
	),
	rectangle: svg(
		`<rect x="4" y="6" width="16" height="12" rx="1"/><circle cx="4" cy="6" r="1.7" fill="currentColor"/><circle cx="20" cy="18" r="1.7" fill="currentColor"/>`
	),
	'parallel-channel': svg(
		`<line x1="4" y1="15" x2="17" y2="5"/><line x1="7" y1="19" x2="20" y2="9"/><line x1="5.5" y1="17" x2="18.5" y2="7" stroke-dasharray="2 2"/>`
	),
	'fib-retracement': svg(
		`<line x1="3" y1="5" x2="21" y2="5"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="3" y1="19" x2="21" y2="19"/><circle cx="6" cy="5" r="1.5" fill="currentColor"/><circle cx="18" cy="19" r="1.5" fill="currentColor"/>`
	),
	'price-date-range': svg(
		`<rect x="4" y="5" width="16" height="14" rx="1" stroke-dasharray="3 2"/><line x1="12" y1="17" x2="12" y2="7"/><polyline points="9 10 12 7 15 10"/><line x1="6" y1="12" x2="18" y2="12"/><polyline points="15 9 18 12 15 15"/>`
	),
	text: svg(
		`<path d="M5 6h14"/><path d="M12 6v13"/><path d="M9 19h6"/>`
	),
};

export const UI_ICONS = {
	cursor: svg(`<path d="M5 3l6.5 17 2.5-6.5L20.5 11 5 3z"/>`),
	magnet: svg(
		`<path d="M6 4v7a6 6 0 0 0 12 0V4"/><line x1="6" y1="8" x2="10" y2="8"/><line x1="14" y1="8" x2="18" y2="8"/>`
	),
	stayDrawing: svg(
		`<path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/>`
	),
	eyeOpen: svg(
		`<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>`
	),
	eyeClosed: svg(
		`<path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-6.5 0-10-7-10-7a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>`
	),
	undo: svg(`<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>`),
	redo: svg(`<polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/>`),
	exportJson: svg(
		`<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>`
	),
	importJson: svg(
		`<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>`
	),
	trash: svg(
		`<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>`,
		17
	),
	grip: svg(
		`<circle cx="9" cy="6" r="1.2" fill="currentColor"/><circle cx="15" cy="6" r="1.2" fill="currentColor"/><circle cx="9" cy="12" r="1.2" fill="currentColor"/><circle cx="15" cy="12" r="1.2" fill="currentColor"/><circle cx="9" cy="18" r="1.2" fill="currentColor"/><circle cx="15" cy="18" r="1.2" fill="currentColor"/>`,
		16
	),
	lock: svg(
		`<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>`,
		16
	),
	unlock: svg(
		`<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.4-2"/>`,
		16
	),
	extendLeft: svg(`<polyline points="9 8 4 12 9 16"/><line x1="4" y1="12" x2="20" y2="12"/>`, 16),
	extendRight: svg(`<polyline points="15 8 20 12 15 16"/><line x1="4" y1="12" x2="20" y2="12"/>`, 16),
	midline: svg(`<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12" stroke-dasharray="3 2"/><line x1="3" y1="18" x2="21" y2="18"/>`, 16),
	editText: svg(`<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>`, 15),
};
