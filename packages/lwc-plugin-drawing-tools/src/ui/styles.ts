const STYLE_ELEMENT_ID = 'lwc-drawing-tools-styles';

const CSS = `
.lwc-dt-theme-dark {
	--lwc-dt-bg: #1e222d;
	--lwc-dt-surface: #252a37;
	--lwc-dt-border: #2a2e39;
	--lwc-dt-border-strong: #363a45;
	--lwc-dt-text: #d1d4dc;
	--lwc-dt-text-muted: #787b86;
	--lwc-dt-hover: #2a2e39;
	--lwc-dt-active-bg: rgba(41, 98, 255, 0.2);
	--lwc-dt-active-color: #2962ff;
	--lwc-dt-danger: #f23645;
	--lwc-dt-shadow: 0 8px 24px rgba(0, 0, 0, 0.42);
}

.lwc-dt-theme-light {
	--lwc-dt-bg: #ffffff;
	--lwc-dt-surface: #f8f9fd;
	--lwc-dt-border: #e0e3eb;
	--lwc-dt-border-strong: #d1d4dc;
	--lwc-dt-text: #131722;
	--lwc-dt-text-muted: #787b86;
	--lwc-dt-hover: #f0f3fa;
	--lwc-dt-active-bg: rgba(41, 98, 255, 0.14);
	--lwc-dt-active-color: #2962ff;
	--lwc-dt-danger: #f23645;
	--lwc-dt-shadow: 0 8px 24px rgba(19, 23, 34, 0.14);
}

.lwc-dt-toolbar {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 2px;
	width: 48px;
	padding: 6px 4px;
	background: var(--lwc-dt-bg);
	border-right: 1px solid var(--lwc-dt-border);
	color: var(--lwc-dt-text);
	user-select: none;
	box-sizing: border-box;
	overflow-y: auto;
	flex-shrink: 0;
	font-family: -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif;
}

.lwc-dt-toolbar-sep {
	width: 28px;
	height: 1px;
	background: var(--lwc-dt-border);
	margin: 4px 0;
	flex-shrink: 0;
}

.lwc-dt-btn {
	position: relative;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 36px;
	height: 34px;
	padding: 0;
	border: none;
	border-radius: 6px;
	background: transparent;
	color: var(--lwc-dt-text);
	cursor: pointer;
	transition: background 0.12s ease, color 0.12s ease;
	flex-shrink: 0;
}

.lwc-dt-btn:hover:not(:disabled) {
	background: var(--lwc-dt-hover);
}

.lwc-dt-btn.is-active {
	background: var(--lwc-dt-active-bg);
	color: var(--lwc-dt-active-color);
}

.lwc-dt-btn.is-danger:hover:not(:disabled) {
	color: var(--lwc-dt-danger);
}

.lwc-dt-btn:disabled {
	opacity: 0.35;
	cursor: not-allowed;
}

.lwc-dt-btn-badge {
	position: absolute;
	right: 3px;
	bottom: 2px;
	font-size: 8px;
	font-weight: 700;
	line-height: 1;
	padding: 1px 2px;
	border-radius: 3px;
	background: var(--lwc-dt-active-color);
	color: #fff;
}

.lwc-dt-propbar {
	position: absolute;
	top: 12px;
	left: 50%;
	transform: translateX(-50%);
	z-index: 30;
	display: none;
	align-items: center;
	gap: 4px;
	padding: 4px 8px 4px 4px;
	border-radius: 8px;
	background: var(--lwc-dt-bg);
	border: 1px solid var(--lwc-dt-border-strong);
	box-shadow: var(--lwc-dt-shadow);
	color: var(--lwc-dt-text);
	user-select: none;
	font-family: -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif;
	font-size: 12px;
}

.lwc-dt-propbar.is-visible {
	display: inline-flex;
}

.lwc-dt-grip {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 18px;
	height: 28px;
	color: var(--lwc-dt-text-muted);
	cursor: grab;
}

.lwc-dt-grip:active {
	cursor: grabbing;
}

.lwc-dt-prop-sep {
	width: 1px;
	height: 20px;
	background: var(--lwc-dt-border);
	margin: 0 2px;
}

.lwc-dt-prop-btn {
	position: relative;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 4px;
	height: 28px;
	min-width: 28px;
	padding: 0 6px;
	border: none;
	border-radius: 5px;
	background: transparent;
	color: var(--lwc-dt-text);
	cursor: pointer;
	font-size: 12px;
	font-family: inherit;
	transition: background 0.12s ease, color 0.12s ease;
}

.lwc-dt-prop-btn:hover {
	background: var(--lwc-dt-hover);
}

.lwc-dt-prop-btn.is-active {
	background: var(--lwc-dt-active-bg);
	color: var(--lwc-dt-active-color);
}

.lwc-dt-prop-btn.is-danger:hover {
	color: var(--lwc-dt-danger);
}

.lwc-dt-swatch {
	width: 16px;
	height: 16px;
	border-radius: 4px;
	border: 1px solid var(--lwc-dt-border-strong);
	display: inline-block;
	box-sizing: border-box;
}

.lwc-dt-popover {
	position: absolute;
	top: calc(100% + 8px);
	left: 0;
	z-index: 40;
	min-width: 188px;
	padding: 10px;
	border-radius: 8px;
	background: var(--lwc-dt-bg);
	border: 1px solid var(--lwc-dt-border-strong);
	box-shadow: var(--lwc-dt-shadow);
	color: var(--lwc-dt-text);
}

.lwc-dt-palette {
	display: grid;
	grid-template-columns: repeat(6, 22px);
	gap: 6px;
	margin-bottom: 8px;
}

.lwc-dt-palette-dot {
	width: 22px;
	height: 22px;
	border-radius: 5px;
	border: 1px solid rgba(128, 128, 128, 0.35);
	cursor: pointer;
	padding: 0;
}

.lwc-dt-palette-dot.is-selected {
	outline: 2px solid var(--lwc-dt-active-color);
	outline-offset: 1px;
}

.lwc-dt-popover-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	margin-top: 6px;
	font-size: 11px;
	color: var(--lwc-dt-text-muted);
}

.lwc-dt-popover-row input[type="color"] {
	width: 28px;
	height: 22px;
	border: none;
	background: transparent;
	padding: 0;
	cursor: pointer;
}

.lwc-dt-popover-row input[type="range"] {
	flex: 1;
	accent-color: var(--lwc-dt-active-color);
}

.lwc-dt-menu {
	display: flex;
	flex-direction: column;
	gap: 2px;
	min-width: 112px;
}

.lwc-dt-menu-item {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	padding: 6px 8px;
	border: none;
	border-radius: 5px;
	background: transparent;
	color: var(--lwc-dt-text);
	cursor: pointer;
	font-size: 12px;
	font-family: inherit;
	text-align: left;
}

.lwc-dt-menu-item:hover {
	background: var(--lwc-dt-hover);
}

.lwc-dt-menu-item.is-selected {
	background: var(--lwc-dt-active-bg);
	color: var(--lwc-dt-active-color);
}

.lwc-dt-text-editor {
	position: absolute;
	z-index: 50;
	min-width: 220px;
	padding: 10px;
	border-radius: 8px;
	background: var(--lwc-dt-bg);
	border: 1px solid var(--lwc-dt-border-strong);
	box-shadow: var(--lwc-dt-shadow);
	color: var(--lwc-dt-text);
	font-family: -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif;
}

.lwc-dt-text-editor textarea {
	width: 100%;
	min-height: 64px;
	padding: 6px 8px;
	box-sizing: border-box;
	border-radius: 5px;
	border: 1px solid var(--lwc-dt-border-strong);
	background: var(--lwc-dt-surface);
	color: var(--lwc-dt-text);
	font-family: inherit;
	font-size: 13px;
	resize: vertical;
	outline: none;
}

.lwc-dt-text-editor textarea:focus {
	border-color: var(--lwc-dt-active-color);
}

.lwc-dt-text-editor-actions {
	display: flex;
	justify-content: flex-end;
	gap: 6px;
	margin-top: 8px;
}

.lwc-dt-action-btn {
	padding: 4px 10px;
	border-radius: 5px;
	border: 1px solid var(--lwc-dt-border-strong);
	background: transparent;
	color: var(--lwc-dt-text);
	font-size: 12px;
	cursor: pointer;
}

.lwc-dt-action-btn.is-primary {
	background: var(--lwc-dt-active-color);
	border-color: var(--lwc-dt-active-color);
	color: #ffffff;
}
`;

export function injectDrawingToolsStyles(): void {
	if (typeof document === 'undefined') return;
	if (document.getElementById(STYLE_ELEMENT_ID)) return;
	const style = document.createElement('style');
	style.id = STYLE_ELEMENT_ID;
	style.textContent = CSS;
	document.head.appendChild(style);
}
