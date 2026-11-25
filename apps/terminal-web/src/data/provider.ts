import type { CandleEvent, Instrument, InstrumentInfo, MarketDataProvider, MarketQuote, StreamObserver, Timeframe } from '@terminal/domain';

export type Market = Instrument['market'];

export interface MarketFeedProvider extends MarketDataProvider {
	readonly id: string;
	readonly venue: string;
	readonly label: string;
	readonly protocol: 'binance' | 'generic';
	readonly maxCandleLimit: number;
	readonly realtime: boolean;
	getInstruments(market: Market, signal?: AbortSignal): Promise<InstrumentInfo[]>;
	getQuote(instrument: Instrument, signal?: AbortSignal): Promise<MarketQuote>;
	getQuotes?(instruments: Instrument[], signal?: AbortSignal): Promise<Map<string, MarketQuote>>;
	subscribeCandles(instrument: Instrument, timeframe: Timeframe, observer: StreamObserver<CandleEvent>): () => void;
	subscribeQuotes(instruments: Instrument[], observer: StreamObserver<{ instrument: Instrument; quote: MarketQuote }>): () => void;
}

export type ProviderResolver = (venue: string) => MarketFeedProvider | undefined;
