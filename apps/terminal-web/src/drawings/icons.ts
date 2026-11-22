import type { DrawingToolType } from '@tradingview/lwc-plugin-drawing-tools';
import { element } from '../ui';

const TREND_LINE_PATH = '<path d="M8.41 19.59L19.59 8.41"/><circle cx="7" cy="21" r="2"/><circle cx="21" cy="7" r="2"/>';

const controlPaths = {
	cross: '<path d="M14 4v7m0 6v7M4 14h7m6 0h7"/><circle cx="14" cy="14" r="1" fill="currentColor" stroke="none"/>',
	cursor: '<path d="M8.5 5l11.5 7-5.2 1.4-2.5 5.1L8.5 5Z" fill="currentColor" fill-opacity=".14"/><path d="M8.5 5l11.5 7-5.2 1.4-2.5 5.1L8.5 5Z"/>',
	chevron: '<path d="M11.5 9.5L16 14l-4.5 4.5"/>',
	line: TREND_LINE_PATH,
	pencil: '<path d="M18.2 5.2a1.7 1.7 0 0 1 2.4 2.4l-10.8 10.8-4.2 1.1 1.1-4.2L18.2 5.2Z"/><path d="M16.1 7.3l2.4 2.4M7.2 14.8l2 2"/>',
	fill: '<path d="M9.5 6.5l8 8-5.8 5.8a1.5 1.5 0 0 1-2.1 0L4.8 15.5a1.5 1.5 0 0 1 0-2.1l4.7-6.9Z" fill="currentColor" fill-opacity=".14"/><path d="M9.5 6.5l8 8-5.8 5.8a1.5 1.5 0 0 1-2.1 0L4.8 15.5a1.5 1.5 0 0 1 0-2.1l4.7-6.9Z"/><path d="M7.5 4.5l4 4M4.8 13.8h10.8"/><path d="M21 15.5c0 0 2 2.2 2 3.5a2 2 0 0 1-4 0c0-1.3 2-3.5 2-3.5Z" fill="currentColor" fill-opacity=".22"/><path d="M21 15.5c0 0 2 2.2 2 3.5a2 2 0 0 1-4 0c0-1.3 2-3.5 2-3.5Z"/>',
	settings: '<path d="M12.46 4.26h3.08l.53 2.17c.64.17 1.26.42 1.82.76l1.9-1.16 2.18 2.18-1.16 1.9c.34.56.59 1.18.76 1.82l2.17.53v3.08l-2.17.53c-.17.64-.42 1.26-.76 1.82l1.16 1.9-2.18 2.18-1.9-1.16c-.56.34-1.18.59-1.82.76l-.53 2.17h-3.08l-.53-2.17c-.64-.17-1.26-.42-1.82-.76l-1.9 1.16-2.18-2.18 1.16-1.9c-.34-.56-.59-1.18-.76-1.82l-2.17-.53v-3.08l2.17-.53c.17-.64.42-1.26.76-1.82l-1.16-1.9 2.18-2.18 1.9 1.16c.56-.34 1.18-.59 1.82-.76l.53-2.17Z"/><circle cx="14" cy="14" r="3.15"/>',
	ruler: '<path d="M19 4.5L23.5 9 9 23.5 4.5 19Z"/><path d="M15.75 7.75l2.25 2.25M12.25 11.25l2.25 2.25M8.75 14.75l2.25 2.25"/>',
	zoom: '<circle cx="12.25" cy="12.25" r="6.75"/><path d="M17.02 17.02L22.5 22.5M9.5 12.25h5.5M12.25 9.5v5.5"/>',
	stay: '<path d="M18.2 5.2a1.7 1.7 0 0 1 2.4 2.4l-10 10-3.8 1 1-3.8 10.4-9.6Z"/><path d="M16 7.4l2.4 2.4"/><rect x="4.5" y="6.25" width="5.5" height="4.25" rx=".9"/><path d="M5.75 6.25V5a1.5 1.5 0 0 1 3 0v1.25"/>',
	magnet: '<path d="M8 5v9a6 6 0 0 0 12 0V5h-3.25v9a2.75 2.75 0 0 1-5.5 0V5H8Z"/><path d="M8 8.75h3.25M16.75 8.75H20"/>',
	lock: '<rect x="7" y="12.5" width="14" height="10" rx="2"/><path d="M10.25 12.5V9.5a3.75 3.75 0 0 1 7.5 0v3"/><circle cx="14" cy="17.5" r="1.1" fill="currentColor" stroke="none"/>',
	unlock: '<rect x="7" y="12.5" width="14" height="10" rx="2"/><path d="M10.25 12.5V9.5a3.75 3.75 0 0 1 7.1-1.7"/><circle cx="14" cy="17.5" r="1.1" fill="currentColor" stroke="none"/>',
	eye: '<path d="M4 14s3.8-6.5 10-6.5S24 14 24 14s-3.8 6.5-10 6.5S4 14 4 14Z"/><circle cx="14" cy="14" r="3"/>',
	eyeOff: '<path d="M11.8 7.75A10.2 10.2 0 0 1 14 7.5c6.2 0 10 6.5 10 6.5a17 17 0 0 1-2.85 3.65M7.5 9.4A16.6 16.6 0 0 0 4 14s3.8 6.5 10 6.5c2 0 3.75-.55 5.2-1.4"/><path d="M11.88 11.88a3 3 0 0 0 4.24 4.24"/><path d="M5 5l18 18"/>',
	trash: '<path d="M5.5 8h17M10.5 8V5.75a1.25 1.25 0 0 1 1.25-1.25h4.5a1.25 1.25 0 0 1 1.25 1.25V8M7.5 8l1.1 13.75A1.5 1.5 0 0 0 10.1 23h7.8a1.5 1.5 0 0 0 1.5-1.25L20.5 8M11.75 12v7M16.25 12v7"/>',
};
export type DrawingIconName = keyof typeof controlPaths;

