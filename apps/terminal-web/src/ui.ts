export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

const paths = {
	logo: '<path d="M3 17V7h5v10M10 14V4h5v10M17 20V10h4v10"/>',
	plus: '<path d="M12 4v16M4 12h16"/>',
	close: '<path d="m6 6 12 12M6 18 18 6"/>',
	search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
	candles: '<path d="M7 3v4m0 10v4M17 3v8m0 6v4"/><path d="M4 7h6v10H4zM14 11h6v6h-6z"/>',
	indicator: '<path d="M3 17 8 12l4 3 9-10M3 21h18M4 4v4m5-5v4"/>',
	clock: '<circle cx="12" cy="13" r="8"/><path d="M12 8v5l3 2M3 3l3 2m12 0 3-2"/>',
	replay: '<path d="m12 5-9 7 9 7V5Zm9 0-9 7 9 7V5Z"/>',
	undo: '<path d="m8 5-5 5 5 5M3 10h11a6 6 0 0 1 6 6v3"/>',
	redo: '<path d="m16 5 5 5-5 5m5-5H10a6 6 0 0 0-6 6v3"/>',
	chevron: '<path d="m7 10 5 5 5-5"/>',
	layout: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
	fit: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
	crosshair: '<path d="M12 2v7m0 6v7M2 12h7m6 0h7"/>',
	trend: '<path d="m5 19 14-14"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/>',
	horizontal: '<path d="M3 12h18"/><circle cx="8" cy="12" r="2"/>',
	fib: '<path d="M3 5h18M3 10h18M3 15h18M3 20h18"/><path d="m5 20 14-15" stroke-dasharray="2 3"/>',
	channel: '<path d="m3 16 14-12M7 20 14 8M5 18 14 6"/>',
	brush: '<path d="M3 19c7 1 3-10 9-8s1 8 9-8"/>',
	text: '<path d="M5 5h14M12 5v15M8 20h8"/>',
	ruler: '<path d="m3 17 14-14 4 4L7 21 3 17Zm6-6 3 3m1-7 3 3m-11 5 3 3"/>',
	magnet: '<path d="M5 4v10a7 7 0 0 0 14 0V4h-4v10a3 3 0 0 1-6 0V4H5ZM5 8h4m6 0h4"/>',
	lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
	eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
	eyeOff: '<path d="m3 3 18 18M10 5a12 12 0 0 1 12 7s-2 4-5 6M6 6a21 21 0 0 0-4 6s4 7 10 7c1 0 2 0 3-1M10 10a3 3 0 0 0 4 4"/>',
	trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
	list: '<path d="M5 4h14v17l-7-4-7 4V4Zm3 4h8m-8 4h8"/>',
	layers: '<path d="m2 8 10-6 10 6-10 6L2 8Zm0 5 10 6 10-6M2 18l10 6 10-6"/>',
	calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 11h18"/>',
	bell: '<path d="M4 17h16l-2-3V9a6 6 0 0 0-12 0v5l-2 3Zm5 4h6"/>',
	help: '<circle cx="12" cy="12" r="9"/><path d="M9 8a3 3 0 1 1 4 3c-1 1-1 2-1 3m0 3h.01"/>',
	check: '<path d="m5 12 4 4L19 6"/>',
	more: '<circle cx="4" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="20" cy="12" r="1"/>',
	arrowUp: '<path d="M12 18V6m-5 5 5-5 5 5"/>',
	arrowDown: '<path d="M12 6v12m-5-5 5 5 5-5"/>',
	maximize: '<path d="M8 4H5a1 1 0 0 0-1 1v3m12-4h3a1 1 0 0 1 1 1v3M4 16v3a1 1 0 0 0 1 1h3m12-4v3a1 1 0 0 1-1 1h-3"/>',
	minimize: '<path d="M4 9h4a1 1 0 0 0 1-1V4m11 5h-4a1 1 0 0 1-1-1V4M4 15h4a1 1 0 0 1 1 1v4m11-5h-4a1 1 0 0 0-1 1v4"/>',
	settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
	star: '<path d="m12 3.5 2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.8-5.4 2.8 1-6-4.3-4.2 6-.9L12 3.5Z"/>',
};
export type IconName = keyof typeof paths;

export function icon(name: IconName): HTMLSpanElement {
	const node = element('span', 'icon');
	node.setAttribute('aria-hidden', 'true');
	// Only static, application-owned SVG paths are inserted here.
	node.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
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
