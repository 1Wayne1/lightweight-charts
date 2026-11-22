export const WEB3ICONS_CDN_PRIMARY = 'https://cdn.jsdelivr.net/gh/0xa3k5/web3icons@main/packages/core/src/svgs/tokens/background';
export const WEB3ICONS_CDN_FALLBACK = 'https://cdn.jsdelivr.net/gh/0xa3k5/web3icons@main/raw-svgs/tokens/background';

export const LOCAL_COIN_ICONS: ReadonlySet<string> = new Set([
	'1INCH', 'AAVE', 'ACH', 'ACT', 'ACX', 'ADA', 'AI', 'ALGO', 'ALICE', 'APE',
	'APT', 'AR', 'ARB', 'ATOM', 'AUDIO', 'AVAX', 'AXS', 'BAT', 'BCH', 'BEAM',
	'BLUR', 'BNB', 'BTC', 'CAKE', 'CELO', 'CETUS', 'CFX', 'CHZ', 'CKB', 'COMP',
	'COW', 'CRV', 'CTSI', 'CYBER', 'DAI', 'DASH', 'DGB', 'DODO', 'DOGE', 'DOT',
	'DYDX', 'EDU', 'EGLD', 'ENJ', 'ENS', 'EOS', 'ETC', 'ETH', 'FDUSD', 'FET',
	'FIL', 'FLOW', 'FTM', 'FXS', 'GALA', 'GLM', 'GLMR', 'GMX', 'GNS', 'GOOGL',
	'GRT', 'HBAR', 'HFT', 'HIVE', 'HOOK', 'HOT', 'HYPE', 'ICP', 'ICX', 'ID',
	'ILV', 'IMX', 'INJ', 'IOTA', 'JASMY', 'JOE', 'JUP', 'KAS', 'KAVA', 'KNC',
	'KSM', 'LDO', 'LINK', 'LPT', 'LQTY', 'LRC', 'LSK', 'LTC', 'LUNA', 'LUNC',
	'MANA', 'MASK', 'MATIC', 'MAV', 'MEME', 'METIS', 'MINA', 'MKR', 'MOVE', 'MOVR',
	'MU', 'NEAR', 'NEO', 'NVDA', 'OM', 'ONE', 'ONT', 'OP', 'ORDI', 'PENDLE',
	'PEOPLE', 'PEPE', 'PERP', 'PIXEL', 'POL', 'PORTAL', 'PYTH', 'QNT', 'QTUM', 'RDNT',
	'RLC', 'RNDR', 'ROSE', 'RUNE', 'RVN', 'SAND', 'SATS', 'SC', 'SCRT', 'SEI',
	'SHIB', 'SLP', 'SNDK', 'SNX', 'SOL', 'SPCX', 'SPELL', 'SSV', 'STEEM', 'STORJ',
	'STRK', 'STX', 'SUI', 'SUSHI', 'SYS', 'TAO', 'THETA', 'TIA', 'TLM', 'TON',
	'TRU', 'TRX', 'TUSD', 'UMA', 'UNI', 'USDC', 'USDT', 'USTC', 'VET', 'WAVES',
	'XAG', 'XAU', 'XLM', 'XMR', 'XRP', 'XTZ', 'YFI', 'YGG', 'ZEC', 'ZIL',
	'ZRX',
]);

export const COIN_ICON_ALIASES: Readonly<Record<string, string>> = {
	RENDER: 'RNDR',
	BEAMX: 'BEAM',
	LUNA2: 'LUNA',
	DODOX: 'DODO',
};

export interface CoinIconSources {
	symbol: string;
	isLocal: boolean;
	urls: readonly string[];
}

export interface CoinIconResolveOptions {
	baseUrl?: string;
	cdnBase?: string;
}

const MULTIPLIER_PREFIX = /^(?:1000000|10000|1000|1M)([A-Z][A-Z0-9]+)$/;
const VALID_SYMBOL = /^[A-Z0-9]{1,20}$/;

const FALLBACK_PALETTE: readonly string[] = [
	'#3861d8', '#2579c2', '#0b8a7d', '#2b8a5a', '#6857d9', '#8b4ed1',
	'#b8518b', '#c94c4c', '#c96f32', '#b08624', '#4d6791', '#3f7688',
];

/** Normalizes a trading pair or base ticker into an uppercase web3icons token symbol. */
export function normalizeCoinIconSymbol(symbolOrBase: string): string {
	const raw = symbolOrBase.split('-')[0].trim().toUpperCase();
	if (!raw) return '';
	const match = MULTIPLIER_PREFIX.exec(raw);
	const stripped = match ? match[1] : raw;
	const mapped = COIN_ICON_ALIASES[stripped] ?? stripped;
	return VALID_SYMBOL.test(mapped) ? mapped : '';
}

/** Resolves ordered local or CDN icon URLs for a trading pair or base asset symbol. */
export function resolveCoinIconSources(symbolOrBase: string, options?: CoinIconResolveOptions): CoinIconSources {
	const symbol = normalizeCoinIconSymbol(symbolOrBase);
	if (!symbol) return { symbol: '', isLocal: false, urls: [] };
	const env = (import.meta as unknown as { env?: Partial<ImportMetaEnv> & { readonly BASE_URL?: string } }).env;
	if (LOCAL_COIN_ICONS.has(symbol)) {
		const base = (options?.baseUrl ?? env?.BASE_URL ?? '/').replace(/\/?$/, '/');
		return { symbol, isLocal: true, urls: [`${base}coin-icons/${symbol}.svg`] };
	}
	const customCdn = (options?.cdnBase ?? env?.VITE_COIN_ICON_CDN_BASE ?? '').trim();
	if (customCdn === 'none' || customCdn === 'off') return { symbol, isLocal: false, urls: [] };
	if (customCdn) {
		return { symbol, isLocal: false, urls: [`${customCdn.replace(/\/$/, '')}/${symbol}.svg`] };
	}
	return {
		symbol,
		isLocal: false,
		urls: [`${WEB3ICONS_CDN_PRIMARY}/${symbol}.svg`, `${WEB3ICONS_CDN_FALLBACK}/${symbol}.svg`],
	};
}

/** Returns a deterministic high-contrast badge color for symbols without a loaded SVG icon. */
export function fallbackColorForSymbol(symbol: string): string {
	const normalized = normalizeCoinIconSymbol(symbol) || symbol.trim().toUpperCase();
	let hash = 2166136261;
	for (let i = 0; i < normalized.length; i++) {
		hash ^= normalized.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return FALLBACK_PALETTE[(hash >>> 0) % FALLBACK_PALETTE.length];
}
