import type { Timeframe } from '@terminal/domain';
import {
	TIMEFRAME_GROUPS, TIMEFRAME_LONG_LABELS, TIMEFRAME_SHORT_LABELS, TIMEFRAME_STORAGE_KEY,
	defaultTimeframePreferences, parseTimeframePreferences, toggleFavoriteTimeframe, toggleTimeframeGroup,
	visibleToolbarTimeframes, type TimeframeGroupId, type TimeframePreferences,
} from './data/timeframes';
import { element, icon } from './ui';
import './timeframe-ui.css';

export function createTimeframeUI(
	app: HTMLElement,
	container: HTMLElement,
	onSelect: (timeframe: Timeframe) => void,
) {
	let prefs: TimeframePreferences;
	try {
		const raw = localStorage.getItem(TIMEFRAME_STORAGE_KEY);
		prefs = raw ? parseTimeframePreferences(JSON.parse(raw)) : defaultTimeframePreferences();
	} catch {
		prefs = defaultTimeframePreferences();
	}
	let activeTimeframe: Timeframe | undefined;
	let hasActiveTab = false;

	const trigger = element('button', 'period-dropdown-trigger');
	trigger.type = 'button';
	trigger.setAttribute('aria-label', '选择图表周期');
	trigger.setAttribute('aria-haspopup', 'true');
	trigger.setAttribute('aria-expanded', 'false');
	trigger.append(element('span', '', '周期'), icon('chevron'));

	const favoritesBar = element('div', 'period-favorites');
	container.replaceChildren(trigger, favoritesBar);

	const dropdown = element('div', 'timeframe-dropdown');
	dropdown.hidden = true;
	dropdown.setAttribute('role', 'dialog');
	dropdown.setAttribute('aria-label', '图表周期菜单');
	app.append(dropdown);

	function savePrefs(): void {
		try {
			localStorage.setItem(TIMEFRAME_STORAGE_KEY, JSON.stringify(prefs));
		} catch {
			// Ignore storage quota / privacy mode errors.
		}
	}

	function renderBar(): void {
		trigger.disabled = !hasActiveTab;
		favoritesBar.replaceChildren();
		if (!hasActiveTab) {
			close();
			return;
		}
		const visible = visibleToolbarTimeframes(prefs, activeTimeframe);
		for (const timeframe of visible) {
			const button = element('button', 'period-fav-button', TIMEFRAME_SHORT_LABELS[timeframe]);
			button.type = 'button';
			button.dataset.timeframe = timeframe;
			button.setAttribute('aria-label', `周期 ${timeframe}`);
			button.setAttribute('aria-pressed', String(timeframe === activeTimeframe));
			button.title = TIMEFRAME_LONG_LABELS[timeframe];
			button.onclick = () => {
				close();
				onSelect(timeframe);
			};
			favoritesBar.append(button);
		}
	}

	function renderDropdown(): void {
		dropdown.replaceChildren();
		const favSet = new Set<Timeframe>(prefs.favorites);
		const collapsedSet = new Set<TimeframeGroupId>(prefs.collapsedGroups);
		for (const group of TIMEFRAME_GROUPS) {
			const section = element('section', 'timeframe-group');
			const collapsed = collapsedSet.has(group.id);
			const heading = element('button', 'timeframe-group-head');
			heading.type = 'button';
			heading.setAttribute('aria-expanded', String(!collapsed));
			heading.append(element('span', '', group.label), icon('chevron'));
			heading.onclick = () => {
				prefs = toggleTimeframeGroup(prefs, group.id);
				savePrefs();
				renderDropdown();
			};
			section.append(heading);
			if (!collapsed) {
				const list = element('div', 'timeframe-group-list');
				for (const timeframe of group.timeframes) {
					const isActive = timeframe === activeTimeframe;
					const isFav = favSet.has(timeframe);
					const row = element('div', `timeframe-row${isActive ? ' is-active' : ''}`);
					const select = element('button', 'timeframe-option', TIMEFRAME_LONG_LABELS[timeframe]);
					select.type = 'button';
					select.dataset.timeframe = timeframe;
					select.setAttribute('aria-pressed', String(isActive));
					select.onclick = () => {
						close();
						onSelect(timeframe);
					};
					const star = element('button', `timeframe-star${isFav ? ' is-favorite' : ''}`);
					star.type = 'button';
					star.setAttribute('aria-label', `${isFav ? '取消收藏' : '收藏常用周期'} ${TIMEFRAME_LONG_LABELS[timeframe]}`);
					star.setAttribute('aria-pressed', String(isFav));
					star.title = isFav ? '从常用周期移除' : '添加到常用周期';
					star.append(icon('star'));
					star.onclick = event => {
						event.stopPropagation();
						prefs = toggleFavoriteTimeframe(prefs, timeframe);
						savePrefs();
						renderBar();
						renderDropdown();
					};
					row.append(select, star);
					list.append(row);
				}
				section.append(list);
			}
			dropdown.append(section);
		}
	}

	function position(): void {
		const rect = trigger.getBoundingClientRect();
		const width = Math.min(228, window.innerWidth - 16);
		const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
		dropdown.style.left = `${left}px`;
		dropdown.style.top = `${Math.round(rect.bottom + 6)}px`;
		dropdown.style.width = `${width}px`;
	}

	function open(): void {
		if (!hasActiveTab) return;
		renderDropdown();
		position();
		dropdown.hidden = false;
		trigger.setAttribute('aria-expanded', 'true');
	}

	function close(): void {
		if (dropdown.hidden) return;
		dropdown.hidden = true;
		trigger.setAttribute('aria-expanded', 'false');
	}

	function toggle(): void {
		if (dropdown.hidden) open();
		else close();
	}

	trigger.onclick = toggle;

	const onPointerDown = (event: PointerEvent): void => {
		if (dropdown.hidden) return;
		const target = event.target as Node | null;
		if (target && (dropdown.contains(target) || trigger.contains(target))) return;
		close();
	};
	const onKeyDown = (event: KeyboardEvent): void => {
		if (event.key === 'Escape' && !dropdown.hidden) {
			event.stopPropagation();
			close();
			trigger.focus({ preventScroll: true });
		}
	};
	const onResize = (): void => {
		if (!dropdown.hidden) position();
	};

	document.addEventListener('pointerdown', onPointerDown, true);
	document.addEventListener('keydown', onKeyDown);
	window.addEventListener('resize', onResize);

	return {
		update(timeframe?: Timeframe) {
			hasActiveTab = timeframe !== undefined;
			activeTimeframe = timeframe;
			renderBar();
			if (!dropdown.hidden) renderDropdown();
		},
		close,
		isOpen: () => !dropdown.hidden,
		destroy() {
			close();
			document.removeEventListener('pointerdown', onPointerDown, true);
			document.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('resize', onResize);
			dropdown.remove();
		},
	};
}
