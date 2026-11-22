import { element, icon } from '../ui';
import {
	CustomColorRepository,
	HEX_COLOR_RE,
	TV_PRIMARY_COLORS,
	TV_SHADE_COLORS,
	formatHexWithAlpha,
	hexToHsv,
	hsvToHex,
	parseHexColor,
	type HsvColor,
} from './color-palette';

const sharedCustomColors = new CustomColorRepository(typeof localStorage !== 'undefined' ? localStorage : undefined);
let customColorsChangeListener: (() => void) | undefined;

export function setCustomColorsChangeListener(listener?: () => void): void {
	customColorsChangeListener = listener;
}

export function exportSharedCustomColors(): Record<string, unknown> {
	return sharedCustomColors.exportStore() as unknown as Record<string, unknown>;
}

export function reloadSharedCustomColors(): void {
	sharedCustomColors.reload();
}

export interface ColorPickerOpacityOptions {
	value: number;
	max: number;
	label?: string;
	onSelect: (value: number) => void;
}

export interface TradingViewColorPickerOptions {
	container: HTMLElement;
	label: string;
	current: string;
	onSelect: (value: string) => void;
	opacity?: ColorPickerOpacityOptions;
	onResize?: () => void;
}

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

/**
 * Renders the TradingView-style two-view color picker:
 * 1. Palette view: 10x2 base/gray + 10x6 shade grid, custom colors row with '+' button, and gradient opacity slider.
 * 2. Custom view: preview swatch + #hex input + '增加' button + 2D Saturation/Value square + vertical Hue bar.
 */
