export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

const paths = {
	logo: '<rect x="2.75" y="10" width="3.5" height="6.5" rx=".8" fill="currentColor" fill-opacity=".18"/><rect x="2.75" y="10" width="3.5" height="6.5" rx=".8"/><rect x="8.25" y="4" width="3.5" height="12.5" rx=".8" fill="currentColor" fill-opacity=".18"/><rect x="8.25" y="4" width="3.5" height="12.5" rx=".8"/><rect x="13.75" y="7" width="3.5" height="9.5" rx=".8"/>',
	plus: '<path d="M10 4v12M4 10h12"/>',
	close: '<path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/>',
	search: '<circle cx="8.75" cy="8.75" r="5.25"/><path d="M12.5 12.5l4.25 4.25"/>',
	candles: '<path d="M6 2.75V5.5M6 12.5v4.25"/><rect x="4" y="5.5" width="4" height="7" rx=".6"/><path d="M14 4.25V7.5M14 13.5v3.75"/><rect x="12" y="7.5" width="4" height="6" rx=".6" fill="currentColor" fill-opacity=".22"/><rect x="12" y="7.5" width="4" height="6" rx=".6"/>',
	indicator: '<path d="M10.75 4.25c-.85-.6-2.1-.45-2.55.75l-1.9 9c-.35 1.25-1.5 1.55-2.3 1M5.25 9.25h4.25M11.75 9.75l4.25 5M16 9.75l-4.25 5"/>',
	clock: '<circle cx="10" cy="11" r="6"/><path d="M10 8v3l2.2 1.3M3.5 5.2L6 3.2M16.5 5.2L14 3.2"/>',
	replay: '<path d="M10 5.25L3.75 10l6.25 4.75V5.25ZM16.5 5.25L10.25 10l6.25 4.75V5.25Z" fill="currentColor" fill-opacity=".14"/><path d="M10 5.25L3.75 10l6.25 4.75V5.25ZM16.5 5.25L10.25 10l6.25 4.75V5.25Z"/>',
	undo: '<path d="M6.5 5.5L3.25 8.75 6.5 12"/><path d="M3.75 8.75h8.5a4.25 4.25 0 0 1 0 8.5H9.5"/>',
	redo: '<path d="M13.5 5.5l3.25 3.25L13.5 12"/><path d="M16.25 8.75h-8.5a4.25 4.25 0 0 0 0 8.5h2.75"/>',
	chevron: '<path d="M5.75 8L10 12.25 14.25 8"/>',
	layout: '<rect x="3" y="4" width="14" height="12" rx="1.5"/><path d="M12.5 4v12"/>',
	fit: '<path d="M7 3.5H4.25a.75.75 0 0 0-.75.75V7M13 3.5h2.75a.75.75 0 0 1 .75.75V7M3.5 13v2.75c0 .41.34.75.75.75H7M16.5 13v2.75a.75.75 0 0 1-.75.75H13"/>',
	crosshair: '<path d="M10 2.5v4.75M10 12.75v4.75M2.5 10h4.75M12.75 10h4.75"/><circle cx="10" cy="10" r="1" fill="currentColor" stroke="none"/>',
	trend: '<path d="M6.24 13.76L13.76 6.24"/><circle cx="5" cy="15" r="1.75"/><circle cx="15" cy="5" r="1.75"/>',
	horizontal: '<path d="M2.5 10h3.75M9.75 10h7.75"/><circle cx="8" cy="10" r="1.75"/>',
	fib: '<rect x="3" y="8.2" width="14" height="3.6" fill="currentColor" fill-opacity=".12" stroke="none"/><path d="M3 4.5h9.5M16 4.5h1M3 8.17h14M3 11.83h14M3 15.5h1M7.5 15.5H17"/><path d="M6.7 14.1L13.3 5.9" stroke-dasharray="1.8 1.8"/><circle cx="5.75" cy="15.5" r="1.5"/><circle cx="14.25" cy="4.5" r="1.5"/>',
	channel: '<path d="M3.5 11.5L14 5l2.5 3.5L6 15Z" fill="currentColor" fill-opacity=".12" stroke="none"/><path d="M3.5 11.5L14 5M6 15l10.5-6.5"/><path d="M4.75 13.25l10.5-6.5" stroke-dasharray="1.8 1.8"/>',
	brush: '<path d="M14.7 3.8a1.4 1.4 0 0 1 2 2L9.5 13l-2.5.5.5-2.5 7.2-7.2Z"/><path d="M7 13.5c-1.8 0-3 1.3-3 3 1.8.2 3.2-.6 3.5-2.2"/><path d="M12.2 6.3l2 2"/>',
	text: '<path d="M4.75 5.75V4.5h10.5v1.25M10 4.5v11M7.5 15.5h5"/>',
	ruler: '<path d="M13.5 3.5L16.5 6.5 6.5 16.5 3.5 13.5Z"/><path d="M11.25 5.75l1.5 1.5M8.75 8.25l1.5 1.5M6.25 10.75l1.5 1.5"/>',
	magnet: '<path d="M5.5 3.5v7a4.5 4.5 0 0 0 9 0v-7h-2.75v7a1.75 1.75 0 0 1-3.5 0v-7H5.5Z"/><path d="M5.5 6.5h2.75M11.75 6.5H14.5"/>',
	lock: '<rect x="4.75" y="9" width="10.5" height="7.5" rx="1.5"/><path d="M7.25 9V6.75a2.75 2.75 0 0 1 5.5 0V9"/><circle cx="10" cy="12.75" r=".9" fill="currentColor" stroke="none"/>',
	eye: '<path d="M2.5 10s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5Z"/><circle cx="10" cy="10" r="2.25"/>',
	eyeOff: '<path d="M8.6 5.15A7.8 7.8 0 0 1 10 5c4.7 0 7.5 5 7.5 5a12.5 12.5 0 0 1-2.1 2.75M5.35 6.55A12.2 12.2 0 0 0 2.5 10s2.8 5 7.5 5c1.5 0 2.8-.4 3.9-1.05"/><path d="M8.45 8.45a2.25 2.25 0 0 0 3.1 3.1"/><path d="M3.5 3.5l13 13"/>',
	trash: '<path d="M3.75 5.5h12.5M7.5 5.5V4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5M5.25 5.5l.85 10a1.25 1.25 0 0 0 1.25 1.15h5.3a1.25 1.25 0 0 0 1.25-1.15l.85-10M8.5 8.75v4.75M11.5 8.75v4.75"/>',
	list: '<path d="M4.5 3.5h11v13.5L10 13.75 4.5 17V3.5Z" fill="currentColor" fill-opacity=".12"/><path d="M4.5 3.5h11v13.5L10 13.75 4.5 17V3.5Z"/><path d="M7.5 7.25h5M7.5 10.25h3.5"/>',
	layers: '<path d="M10 3.25L3.25 6.75 10 10.25 16.75 6.75 10 3.25Z" fill="currentColor" fill-opacity=".14"/><path d="M10 3.25L3.25 6.75 10 10.25 16.75 6.75 10 3.25Z"/><path d="M3.25 10L10 13.5 16.75 10M3.25 13.25L10 16.75 16.75 13.25"/>',
	calendar: '<rect x="3.25" y="4.5" width="13.5" height="12" rx="1.5"/><path d="M6.75 2.75v3M13.25 2.75v3M3.25 8.25h13.5"/><circle cx="7" cy="11.5" r=".7" fill="currentColor" stroke="none"/><circle cx="10" cy="11.5" r=".7" fill="currentColor" stroke="none"/><circle cx="13" cy="11.5" r=".7" fill="currentColor" stroke="none"/><circle cx="7" cy="14" r=".7" fill="currentColor" stroke="none"/><circle cx="10" cy="14" r=".7" fill="currentColor" stroke="none"/>',
	bell: '<path d="M5.5 13.25V9a4.5 4.5 0 0 1 9 0v4.25l1.5 1.75H4l1.5-1.75Z"/><path d="M8.25 16.5a1.85 1.85 0 0 0 3.5 0"/>',
	help: '<circle cx="10" cy="10" r="7"/><path d="M8 7.75a2.1 2.1 0 0 1 4 .6c0 1.4-2 1.65-2 2.9"/><circle cx="10" cy="14" r=".75" fill="currentColor" stroke="none"/>',
	check: '<path d="M4.5 10.5l3.5 3.5 7.5-7.5"/>',
	more: '<circle cx="4.5" cy="10" r="1.15" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="1.15" fill="currentColor" stroke="none"/><circle cx="15.5" cy="10" r="1.15" fill="currentColor" stroke="none"/>',
	arrowUp: '<path d="M10 15.5V4.5M5.75 8.75L10 4.5l4.25 4.25"/>',
	arrowDown: '<path d="M10 4.5v11M5.75 11.25L10 15.5l4.25-4.25"/>',
	maximize: '<path d="M7.5 3.75H4.5a.75.75 0 0 0-.75.75v3M12.5 3.75h3a.75.75 0 0 1 .75.75v3M3.75 12.5v3c0 .41.34.75.75.75h3M16.25 12.5v3a.75.75 0 0 1-.75.75h-3"/>',
	minimize: '<path d="M3.75 7.5h3a.75.75 0 0 0 .75-.75v-3M16.25 7.5h-3a.75.75 0 0 1-.75-.75v-3M3.75 12.5h3a.75.75 0 0 1 .75.75v3M16.25 12.5h-3a.75.75 0 0 0-.75.75v3"/>',
	settings: '<path d="M8.9 3.04h2.2l.38 1.55c.46.12.9.3 1.3.54l1.36-.83 1.56 1.56-.83 1.36c.24.4.42.84.54 1.3l1.55.38v2.2l-1.55.38c-.12.46-.3.9-.54 1.3l.83 1.36-1.56 1.56-1.36-.83c-.4.24-.84.42-1.3.54l-.38 1.55H8.9l-.38-1.55c-.46-.12-.9-.3-1.3-.54l-1.36.83-1.56-1.56.83-1.36c-.24-.4-.42-.84-.54-1.3l-1.55-.38V8.9l1.55-.38c.12-.46.3-.9.54-1.3l-.83-1.36 1.56-1.56 1.36.83c.4-.24.84-.42 1.3-.54l.38-1.55Z"/><circle cx="10" cy="10" r="2.25"/>',
	star: '<path d="M10 3.25l2.05 4.2 4.65.68-3.35 3.27.8 4.6L10 13.85 5.85 16l.8-4.6L3.3 8.13l4.65-.68L10 3.25Z"/>',
	cloud: '<path d="M6.25 15.5h8.25a3.25 3.25 0 0 0 .45-6.47 4.75 4.75 0 0 0-9.15-1.18A3.75 3.75 0 0 0 6.25 15.5Z"/>',
	copy: '<rect x="7.25" y="7.25" width="9.25" height="9.25" rx="1.4"/><path d="M12.75 7.25V5a1.4 1.4 0 0 0-1.4-1.4H5A1.4 1.4 0 0 0 3.6 5v6.35a1.4 1.4 0 0 0 1.4 1.4h2.25"/>',
	swap: '<path d="M4.5 7.5h11l-3-3M15.5 12.5h-11l3 3"/>',
};
export type IconName = keyof typeof paths;

export function icon(name: IconName): HTMLSpanElement {
	const node = element('span', 'icon');
	node.setAttribute('aria-hidden', 'true');
	// Only static, application-owned SVG paths are inserted here.
	node.innerHTML = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
	return node;
}

export function iconButton(name: IconName, label: string, onClick?: () => void): HTMLButtonElement {
	const button = element('button', 'icon-button');
	button.type = 'button';
	button.title = label;
	button.setAttribute('aria-label', label);
	button.append(icon(name));
	if (onClick) button.onclick = onClick;
	return button;
}

export function unavailableButton(name: IconName, label: string): HTMLButtonElement {
	const button = iconButton(name, `${label}（即将推出）`);
	button.disabled = true;
	return button;
}
