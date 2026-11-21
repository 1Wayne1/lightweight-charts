import { instrumentKey, type Instrument, type InstrumentInfo } from '@terminal/domain';
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

export const instruments: Instrument[] = (['spot', 'perpetual'] as const).flatMap(type => markets.map(market => ({
	venue: 'binance', market: type, symbol: `${market.ticker}-USDT`,
})));
export const catalogue: Instrument[] = [...instruments];
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
	return markets.find(market => market.ticker === ticker) ?? { ticker, name: ticker, glyph: ticker[0], color: '#536b98', price: 0 };
}

export function coinBadge(instrument: Instrument): HTMLSpanElement {
	const market = marketFor(instrument);
	const badge = element('span', 'coin-badge', market.glyph);
	badge.style.backgroundColor = market.color;
	badge.setAttribute('aria-hidden', 'true');
	return badge;
}

export function formatPrice(value: number): string {
	const magnitude = Math.abs(value);
	const precision = magnitude === 0 ? 4 : magnitude < 1 ? Math.min(10, Math.max(4, Math.ceil(-Math.log10(magnitude)) + 3)) : 2;
	return value.toLocaleString('en-US', { minimumFractionDigits: precision, maximumFractionDigits: precision });
}
