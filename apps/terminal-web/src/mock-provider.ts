import { TIMEFRAME_SECONDS, type MarketDataProvider } from '@terminal/domain';
import { marketFor } from './markets';

/** Explicit demo source; replace through MarketDataProvider when adding an exchange. */
export const mockProvider: MarketDataProvider = {
	getCandles(instrument, timeframe, signal) {
		signal?.throwIfAborted();
		const step = TIMEFRAME_SECONDS[timeframe];
		const end = Math.floor(Date.now() / 1000 / step) * step;
		const base = marketFor(instrument).price;
		let seed = [...instrument.symbol].reduce((sum, character) => sum + character.charCodeAt(0), 0);
		const random = (): number => {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
			return seed / 4294967296;
		};
		let previous = base * 1.08;
		const candles = Array.from({ length: 280 }, (_, index) => {
			const open = previous;
			const close = open + base * ((random() - 0.49) * 0.009 + Math.sin(index / 18) * 0.001 - 0.00035);
			previous = close;
			return {
				time: end - (279 - index) * step,
				open, close, volume: 500 + random() * 1000,
				high: Math.max(open, close) + base * random() * 0.003,
				low: Math.min(open, close) - base * random() * 0.003,
			};
		});
		const factor = base / previous;
		return Promise.resolve(candles.map(candle => ({
			...candle, open: candle.open * factor, high: candle.high * factor,
			low: candle.low * factor, close: candle.close * factor,
		})));
	},
};
