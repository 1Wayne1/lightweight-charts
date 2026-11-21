import { getCatalogIndicator } from './data/indicator-catalog';
import { indicatorParams, isIndicatorVisible, type IndicatorSettings } from './data/indicators';
import { element, iconButton } from './ui';

export function indicatorLegendRow(settings: IndicatorSettings, id: string, toggle: () => void, configure: () => void): HTMLDivElement {
	const def = getCatalogIndicator(id)!;
	const visible = isIndicatorVisible(settings, id);
	const row = element('div', `indicator-legend-row${visible ? '' : ' is-hidden'}`);
	row.dataset.indicator = id;
	const periods = id === 'ma' || id === 'ema'
		? (id === 'ma' ? settings.maLines : settings.emaLines).filter(line => line.visible).map(line => line.period)
		: def.params.map(param => indicatorParams(settings, id)[param.key]);
	const name = element('span', 'indicator-legend-name', def.shortName);
	name.title = def.name;
	const params = element('span', 'indicator-legend-params', periods.join(' '));
	params.title = periods.join(' ');
	const values = element('span', 'indicator-legend-values');
	values.hidden = !visible;
	const actions = element('span', 'indicator-legend-actions');
	const eye = iconButton(visible ? 'eye' : 'eyeOff', `${visible ? '隐藏' : '显示'} ${def.shortName}`, toggle);
	eye.dataset.action = 'visibility'; eye.setAttribute('aria-pressed', String(!visible));
	const gear = iconButton('settings', `设置 ${def.shortName}`, configure); gear.dataset.action = 'settings';
	actions.append(eye, gear);
	row.append(name, params, values, actions);
	return row;
}

/** Update only values, retaining hover, focus and touch targets during live ticks. */
export function updateIndicatorLegendValues(root: HTMLElement, values: Record<string, { label: string; text: string; color: string }[]>): void {
	for (const row of root.querySelectorAll<HTMLElement>('.indicator-legend-row')) {
		const container = row.querySelector<HTMLElement>('.indicator-legend-values')!;
		const items = values[row.dataset.indicator!] ?? [];
		while (container.childElementCount > items.length) container.lastElementChild?.remove();
		items.forEach((item, index) => {
			let node = container.children[index] as HTMLElement | undefined;
			if (!node) { node = element('span', 'indicator-legend-value'); container.append(node); }
			node.textContent = item.text; node.title = item.label; node.style.color = item.color;
		});
	}
}