export function renderTradingViewColorPicker(options: TradingViewColorPickerOptions): void {
	const { container, label, onSelect, opacity, onResize } = options;
	const parsedInitial = parseHexColor(options.current);
	let selectedHex = parsedInitial.hex;
	let currentAlpha = opacity ? clamp01(opacity.value) : parsedInitial.alpha;
	const maxAlpha = opacity ? opacity.max : 1;
	let mode: 'palette' | 'custom' = 'palette';

	const emitColor = (hex6: string, alpha = currentAlpha): void => {
		selectedHex = parseHexColor(hex6).hex;
		currentAlpha = Math.max(0, Math.min(maxAlpha, alpha));
		if (opacity) {
			onSelect(selectedHex);
		} else {
			onSelect(formatHexWithAlpha(selectedHex, currentAlpha));
		}
	};

	const emitAlpha = (nextAlpha: number): void => {
		currentAlpha = Math.max(0, Math.min(maxAlpha, nextAlpha));
		if (opacity) {
			opacity.onSelect(currentAlpha);
		} else {
			onSelect(formatHexWithAlpha(selectedHex, currentAlpha));
		}
	};

	function renderPaletteView(): void {
		container.replaceChildren();
		const wrap = element('div', 'tv-color-picker');
		const swatchNodes: Array<{ value: string; node: HTMLButtonElement }> = [];

		const syncSelectedRing = (): void => {
			for (const item of swatchNodes) {
				const active = item.value === selectedHex;
				item.node.setAttribute('aria-pressed', String(active));
				item.node.classList.toggle('is-selected', active);
			}
		};

		const opacityVisualHandlers: Array<() => void> = [];

		const makeSwatch = (hexValue: string, removable = false): HTMLButtonElement => {
			const normalized = parseHexColor(hexValue).hex;
			const swatch = element('button', 'tv-color-swatch');
			swatch.type = 'button';
			swatch.style.backgroundColor = normalized;
			swatch.setAttribute('aria-label', `颜色 ${normalized}`);
			swatch.setAttribute('aria-pressed', String(normalized === selectedHex));
			if (normalized === selectedHex) swatch.classList.add('is-selected');
			if (normalized === '#000000' || normalized === '#131722') swatch.classList.add('is-dark-swatch');
			swatch.onclick = () => {
				emitColor(normalized, currentAlpha);
				syncSelectedRing();
				for (const fn of opacityVisualHandlers) fn();
			};
			if (removable) {
				swatch.title = `${normalized}（右键移除自定义颜色）`;
				swatch.oncontextmenu = event => {
					event.preventDefault();
					sharedCustomColors.remove(normalized);
					customColorsChangeListener?.();
					renderPaletteView();
				};
			}
			swatchNodes.push({ value: normalized, node: swatch });
			return swatch;
		};

		// Top 2 rows: 10 grayscales + 10 vibrant colors
		const primaryGrid = element('div', 'tv-color-grid tv-color-grid-primary');
		primaryGrid.setAttribute('role', 'group');
		primaryGrid.setAttribute('aria-label', `${label}常用颜色`);
		for (const hex of TV_PRIMARY_COLORS) primaryGrid.append(makeSwatch(hex));

		// Middle 6 rows: tints to shades
		const shadeGrid = element('div', 'tv-color-grid tv-color-grid-shades');
		shadeGrid.setAttribute('role', 'group');
		shadeGrid.setAttribute('aria-label', `${label}色阶`);
		for (const hex of TV_SHADE_COLORS) shadeGrid.append(makeSwatch(hex));

		const divider = element('div', 'tv-color-divider');

		// Custom colors row + '+' button
		const customSection = element('div', 'tv-color-grid tv-color-custom-grid');
		customSection.setAttribute('role', 'group');
		customSection.setAttribute('aria-label', '自定义颜色');
		for (const hex of sharedCustomColors.list()) {
			customSection.append(makeSwatch(hex, true));
		}
		const addBtn = element('button', 'tv-color-add-btn');
		addBtn.type = 'button';
		addBtn.setAttribute('aria-label', '添加自定义颜色');
		addBtn.title = '添加自定义颜色';
		addBtn.append(icon('plus'));
		addBtn.onclick = () => {
			mode = 'custom';
			render();
		};
		customSection.append(addBtn);

		// TradingView-style opacity section (checkerboard -> current color gradient + % box)
		const opacitySection = element('div', 'tv-opacity-section');
		const opacityLabel = element('div', 'tv-opacity-label', opacity?.label ?? '不透明度');
		const opacityRow = element('div', 'tv-opacity-row');

		const sliderWrap = element('div', 'tv-opacity-slider');
		const sliderGradient = element('div', 'tv-opacity-gradient');
		const sliderThumb = element('div', 'tv-opacity-thumb');
		const rangeInput = element('input', 'tv-opacity-input');
		rangeInput.type = 'range';
		rangeInput.min = '0';
		rangeInput.max = String(Math.round(maxAlpha * 100));
		rangeInput.step = '1';
		rangeInput.value = String(Math.round(currentAlpha * 100));
		rangeInput.setAttribute('aria-label', opacity?.label ?? `${label}不透明度`);
		sliderWrap.append(sliderGradient, sliderThumb, rangeInput);

		const percentBox = element('div', 'tv-opacity-percent');
		const percentInput = element('input');
		percentInput.type = 'text';
		percentInput.inputMode = 'numeric';
		percentInput.maxLength = 4;
		percentInput.setAttribute('aria-label', '不透明度百分比');
		percentBox.append(percentInput, element('span', '', '%'));

		const updateOpacityVisual = (): void => {
			const pct = Math.round(currentAlpha * 100);
			const ratio = maxAlpha > 0 ? clamp01(currentAlpha / maxAlpha) : 0;
			sliderGradient.style.background = `linear-gradient(to right, transparent, ${selectedHex})`;
			sliderThumb.style.left = `${(ratio * 100).toFixed(2)}%`;
			rangeInput.value = String(pct);
			if (document.activeElement !== percentInput) percentInput.value = String(pct);
		};
		opacityVisualHandlers.push(updateOpacityVisual);

		rangeInput.oninput = () => {
			const pct = Number(rangeInput.value);
			emitAlpha(pct / 100);
			updateOpacityVisual();
		};
		percentInput.oninput = () => {
			const digits = percentInput.value.replace(/[^\d]/g, '');
			if (!digits) return;
			const maxPct = Math.round(maxAlpha * 100);
			const clampedPct = Math.max(0, Math.min(maxPct, Number(digits)));
			emitAlpha(clampedPct / 100);
			const ratio = maxAlpha > 0 ? clamp01(currentAlpha / maxAlpha) : 0;
			sliderThumb.style.left = `${(ratio * 100).toFixed(2)}%`;
			rangeInput.value = String(clampedPct);
		};
		percentInput.onblur = () => updateOpacityVisual();

		updateOpacityVisual();
		opacityRow.append(sliderWrap, percentBox);
		opacitySection.append(opacityLabel, opacityRow);

		wrap.append(primaryGrid, shadeGrid, divider, customSection, opacitySection);
		container.append(wrap);
		onResize?.();
	}

	function renderCustomView(): void {
		container.replaceChildren();
		const wrap = element('div', 'tv-custom-picker');
		let hsv: HsvColor = hexToHsv(selectedHex);
		let draftHex = selectedHex;

		// Top bar: preview swatch + #hex input + white '增加' button (matches TradingView screenshot 2)
		const topBar = element('form', 'tv-custom-top');
		const previewSwatch = element('button', 'tv-custom-preview');
		previewSwatch.type = 'button';
		previewSwatch.title = '返回色板';
		previewSwatch.setAttribute('aria-label', '返回预设色板');
		previewSwatch.onclick = () => {
			mode = 'palette';
			render();
		};

		const hexInput = element('input', 'tv-custom-hex');
		hexInput.type = 'text';
		hexInput.maxLength = 7;
		hexInput.spellcheck = false;
		hexInput.autocomplete = 'off';
		hexInput.setAttribute('aria-label', 'HEX 颜色');

		const addConfirm = element('button', 'tv-custom-confirm', '增加');
		addConfirm.type = 'submit';

		topBar.append(previewSwatch, hexInput, addConfirm);

		// Main area: 2D Saturation-Value box + vertical rainbow Hue bar
		const body = element('div', 'tv-custom-body');

		const svBox = element('div', 'tv-sv-box');
		svBox.setAttribute('role', 'slider');
		svBox.setAttribute('aria-label', '饱和度与亮度');
		const svWhite = element('div', 'tv-sv-layer tv-sv-white');
		const svBlack = element('div', 'tv-sv-layer tv-sv-black');
		const svThumb = element('div', 'tv-sv-thumb');
		svBox.append(svWhite, svBlack, svThumb);

		const hueBar = element('div', 'tv-hue-bar');
		hueBar.setAttribute('role', 'slider');
		hueBar.setAttribute('aria-label', '色相');
		const hueThumb = element('div', 'tv-hue-thumb');
		hueBar.append(hueThumb);

		body.append(svBox, hueBar);
		wrap.append(topBar, body);
		container.append(wrap);

		const syncVisuals = (fromHexInput = false): void => {
			draftHex = hsvToHex(hsv);
			previewSwatch.style.backgroundColor = draftHex;
			svBox.style.backgroundColor = hsvToHex({ h: hsv.h, s: 1, v: 1 });
			svThumb.style.left = `${(clamp01(hsv.s) * 100).toFixed(2)}%`;
			svThumb.style.top = `${((1 - clamp01(hsv.v)) * 100).toFixed(2)}%`;
			hueThumb.style.top = `${(clamp01(hsv.h / 360) * 100).toFixed(2)}%`;
			if (!fromHexInput) hexInput.value = draftHex;
		};

		const applyDraft = (fromHexInput = false): void => {
			syncVisuals(fromHexInput);
			emitColor(draftHex, currentAlpha);
		};

		// 2D SV pointer drag
		const updateSvFromPointer = (clientX: number, clientY: number): void => {
			const rect = svBox.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) return;
			hsv = {
				...hsv,
				s: clamp01((clientX - rect.left) / rect.width),
				v: clamp01(1 - (clientY - rect.top) / rect.height),
			};
			applyDraft();
		};
		let draggingSv = false;
		svBox.onpointerdown = event => {
			if (event.button !== 0) return;
			event.preventDefault();
			draggingSv = true;
			try { svBox.setPointerCapture(event.pointerId); } catch { /* ignore */ }
			updateSvFromPointer(event.clientX, event.clientY);
		};
		svBox.onpointermove = event => {
			if (draggingSv) updateSvFromPointer(event.clientX, event.clientY);
		};
		svBox.onpointerup = () => { draggingSv = false; };
		svBox.onpointercancel = () => { draggingSv = false; };

		// Vertical Hue pointer drag
		const updateHueFromPointer = (clientY: number): void => {
			const rect = hueBar.getBoundingClientRect();
			if (rect.height <= 0) return;
			const ratio = clamp01((clientY - rect.top) / rect.height);
			hsv = { ...hsv, h: ratio * 359.99 };
			applyDraft();
		};
		let draggingHue = false;
		hueBar.onpointerdown = event => {
			if (event.button !== 0) return;
			event.preventDefault();
			draggingHue = true;
			try { hueBar.setPointerCapture(event.pointerId); } catch { /* ignore */ }
			updateHueFromPointer(event.clientY);
		};
		hueBar.onpointermove = event => {
			if (draggingHue) updateHueFromPointer(event.clientY);
		};
		hueBar.onpointerup = () => { draggingHue = false; };
		hueBar.onpointercancel = () => { draggingHue = false; };

		hexInput.oninput = () => {
			const trimmed = hexInput.value.trim();
			const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
			if (HEX_COLOR_RE.test(withHash) && (withHash.length === 4 || withHash.length === 7)) {
				hsv = hexToHsv(withHash);
				applyDraft(true);
			}
		};

		topBar.onsubmit = event => {
			event.preventDefault();
			const trimmed = hexInput.value.trim();
			const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
			const finalHex = HEX_COLOR_RE.test(withHash) ? parseHexColor(withHash).hex : draftHex;
			sharedCustomColors.add(finalHex);
			customColorsChangeListener?.();
			emitColor(finalHex, currentAlpha);
			mode = 'palette';
			render();
		};

		syncVisuals();
		onResize?.();
	}

	function render(): void {
		if (mode === 'palette') renderPaletteView();
		else renderCustomView();
	}

	render();
}
