import { instrumentKey, type Workspace } from '@terminal/domain';

/** Preserve the original demo preferences, and never overwrite existing Binance preferences. */
export function migrateDemoWorkspace(state: Workspace): Workspace {
	const preferences = { ...state.preferences };
	for (const preference of Object.values(state.preferences)) {
		if (preference.instrument.venue !== 'demo') continue;
		const instrument = { ...preference.instrument, venue: 'binance' };
		preferences[instrumentKey(instrument)] ??= { ...preference, instrument };
	}
	const ids = new Map<string, string>();
	const tabs: Workspace['tabs'] = [];
	for (const tab of state.tabs) {
		const preference = state.preferences[tab.instrumentKey];
		const instrument = preference.instrument.venue === 'demo' ? { ...preference.instrument, venue: 'binance' } : preference.instrument;
		const key = instrumentKey(instrument);
		preferences[key] ??= { ...preference, instrument };
		const existing = tabs.find(item => item.instrumentKey === key);
		const id = existing?.id ?? (key === tab.instrumentKey ? tab.id : key);
		ids.set(tab.id, id);
		if (!existing) tabs.push({ id, instrumentKey: key });
	}
	return { ...state, tabs, preferences, activeTabId: state.activeTabId ? ids.get(state.activeTabId) ?? null : null };
}