const toolPaths: Record<DrawingToolType, string> = {
	'trend-line': TREND_LINE_PATH,
	ray: '<path d="M7.91 20.09L13.09 14.91M15.91 12.09L23 5"/><circle cx="6.5" cy="21.5" r="2"/><circle cx="14.5" cy="13.5" r="2"/>',
	'info-line': '<path d="M7.91 20.09L19.59 8.41"/><circle cx="6.5" cy="21.5" r="2"/><circle cx="21" cy="7" r="2"/><rect x="4.5" y="4.5" width="9" height="6.5" rx="1.2" fill="currentColor" fill-opacity=".12"/><rect x="4.5" y="4.5" width="9" height="6.5" rx="1.2"/><path d="M6.75 7h4.5M6.75 9h3"/>',
	'extended-line': '<path d="M4.5 23.5L8.19 19.81M10.81 17.19L17.19 10.81M19.81 8.19L23.5 4.5"/><circle cx="9.5" cy="18.5" r="1.85"/><circle cx="18.5" cy="9.5" r="1.85"/>',
	'trend-angle': '<path d="M8.5 21H23M7.91 19.59L17.59 9.91M20.41 7.09L23 4.5"/><path d="M13.5 21a7 7 0 0 0-2.05-4.95"/><circle cx="6.5" cy="21" r="2"/><circle cx="19" cy="8.5" r="2"/>',
	'horizontal-line': '<path d="M3.5 14H12M16 14h8.5"/><circle cx="14" cy="14" r="2"/>',
	'horizontal-ray': '<path d="M8.5 14h16"/><circle cx="6.5" cy="14" r="2"/>',
	'vertical-line': '<path d="M14 3.5V12M14 16v8.5"/><circle cx="14" cy="14" r="2"/>',
	'cross-line': '<path d="M14 3.5V12M14 16v8.5M3.5 14H12M16 14h8.5"/><circle cx="14" cy="14" r="2"/>',
	'parallel-channel': '<path d="M4.5 15.5L19.5 6.5l4 5.5-15 9Z" fill="currentColor" fill-opacity=".12" stroke="none"/><path d="M6 14.6L18 7.4M21 5.6L23.5 4.1M5.5 22.8L7 21.9M10 20.1L23.5 12"/><path d="M6.5 18.25L21.5 9.25" stroke-dasharray="2 2"/><circle cx="4.5" cy="15.5" r="1.75"/><circle cx="19.5" cy="6.5" r="1.75"/><circle cx="8.5" cy="21" r="1.75"/>',
	'regression-channel': '<path d="M4 15L20.5 5l3.5 5.5-16.5 10Z" fill="currentColor" fill-opacity=".10" stroke="none"/><path d="M4 15L20.5 5M7.5 20.5L24 10.5"/><path d="M5.5 17.5l3-2.5 2 2 3-4.5 2 2 3.5-5 2 1.5 2.5-3.5"/><path d="M5.75 17.75l16.5-10" stroke-dasharray="1.8 1.8"/>',
	'flat-channel': '<path d="M5 7.5H22l1.5 6.5L5 21Z" fill="currentColor" fill-opacity=".11" stroke="none"/><path d="M6.75 7.5H20.25M6.64 20.38L23.5 14"/><path d="M5 14.25L23.5 10.75" stroke-dasharray="2 2"/><circle cx="5" cy="7.5" r="1.75"/><circle cx="22" cy="7.5" r="1.75"/><circle cx="5" cy="21" r="1.75"/>',
	'disjoint-channel': '<path d="M5.5 11.5L22.5 6v16l-17-4.5Z" fill="currentColor" fill-opacity=".11" stroke="none"/><path d="M6.16 11.29L20.84 6.54M6.19 17.68L20.81 21.55"/><circle cx="4.5" cy="11.83" r="1.75"/><circle cx="22.5" cy="6" r="1.75"/><circle cx="4.5" cy="17.23" r="1.75"/><circle cx="22.5" cy="22" r="1.75"/>',
	pitchfork: '<path d="M6.12 20.38L23 6.5M10.75 10.5L20 3M17.25 18L24 12.45"/><path d="M11.6 11.4L15.1 15.6" stroke-dasharray="1.8 1.8"/><circle cx="4.8" cy="21.5" r="1.75"/><circle cx="10.5" cy="10" r="1.75"/><circle cx="16.2" cy="17" r="1.75"/>',
	'schiff-pitchfork': '<path d="M6.4 13.75L23.5 7.2M12.2 8.7L22.5 4.8M17.9 16.5L24 14.2"/><path d="M5 16.5V21" stroke-dasharray="1.6 1.8"/><path d="M11.5 9.8l4.5 5.4" stroke-dasharray="1.6 1.8"/><circle cx="5" cy="14.3" r="1.75"/><circle cx="10.7" cy="9.2" r="1.75"/><circle cx="16.5" cy="16.2" r="1.75"/>',
	'modified-schiff': '<path d="M10 14.4L23.5 6.8M13.5 9L22.5 3.9M18.6 16.6L24 13.5"/><path d="M5 21.5L10.7 10.7M5 21.5h4" stroke-dasharray="1.5 1.8"/><circle cx="8.5" cy="15.25" r="1.75"/><circle cx="12" cy="9.8" r="1.75"/><circle cx="17.2" cy="17.4" r="1.75"/>',
	'inside-pitchfork': '<path d="M9.6 19.3L22.5 5M7.2 12.1L16.5 3.5M16.1 17.8L23.5 11.2"/><path d="M7.5 13.5l6.8 3.6" stroke-dasharray="1.6 1.8"/><circle cx="8.5" cy="20.5" r="1.75"/><circle cx="6.2" cy="13" r="1.75"/><circle cx="15" cy="18.6" r="1.75"/>',
	'fib-retracement': '<rect x="4.5" y="11" width="19" height="5.5" fill="currentColor" fill-opacity=".12" stroke="none"/><path d="M4.5 5.5H18.75M22.25 5.5H23.5M4.5 11h19M4.5 16.5h19M4.5 22h1.25M9.25 22H23.5"/><path d="M8.58 20.63L19.42 6.87" stroke-dasharray="2 2"/><circle cx="7.5" cy="22" r="1.75"/><circle cx="20.5" cy="5.5" r="1.75"/>',
	'fib-extension': '<path d="M12.5 5.5h11M14 9.5h9.5M16.5 14h7"/><path d="M5.75 20.3L9.35 12.7M10.9 12.4l2.7 3.7"/><circle cx="5" cy="21.8" r="1.75"/><circle cx="10.1" cy="11.1" r="1.75"/><circle cx="14.5" cy="17.3" r="1.75"/>',
	'fib-channel': '<path d="M4.5 15.2L17.5 5.2l5 6.5-13 10Z" fill="currentColor" fill-opacity=".11" stroke="none"/><path d="M5.85 14.16L17.5 5.2M6 18.5L20 7.7M8 21.8L22 11M11.5 23.5L23.5 14.2"/><circle cx="4.5" cy="15.2" r="1.75"/><circle cx="18.8" cy="13.5" r="1.75"/>',
	'fib-time-zone': '<rect x="10.5" y="4.5" width="4.5" height="19" fill="currentColor" fill-opacity=".12" stroke="none"/><path d="M5 4.5v15.75M7.5 4.5v15.75M10.5 4.5v19M15 4.5v19M22 4.5v19"/><circle cx="5" cy="22" r="1.75"/><circle cx="7.5" cy="22" r="1.75"/>',
	'fib-fan': '<path d="M6.4 20.6L13.7 13.3"/><path d="M6.7 21L10.5 4.5M6.7 21L17 4.5M6.7 21L23.5 8.5M6.7 21l17-4.5"/><circle cx="5.2" cy="21.8" r="1.75"/><circle cx="14.9" cy="12.1" r="1.75"/>',
	'trend-fib-time': '<path d="M5.5 18.6L8.8 14.2M10.8 14.2l2.1 2.4" /><path d="M16 5v18M19 5v18M23.5 5v18"/><circle cx="4.5" cy="20" r="1.75"/><circle cx="9.8" cy="12.9" r="1.75"/><circle cx="14" cy="17.8" r="1.75"/>',
	'fib-circles': '<circle cx="12" cy="16" r="2.7"/><circle cx="12" cy="16" r="5.7"/><circle cx="12" cy="16" r="9.2"/><path d="M13.2 14.7L16.3 11.3"/><circle cx="12" cy="16" r="1.6"/><circle cx="17.5" cy="10" r="1.6"/>',
	'fib-spiral': '<path d="M11.6 15.1A1 1 0 0 1 12.6 14.1A1.6 1.6 0 0 1 14.2 15.7A2.6 2.6 0 0 1 11.6 18.3A4.2 4.2 0 0 1 7.4 14.1A6.8 6.8 0 0 1 14.2 7.3A10 10 0 0 1 24 17.3"/><circle cx="10.8" cy="15.8" r="1.4"/>',
	'fib-arcs': '<path d="M6.8 19.6L16.2 10.2"/><path d="M6 15a5.5 5.5 0 0 1 5.5 5.5M6 10.5a10 10 0 0 1 10 10M6 5.5a15 15 0 0 1 15 15"/><circle cx="5.5" cy="20.8" r="1.75"/><circle cx="17.4" cy="9" r="1.75"/>',
	'fib-wedge': '<path d="M5.5 21.5L11.5 5M5.5 21.5l18-5"/><path d="M8.5 14a7 7 0 0 1 4.2 5.4M10 9.5a12.5 12.5 0 0 1 8.5 8.5"/><circle cx="5.5" cy="21.5" r="1.75"/><circle cx="11.5" cy="5" r="1.75"/><circle cx="23.5" cy="16.5" r="1.75"/>',
	pitchfan: '<path d="M6.2 20.3L22.5 6M6.2 20.3L14.5 4M6.2 20.3L23.5 11.5M6.2 20.3L23.5 17"/><path d="M10.5 9.5l5.5 8" stroke-dasharray="1.8 1.8"/><circle cx="5" cy="21.5" r="1.75"/><circle cx="10.5" cy="9.5" r="1.75"/><circle cx="16" cy="17.5" r="1.75"/>',
	'gann-box': '<rect x="5" y="5" width="18" height="18" fill="currentColor" fill-opacity=".1" stroke="none"/><path d="M6.75 5H23v16.25M21.25 23H5V6.75"/><path d="M5 11h18M5 17h18M11 5v18M17 5v18M6.24 6.24L21.76 21.76M5 23L23 5" opacity=".75"/><circle cx="5" cy="5" r="1.75"/><circle cx="23" cy="23" r="1.75"/>',
	'gann-square-fixed': '<rect x="5" y="5" width="18" height="18"/><polygon points="14,5 23,14 14,23 5,14" fill="currentColor" fill-opacity=".12"/><rect x="9.5" y="9.5" width="9" height="9"/><path d="M5 5l18 18M5 23L23 5" opacity=".65"/>',
	'gann-square': '<rect x="5" y="5" width="18" height="18"/><path d="M5 23A18 18 0 0 1 23 5"/><path d="M5 23L13 5M5 23L23 5M5 23l18-8"/><circle cx="5" cy="23" r="1.75"/><circle cx="23" cy="5" r="1.75"/>',
	'gann-fan': '<path d="M5 4.5v16.75M6.75 23H23.5"/><path d="M6.3 21.5L11.5 5M6.5 21.7L17.5 5M6.24 21.76L16.26 11.74M18.74 9.26L23 5M6.8 22L23.5 11M6.9 22.4L23.5 16.5"/><circle cx="5" cy="23" r="1.75"/><circle cx="17.5" cy="10.5" r="1.75"/>',
	xabcd: '<polygon points="4.5,20 9.5,6.5 14,15" fill="currentColor" fill-opacity=".14" stroke="none"/><polygon points="14,15 18.5,8.5 23.5,21" fill="currentColor" fill-opacity=".14" stroke="none"/><path d="M4.5 20L9.5 6.5 14 15l4.5-6.5L23.5 21"/><path d="M4.5 20L14 15M9.5 6.5L18.5 8.5M14 15l9.5 6" stroke-dasharray="1.6 1.8"/><circle cx="4.5" cy="20" r="1.5"/><circle cx="9.5" cy="6.5" r="1.5"/><circle cx="18.5" cy="8.5" r="1.5"/><circle cx="23.5" cy="21" r="1.5"/>',
	cypher: '<polygon points="4.5,20.5 9,10 13.5,16.5" fill="currentColor" fill-opacity=".14" stroke="none"/><polygon points="13.5,16.5 18,5 23.5,15" fill="currentColor" fill-opacity=".14" stroke="none"/><path d="M4.5 20.5L9 10l4.5 6.5L18 5l5.5 10"/><path d="M9 10L18 5M4.5 20.5L13.5 16.5l10-1.5" stroke-dasharray="1.6 1.8"/><circle cx="18" cy="5" r="1.5"/><circle cx="23.5" cy="15" r="1.5"/>',
	'head-shoulders': '<path d="M7.5 18.5V12l2.75 5.5 3.75-11 3.75 11 2.75-5.5v6.5Z" fill="currentColor" fill-opacity=".12" stroke="none"/><path d="M4 18.5h20" stroke-dasharray="2 2"/><path d="M4.5 21L7.5 12l2.75 5.5L14 6.5l3.75 11 2.75-5.5 3 9"/><circle cx="7.5" cy="12" r="1.4"/><circle cx="14" cy="6.5" r="1.4"/><circle cx="20.5" cy="12" r="1.4"/>',
	abcd: '<path d="M5.75 19L10.75 8M12.25 8.1l3.5 7.4M17.25 15.6L22.25 6"/><path d="M5 20.5l11.5-3.5M11.5 6.5l11.5-2" stroke-dasharray="1.6 1.8"/><circle cx="5" cy="20.5" r="1.6"/><circle cx="11.5" cy="6.5" r="1.6"/><circle cx="16.5" cy="17" r="1.6"/><circle cx="23" cy="4.5" r="1.6"/>',
	'triangle-pattern': '<polygon points="5,6 23,13.5 9.5,21.5" fill="currentColor" fill-opacity=".11" stroke="none"/><path d="M5 6l18 7.5M9.5 21.5L23 13.5" stroke-dasharray="1.6 1.8"/><path d="M5 6l4.5 15.5 4.5-12 4.5 8 4.5-4"/><circle cx="5" cy="6" r="1.4"/><circle cx="9.5" cy="21.5" r="1.4"/><circle cx="23" cy="13.5" r="1.4"/>',
	'three-drives': '<path d="M4.5 21.5L8 12.5l3 5.5 3.5-8.5 3 5.5 3.5-8.5 2.5 5"/><path d="M8 12.5Q11.2 8.5 14.5 9.5M14.5 9.5Q17.8 5.5 21 6.5" stroke-dasharray="1.5 1.8"/><circle cx="8" cy="12.5" r="1.4"/><circle cx="14.5" cy="9.5" r="1.4"/><circle cx="21" cy="6.5" r="1.4"/>',
	'elliott-impulse': '<path d="M4.5 21L7.9 13.4M9.1 13.3l1.7 2.9M12.2 16.1l3.6-8.2M17.1 7.9l1.7 3.7M20.2 11.5l2.7-5.1"/><path d="M4.5 21L19.5 13" stroke-dasharray="1.6 1.8" opacity=".45"/><circle cx="8.5" cy="12" r="1.4"/><circle cx="11.5" cy="17.5" r="1.4"/><circle cx="16.5" cy="6.5" r="1.4"/><circle cx="19.5" cy="13" r="1.4"/><circle cx="23.5" cy="5" r="1.4"/>',
	'elliott-correction': '<path d="M4.5 7.5l5.5 12 6.5-8.5 6 11"/><path d="M4.5 7.5L22.5 22" stroke-dasharray="1.8 1.8" opacity=".45"/><circle cx="10" cy="19.5" r="1.5"/><circle cx="16.5" cy="11" r="1.5"/><circle cx="22.5" cy="22" r="1.5"/>',
	'elliott-triangle': '<path d="M4.5 6l19 6.5M4.5 21.5l19-6.5" stroke-dasharray="1.6 1.8"/><path d="M5.5 7.2l3.5 12.2 4-10.2 3.5 8.2 3.5-6 3 2.5"/><circle cx="9" cy="19.4" r="1.3"/><circle cx="13" cy="9.2" r="1.3"/><circle cx="20" cy="11.4" r="1.3"/>',
	'elliott-double': '<path d="M4 18.5l2.5-6 2 3 2.5-6.5 2.5 7.5 2.5-9 2.5 4.5 2.5-6 3 6.5"/><circle cx="11" cy="9" r="1.4"/><circle cx="13.5" cy="16.5" r="1.4"/><circle cx="21" cy="6" r="1.4"/>',
	'elliott-triple': '<path d="M3.5 19l2-7 2 4 2-8 2.5 9 2-6 2 4 2-8 2 9 2-7 2 5"/><circle cx="9.5" cy="8" r="1.3"/><circle cx="17.5" cy="7" r="1.3"/><circle cx="23.5" cy="16" r="1.3"/>',
	'cycle-lines': '<path d="M5.5 4.5v15.75M11.5 4.5v15.75M17.5 4.5v19M23 4.5v19"/><path d="M7.25 22H9.75"/><circle cx="5.5" cy="22" r="1.75"/><circle cx="11.5" cy="22" r="1.75"/>',
	'time-cycles': '<path d="M4.5 20.5a4.75 4.75 0 0 1 9.5 0M14 20.5a4.75 4.75 0 0 1 9.5 0"/><path d="M4.5 20.5v-14M14 20.5v-14M23.5 20.5v-14" stroke-dasharray="1.8 1.8" opacity=".55"/><circle cx="4.5" cy="20.5" r="1.6"/><circle cx="14" cy="20.5" r="1.6"/>',
	'sine-line': '<path d="M4 14h20" stroke-dasharray="1.8 1.8" opacity=".5"/><path d="M4.5 14C7.5 4.5 11 4.5 14 14s6.5 9.5 9.5 0"/><circle cx="4.5" cy="14" r="1.6"/><circle cx="14" cy="14" r="1.6"/>',
	'long-position': '<rect x="5" y="5" width="18" height="10" fill="currentColor" fill-opacity=".18" stroke="none"/><rect x="5" y="15" width="18" height="7" fill="currentColor" fill-opacity=".07" stroke="none"/><rect x="5" y="5" width="18" height="17" rx="1"/><path d="M5 15h18M14 15V8.5m-2.5 2.5L14 8.5l2.5 2.5"/><circle cx="5" cy="15" r="1.5"/>',
	'short-position': '<rect x="5" y="6" width="18" height="7" fill="currentColor" fill-opacity=".07" stroke="none"/><rect x="5" y="13" width="18" height="10" fill="currentColor" fill-opacity=".18" stroke="none"/><rect x="5" y="6" width="18" height="17" rx="1"/><path d="M5 13h18M14 13v6.5m-2.5-2.5L14 19.5l2.5-2.5"/><circle cx="5" cy="13" r="1.5"/>',
	forecast: '<path d="M5 20.5L11.5 13.5l3.5 3 6.5-9.5"/><path d="M17.5 7h4v4"/><path d="M11.5 13.5L22 4.5M11.5 13.5L22 14" stroke-dasharray="1.8 1.8" opacity=".55"/><circle cx="5" cy="20.5" r="1.6"/><circle cx="11.5" cy="13.5" r="1.6"/>',
	'bars-pattern': '<path d="M7 5H4.5v18H7M21 5h2.5v18H21" opacity=".55"/><path d="M9.5 8v12M14 6v11M18.5 10v10"/><rect x="8" y="10.5" width="3" height="6.5" rx=".5" fill="currentColor" fill-opacity=".22"/><rect x="8" y="10.5" width="3" height="6.5" rx=".5"/><rect x="12.5" y="8.5" width="3" height="5.5" rx=".5"/><rect x="17" y="12.5" width="3" height="5" rx=".5" fill="currentColor" fill-opacity=".22"/><rect x="17" y="12.5" width="3" height="5" rx=".5"/>',
	'ghost-feed': '<path d="M6.5 22V11.5a7.5 7.5 0 0 1 15 0V22l-2.5-2-2.5 2-2.5-2-2.5 2-2.5-2L6.5 22Z" fill="currentColor" fill-opacity=".14"/><path d="M6.5 22V11.5a7.5 7.5 0 0 1 15 0V22l-2.5-2-2.5 2-2.5-2-2.5 2-2.5-2L6.5 22Z"/><circle cx="11.2" cy="11.5" r="1" fill="currentColor" stroke="none"/><circle cx="16.8" cy="11.5" r="1" fill="currentColor" stroke="none"/>',
	projection: '<path d="M5 19.5l8-11 7 11Z" fill="currentColor" fill-opacity=".11" stroke="none"/><path d="M5 19.5l8-11 9.5 7.5"/><path d="M22.5 16A11.5 11.5 0 0 1 6.5 20.5" stroke-dasharray="2 2"/><circle cx="5" cy="19.5" r="1.6"/><circle cx="13" cy="8.5" r="1.6"/><circle cx="22.5" cy="16" r="1.6"/>',
	'anchored-vwap': '<path d="M6 5v7M6 16v7" opacity=".55"/><path d="M7.6 13.2C11.5 10.5 15 16 23 7"/><path d="M7.6 9.5C12 7 15.5 11.5 23 4.5M7.6 17C11.5 14.5 15 20.5 23 11.5" stroke-dasharray="1.8 1.8" opacity=".6"/><circle cx="6" cy="14" r="2"/>',
	'fixed-volume-profile': '<path d="M6 5v18M22 5v18"/><rect x="6" y="7" width="7" height="2.6" fill="currentColor" fill-opacity=".2"/><rect x="6" y="11" width="12.5" height="2.6" fill="currentColor" fill-opacity=".35"/><rect x="6" y="15" width="9.5" height="2.6" fill="currentColor" fill-opacity=".2"/><rect x="6" y="19" width="5" height="2.6" fill="currentColor" fill-opacity=".2"/><circle cx="6" cy="23" r="1.5"/><circle cx="22" cy="5" r="1.5"/>',
	'anchored-volume-profile': '<path d="M6.5 4.5v7.5M6.5 16v7.5"/><rect x="9" y="6.5" width="7.5" height="2.8" rx=".4" fill="currentColor" fill-opacity=".18"/><rect x="9" y="6.5" width="7.5" height="2.8" rx=".4"/><rect x="9" y="11" width="13.5" height="2.8" rx=".4" fill="currentColor" fill-opacity=".3"/><rect x="9" y="11" width="13.5" height="2.8" rx=".4"/><rect x="9" y="15.5" width="10" height="2.8" rx=".4"/><rect x="9" y="20" width="5.5" height="2.8" rx=".4"/><circle cx="6.5" cy="14" r="2"/>',
	'price-range': '<rect x="6" y="6" width="16" height="16" fill="currentColor" fill-opacity=".12" stroke="none"/><path d="M5.5 6h17M5.5 22h17M14 7v14M11 9.5L14 6.5l3 3M11 18.5l3 3 3-3"/>',
	'date-range': '<rect x="6" y="6" width="16" height="16" fill="currentColor" fill-opacity=".12" stroke="none"/><path d="M6 5.5v17M22 5.5v17M7 14h14M9.5 11L6.5 14l3 3M18.5 11l3 3-3 3"/>',
	'price-date-range': '<rect x="5.5" y="5.5" width="17" height="17" rx="1" fill="currentColor" fill-opacity=".12" stroke="none"/><rect x="5.5" y="5.5" width="17" height="17" rx="1" stroke-dasharray="2.5 2"/><path d="M14 20V8M11.5 10.5L14 8l2.5 2.5M8 14h12M17.5 11.5L20 14l-2.5 2.5"/>',
	brush: '<path d="M19.2 4.8a1.7 1.7 0 0 1 2.4 2.4l-9.4 9.4-3.3.9.9-3.3 9.4-9.4Z"/><path d="M16.8 7.2l2.4 2.4"/><path d="M8.5 17.5c-2.2 0-3.8 1.5-3.8 3.5 2.3.3 4.2-.8 4.6-2.8"/><path d="M12.5 22c3.5 0 6-1.8 9.5-1.2" stroke-dasharray="1.5 1.8" opacity=".6"/>',
	highlighter: '<rect x="4" y="20" width="16" height="3" rx="1" fill="currentColor" fill-opacity=".28" stroke="none"/><path d="M17.5 4.5l5 5-9.5 9.5-5-5 9.5-9.5Z"/><path d="M8 14l-2.5 4.5h4.5L13 19M5 21.5h15"/>',
	arrow: '<path d="M7.91 20.09L21.5 6.5M15 6.5h6.5V13"/><circle cx="6.5" cy="21.5" r="2"/>',
	'double-arrow': '<path d="M6 22L22 6M15.5 6H22v6.5M12.5 22H6v-6.5"/><circle cx="14" cy="14" r="1.75" fill="currentColor" stroke="none"/>',
	'arrow-path': '<path d="M5.75 19.6l3.9-9.1M11 10.4l4.1 6.2M17 16.4L22.5 7M17.5 7h5v5"/><circle cx="5" cy="21.2" r="1.7"/><circle cx="10.2" cy="8.9" r="1.7"/><circle cx="16.1" cy="18" r="1.7"/>',
	'arrow-up': '<path d="M14 4.5L21 12h-4.25v10.5h-5.5V12H7l7-7.5Z" fill="currentColor" fill-opacity=".18"/><path d="M14 4.5L21 12h-4.25v10.5h-5.5V12H7l7-7.5Z"/>',
	'arrow-down': '<path d="M14 23.5L7 16h4.25V5.5h5.5V16H21l-7 7.5Z" fill="currentColor" fill-opacity=".18"/><path d="M14 23.5L7 16h4.25V5.5h5.5V16H21l-7 7.5Z"/>',
	rectangle: '<rect x="5.5" y="7.5" width="17" height="13" fill="currentColor" fill-opacity=".12" stroke="none"/><path d="M7.25 7.5H22.5v11.25M20.75 20.5H5.5V9.25"/><circle cx="5.5" cy="7.5" r="1.75"/><circle cx="22.5" cy="20.5" r="1.75"/>',
	'rotated-rectangle': '<polygon points="4.5,14.5 16.5,5.5 23.5,13.5 11.5,22.5" fill="currentColor" fill-opacity=".12" stroke="none"/><path d="M5.9 13.45L15.1 6.55M17.65 6.82L22.35 12.18M22.1 14.55L11.5 22.5 5.65 15.82"/><circle cx="4.5" cy="14.5" r="1.75"/><circle cx="16.5" cy="5.5" r="1.75"/><circle cx="23.5" cy="13.5" r="1.75"/>',
	path: '<path d="M5.65 18.9L9.85 9.1M11.4 9.05l4.4 7.4M17.5 16.45L22.1 9.5"/><circle cx="5" cy="20.5" r="1.7"/><circle cx="10.5" cy="7.5" r="1.7"/><circle cx="16.6" cy="18" r="1.7"/><circle cx="23" cy="8" r="1.7"/>',
	circle: '<circle cx="14" cy="14" r="8.5" fill="currentColor" fill-opacity=".1" stroke="none"/><circle cx="14" cy="14" r="8.5"/><circle cx="14" cy="14" r="1.6"/><circle cx="20" cy="8" r="1.6"/>',
	ellipse: '<ellipse cx="14" cy="14" rx="9.5" ry="6" fill="currentColor" fill-opacity=".11" stroke="none"/><ellipse cx="14" cy="14" rx="9.5" ry="6"/><circle cx="14" cy="8" r="1.6"/><circle cx="23.5" cy="14" r="1.6"/>',
	triangle: '<polygon points="14,6 22.5,21 5.5,21" fill="currentColor" fill-opacity=".12" stroke="none"/><path d="M14.85 7.5L21.65 19.5M20.75 21H7.25M6.35 19.5L13.15 7.5"/><circle cx="14" cy="6" r="1.75"/><circle cx="22.5" cy="21" r="1.75"/><circle cx="5.5" cy="21" r="1.75"/>',
	arc: '<path d="M5.75 18.7Q14 6.5 22.25 18.7"/><circle cx="5" cy="20" r="1.65"/><circle cx="14" cy="10.8" r="1.65"/><circle cx="23" cy="20" r="1.65"/>',
	curve: '<path d="M5.3 18.8C6 9 11 6.5 20.8 6.5"/><path d="M5.3 18.8L8.5 7.5" stroke-dasharray="1.6 1.8" opacity=".5"/><circle cx="5.2" cy="20.5" r="1.7"/><circle cx="22.5" cy="6.5" r="1.7"/>',
	'double-curve': '<path d="M6.2 20.5C15.5 20.5 12.5 7.5 21.8 7.5"/><circle cx="4.5" cy="20.5" r="1.7"/><circle cx="23.5" cy="7.5" r="1.7"/>',
	text: '<path d="M7 7.5V6h14v1.5M14 6v16M10.5 22h7"/>',
	'anchored-text': '<path d="M5 9V5h4M19 5h4v4M5 19v4h4M19 23h4v-4" opacity=".6"/><path d="M9.5 10V9h9v1M14 9v10M11.5 19h5"/>',
	note: '<path d="M6 4.5h11.5L22 9v14.5H6V4.5Z" fill="currentColor" fill-opacity=".11"/><path d="M6 4.5h11.5L22 9v14.5H6V4.5Z"/><path d="M17.5 4.5V9H22M9.5 13h9M9.5 17h6.5"/>',
	'price-note': '<rect x="6.5" y="5" width="16" height="11" rx="1.5" fill="currentColor" fill-opacity=".12"/><rect x="6.5" y="5" width="16" height="11" rx="1.5"/><path d="M10 9.5h9M10 12.5h5.5M11.5 16l-4 4.5"/><circle cx="6" cy="22" r="1.75"/>',
	pin: '<path d="M9 5.5h10l-1.5 5.5 2.5 3.5H8l2.5-3.5L9 5.5Z" fill="currentColor" fill-opacity=".15"/><path d="M9 5.5h10l-1.5 5.5 2.5 3.5H8l2.5-3.5L9 5.5Z"/><path d="M14 14.5v8"/>',
	callout: '<path d="M5 5.5h18v11.5H12l-5 5v-5H5V5.5Z" fill="currentColor" fill-opacity=".11"/><path d="M5 5.5h18v11.5H12l-5 5v-5H5V5.5Z"/><path d="M9 9.5h10M9 13h6"/>',
	comment: '<path d="M4.5 7.5a2 2 0 0 1 2-2h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H11l-4.5 4.5v-4.5a2 2 0 0 1-2-2v-8Z" fill="currentColor" fill-opacity=".11"/><path d="M4.5 7.5a2 2 0 0 1 2-2h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H11l-4.5 4.5v-4.5a2 2 0 0 1-2-2v-8Z"/><circle cx="10" cy="11.5" r="1" fill="currentColor" stroke="none"/><circle cx="14" cy="11.5" r="1" fill="currentColor" stroke="none"/><circle cx="18" cy="11.5" r="1" fill="currentColor" stroke="none"/>',
	'price-label': '<path d="M4.5 14l5.2-5.5H23v11H9.7L4.5 14Z" fill="currentColor" fill-opacity=".13"/><path d="M4.5 14l5.2-5.5H23v11H9.7L4.5 14Z"/><circle cx="9.5" cy="14" r="1.25"/><path d="M13 14h6.5"/>',
	signpost: '<path d="M14 4.5v3M14 14.5v9M6.5 7.5h13l3.5 3.5-3.5 3.5h-13V7.5Z" fill="currentColor" fill-opacity=".12"/><path d="M14 4.5v3M14 14.5v9M6.5 7.5h13l3.5 3.5-3.5 3.5h-13V7.5Z"/>',
	flag: '<path d="M7.5 5.5h14l-3.25 4.25L21.5 14h-14V5.5Z" fill="currentColor" fill-opacity=".16"/><path d="M7.5 4.5v19M7.5 5.5h14l-3.25 4.25L21.5 14h-14"/>',
	emoji: '<circle cx="14" cy="14" r="9"/><path d="M10.2 16.2a4.8 4.8 0 0 0 7.6 0"/><circle cx="10.8" cy="11.4" r="1" fill="currentColor" stroke="none"/><circle cx="17.2" cy="11.4" r="1" fill="currentColor" stroke="none"/>',
};

function renderSvg(markup: string): HTMLSpanElement {
	const node = element('span', 'icon drawing-icon');
	node.setAttribute('aria-hidden', 'true');
	// Only application-owned SVG paths; labels and user text never enter this markup.
	node.innerHTML = `<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${markup}</svg>`;
	return node;
}

export function drawingIcon(name: DrawingIconName): HTMLSpanElement {
	return renderSvg(controlPaths[name]);
}

export function toolIcon(type: DrawingToolType): HTMLSpanElement {
	return renderSvg(toolPaths[type]);
}
