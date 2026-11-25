import { instrumentKey, type Instrument, type MarketQuote } from '@terminal/domain';
import { MarketDataError } from './binance';
import type { MarketFeedProvider, ProviderResolver } from './provider';

/**
 * One combined ticker stream per (venue, market).
 * Uses WebSocket ticks first (0 REST weight) and only fills missing symbols via REST (batched for spot)
 * so startup and reconnects never burst individual ticker requests into Binance rate limits.
 */
export function startQuoteFeed(
	providerOrResolver: MarketFeedProvider | ProviderResolver,
	instruments: Instrument[],
	onQuote: (instrument: Instrument, quote: MarketQuote) => void,
	onState: (market: Instrument['market'], message: string) => void,
): () => void {
	const resolve: ProviderResolver = typeof providerOrResolver === 'function'
		? providerOrResolver
		: venue => (providerOrResolver.venue === venue ? providerOrResolver : undefined);
	const controller = new AbortController();
	const latest = new Map<string, number>();
	const timers = new Set<ReturnType<typeof setTimeout>>();
	const publish = (instrument: Instrument, quote: MarketQuote): void => {
		const key = instrumentKey(instrument);
		if (controller.signal.aborted || quote.updatedAt < (latest.get(key) ?? 0)) return;
		latest.set(key, quote.updatedAt);
		onQuote(instrument, quote);
	};

	const groups = new Map<string, { venue: string; market: Instrument['market']; items: Instrument[] }>();
	for (const instrument of instruments) {
		const groupKey = `${instrument.venue}:${instrument.market}`;
		const entry = groups.get(groupKey);
		if (entry) entry.items.push(instrument);
		else groups.set(groupKey, { venue: instrument.venue, market: instrument.market, items: [instrument] });
	}

	const stops: (() => void)[] = [];
	for (const { venue, market, items } of groups.values()) {
		const provider = resolve(venue);
		if (!provider || items.length === 0) continue;
		let refreshing = false;
		let retry: ReturnType<typeof setTimeout> | undefined;
		const schedule = (fn: () => void, delayMs: number): ReturnType<typeof setTimeout> => {
			const id = setTimeout(() => {
				timers.delete(id);
				fn();
			}, delayMs);
			timers.add(id);
			return id;
		};

		const refresh = async (onlyMissing = false): Promise<void> => {
			if (refreshing || controller.signal.aborted) return;
			const now = Date.now();
			const targets = onlyMissing
				? items.filter(item => {
					const updatedAt = latest.get(instrumentKey(item));
					return updatedAt === undefined || now - updatedAt > 60000;
				})
				: items;
			if (targets.length === 0) return;
			refreshing = true;
			if (retry) { clearTimeout(retry); timers.delete(retry); retry = undefined; }
			let failed = false;
			let retryDelay = 30000;
			let rateLimitedMessage: string | undefined;

			try {
				if (provider.getQuotes && market === 'spot') {
					const batch = await provider.getQuotes(targets, controller.signal);
					for (const item of targets) {
						const q = batch.get(instrumentKey(item));
						if (q) publish(item, q);
					}
				} else {
					for (let i = 0; i < targets.length && !controller.signal.aborted; i += 3) {
						let stopBatch = false;
						await Promise.all(targets.slice(i, i + 3).map(async instrument => {
							try {
								publish(instrument, await provider.getQuote(instrument, controller.signal));
							} catch (error) {
								failed = true;
								if (error instanceof MarketDataError && error.retryAfterMs > 0) {
									retryDelay = Math.max(retryDelay, error.retryAfterMs);
									rateLimitedMessage = error.message;
									stopBatch = true;
								}
							}
						}));
						if (stopBatch) break;
					}
				}
			} catch (error) {
				failed = true;
				if (error instanceof MarketDataError && error.retryAfterMs > 0) {
					retryDelay = Math.max(retryDelay, error.retryAfterMs);
					rateLimitedMessage = error.message;
				}
			} finally {
				refreshing = false;
			}

			if (failed && !controller.signal.aborted) {
				onState(market, rateLimitedMessage ?? '部分报价加载失败，等待重试');
				retry = schedule(() => { void refresh(true); }, retryDelay);
			}
		};

		stops.push(provider.subscribeQuotes(items, {
			onOpen: () => {
				// Let WS push live 24h tickers first; only fall back to REST for quiet symbols still missing quotes.
				if (provider.realtime) {
					schedule(() => { void refresh(true); }, 1800);
				} else {
					void refresh(true);
				}
			},
			onData: ({ instrument, quote }) => { publish(instrument, quote); onState(market, provider.realtime ? '实时' : '轮询更新'); },
			onState: (_state, message) => { if (!controller.signal.aborted) onState(market, message ?? '报价连接中'); },
		}));

		// For HTTP-only providers (no WS), bootstrap immediately; for realtime WS providers,
		// use batch REST for spot or short WS grace period for perpetual to minimize REST weight.
		if (!provider.realtime || (provider.getQuotes && market === 'spot')) {
			void refresh(false);
		} else {
			schedule(() => { void refresh(true); }, 2000);
		}
	}

	return () => { controller.abort(); stops.forEach(stop => stop()); timers.forEach(clearTimeout); };
}
