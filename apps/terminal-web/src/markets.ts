import { instrumentKey, type Instrument, type InstrumentInfo } from '@terminal/domain';
import { fallbackColorForSymbol, resolveCoinIconSources } from './data/coin-icons';
import { element } from './ui';

export const markets = [
	{ ticker: 'BTC', name: 'Bitcoin', glyph: '₿', color: '#f7931a', price: 67432.8 },
	{ ticker: 'ETH', name: 'Ethereum', glyph: '◆', color: '#627eea', price: 3218.64 },
	{ ticker: 'SOL', name: 'Solana', glyph: '≋', color: '#8265d9', price: 148.72 },
	{ ticker: 'BNB', name: 'BNB', glyph: '◇', color: '#d6a51d', price: 589.31 },
	{ ticker: 'XRP', name: 'XRP', glyph: '×', color: '#434750', price: 0.9521 },
	{ ticker: 'DOGE', name: 'Dogecoin', glyph: 'Ð', color: '#b59b53', price: 0.1628 },
	{ ticker: 'AVAX', name: 'Avalanche', glyph: '▲', color: '#e4535c', price: 34.67 },
	{ ticker: 'LINK', name: 'Chainlink', glyph: '⬡', color: '#3861d8', price: 14.83 },
];

export const defaultInstruments: readonly Instrument[] = (['spot', 'perpetual'] as const).flatMap(type => markets.map(market => ({
	venue: 'binance', market: type, symbol: `${market.ticker}-USDT`,
})));
export const instruments: Instrument[] = defaultInstruments.map(item => ({ ...item }));
export const catalogue: Instrument[] = defaultInstruments.map(item => ({ ...item }));

export function setWatchlistInstruments(next: readonly Instrument[]): void {
	instruments.splice(0, instruments.length, ...next.map(item => ({ ...item })));
}
const tickSizes = new Map<string, number>();
export function registerInstruments(items: InstrumentInfo[]): void {
	for (const { instrument, tickSize } of items) {
		tickSizes.set(instrumentKey(instrument), tickSize);
		if (!catalogue.some(i => instrumentKey(i) === instrumentKey(instrument))) catalogue.push(instrument);
	}
}
export function priceTick(instrument: Instrument): number {
	return tickSizes.get(instrumentKey(instrument)) ?? (marketFor(instrument).price < 1 ? 0.0001 : 0.01);
}
export function marketLabel(instrument: Instrument): string { return instrument.market === 'spot' ? '现货' : '永续'; }
export function symbolLabel(instrument: Instrument): string { return instrument.symbol.replace('-', '') + (instrument.market === 'perpetual' ? '.P' : ''); }
export function marketFor(instrument: Instrument): typeof markets[number] {
	const ticker = instrument.symbol.split('-')[0];
	return markets.find(market => market.ticker === ticker) ?? {
		ticker,
		name: ticker,
		glyph: ticker[0] ?? '?',
		color: fallbackColorForSymbol(ticker),
		price: 0,
	};
}

const loadedIconUrls = new Set<string>();
const resolvedCdnUrls = new Map<string, string>();
const failedCdnSymbols = new Set<string>();

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
	window.addEventListener('online', () => {
		failedCdnSymbols.clear();
	});
}

export function coinBadge(instrument: Instrument): HTMLSpanElement {
	const market = marketFor(instrument);
	const badge = element('span', 'coin-badge');
	badge.style.backgroundColor = market.color;
	badge.setAttribute('aria-hidden', 'true');
	badge.append(element('span', 'coin-badge-fallback', market.glyph));

	const source = resolveCoinIconSources(instrument.symbol);
	let candidates: readonly string[] = [];
	if (source.isLocal) {
		candidates = source.urls;
	} else if (source.symbol && !failedCdnSymbols.has(source.symbol)) {
		const cached = resolvedCdnUrls.get(source.symbol);
		candidates = cached ? [cached] : source.urls;
	}

	if (candidates.length > 0) {
		const img = element('img', 'coin-badge-img');
		img.alt = '';
		img.decoding = 'async';
		img.draggable = false;
		img.loading = source.isLocal ? 'eager' : 'lazy';
		img.referrerPolicy = 'no-referrer';

		let attempt = 0;
		const markLoaded = (url: string): void => {
			loadedIconUrls.add(url);
			if (!source.isLocal) resolvedCdnUrls.set(source.symbol, url);
			badge.classList.add('is-loaded');
		};

		if (loadedIconUrls.has(candidates[0])) {
			badge.classList.add('is-loaded', 'is-instant');
		}
		img.addEventListener('load', () => {
			markLoaded(candidates[attempt] ?? img.src);
		});
		img.addEventListener('error', () => {
			attempt += 1;
			if (attempt < candidates.length) {
				img.src = candidates[attempt];
				return;
			}
			img.remove();
			badge.classList.remove('is-loaded', 'is-instant');
			if (!source.isLocal && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
				failedCdnSymbols.add(source.symbol);
			}
		});
		img.src = candidates[0];
		badge.append(img);
		if (img.complete && img.naturalWidth > 0) markLoaded(candidates[0]);
	}

	return badge;
}

export function formatPrice(value: number): string {
	const magnitude = Math.abs(value);
	const precision = magnitude === 0 ? 4 : magnitude < 1 ? Math.min(10, Math.max(4, Math.ceil(-Math.log10(magnitude)) + 3)) : 2;
	return value.toLocaleString('en-US', { minimumFractionDigits: precision, maximumFractionDigits: precision });
}
