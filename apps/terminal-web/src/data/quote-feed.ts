import { instrumentKey, type Instrument, type MarketQuote } from '@terminal/domain';
import { BinanceProvider } from './binance';

/** One combined ticker stream per market; REST bootstraps and refreshes after reconnect. */
export function startQuoteFeed(provider: BinanceProvider, instruments: Instrument[], onQuote: (instrument: Instrument, quote: MarketQuote) => void, onState: (market: Instrument['market'], message: string) => void): () => void {
	const controller = new AbortController();
	const latest = new Map<string, number>();
	const timers = new Set<ReturnType<typeof setTimeout>>();
	const publish = (instrument: Instrument, quote: MarketQuote): void => {
		const key = instrumentKey(instrument);
		if (controller.signal.aborted || quote.updatedAt < (latest.get(key) ?? 0)) return;
		latest.set(key, quote.updatedAt);
		onQuote(instrument, quote);
	};
	const stops = (['spot', 'perpetual'] as const).map(market => {
		const selected = instruments.filter(i => i.market === market);
		let refreshing = false;
		let retry: ReturnType<typeof setTimeout> | undefined;
		const refresh = async (): Promise<void> => {
			if (refreshing || controller.signal.aborted) return;
			refreshing = true;
			if (retry) { clearTimeout(retry); timers.delete(retry); }
			let failed = false;
			// Bound concurrency instead of sending one request per row at once.
			for (let i = 0; i < selected.length && !controller.signal.aborted; i += 3) {
				await Promise.all(selected.slice(i, i + 3).map(async instrument => {
					try { publish(instrument, await provider.getQuote(instrument, controller.signal)); }
					catch { failed = true; }
				}));
			}
			refreshing = false;
			if (failed && !controller.signal.aborted) {
				onState(market, '部分报价加载失败，等待重试');
				retry = setTimeout(() => { if (retry) timers.delete(retry); void refresh(); }, 30000);
				timers.add(retry);
			}
		};
		void refresh();
		return provider.subscribeQuotes(selected, {
			onOpen: () => { void refresh(); },
			onData: ({ instrument, quote }) => { publish(instrument, quote); onState(market, '实时'); },
			onState: (_state, message) => { if (!controller.signal.aborted) onState(market, message ?? '报价连接中'); },
		});
	});
	return () => { controller.abort(); stops.forEach(stop => stop()); timers.forEach(clearTimeout); };
}
