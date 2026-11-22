import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
	LOCAL_COIN_ICONS,
	WEB3ICONS_CDN_FALLBACK,
	WEB3ICONS_CDN_PRIMARY,
	fallbackColorForSymbol,
	normalizeCoinIconSymbol,
	resolveCoinIconSources,
} from '../src/data/coin-icons';

const iconDir = fileURLToPath(new URL('../public/coin-icons/', import.meta.url));

test('normalizeCoinIconSymbol handles pairs, multiplier prefixes, aliases, and unsafe inputs', () => {
	assert.equal(normalizeCoinIconSymbol('BTC-USDT'), 'BTC');
	assert.equal(normalizeCoinIconSymbol('eth-usdt'), 'ETH');
	assert.equal(normalizeCoinIconSymbol('1000PEPE-USDT'), 'PEPE');
	assert.equal(normalizeCoinIconSymbol('1000SHIB-USDT'), 'SHIB');
	assert.equal(normalizeCoinIconSymbol('1000SATS-USDT'), 'SATS');
	assert.equal(normalizeCoinIconSymbol('1MBABYDOGE-USDT'), 'BABYDOGE');
	assert.equal(normalizeCoinIconSymbol('1000000MOG-USDT'), 'MOG');

	// Genuine digit-prefixed tickers must remain intact.
	assert.equal(normalizeCoinIconSymbol('1INCH-USDT'), '1INCH');
	assert.equal(normalizeCoinIconSymbol('10SET-USDT'), '10SET');

	// Verified Binance-to-web3icons symbol aliases.
	assert.equal(normalizeCoinIconSymbol('RENDER-USDT'), 'RNDR');
	assert.equal(normalizeCoinIconSymbol('BEAMX-USDT'), 'BEAM');
	assert.equal(normalizeCoinIconSymbol('LUNA2-USDT'), 'LUNA');
	assert.equal(normalizeCoinIconSymbol('DODOX-USDT'), 'DODO');

	// Unsafe or malformed symbols are rejected.
	assert.equal(normalizeCoinIconSymbol('../BTC-USDT'), '');
	assert.equal(normalizeCoinIconSymbol('BTC/ETH'), '');
	assert.equal(normalizeCoinIconSymbol('   '), '');
});

test('resolveCoinIconSources prefers local mainstream icons and falls back to web3icons CDN for long-tail coins', () => {
	for (const [input, expected] of [
		['BTC-USDT', 'BTC'],
		['ETH-USDT', 'ETH'],
		['SOL-USDT', 'SOL'],
		['1000PEPE-USDT', 'PEPE'],
		['RENDER-USDT', 'RNDR'],
		['TON-USDT', 'TON'],
		['INJ-USDT', 'INJ'],
	]) {
		const resolved = resolveCoinIconSources(input);
		assert.equal(resolved.symbol, expected);
		assert.equal(resolved.isLocal, true);
		assert.deepEqual(resolved.urls, [`/coin-icons/${expected}.svg`]);
	}

	const subPath = resolveCoinIconSources('BTC-USDT', { baseUrl: '/terminal/' });
	assert.deepEqual(subPath.urls, ['/terminal/coin-icons/BTC.svg']);

	const longTail = resolveCoinIconSources('RARECOIN99-USDT');
	assert.equal(longTail.symbol, 'RARECOIN99');
	assert.equal(longTail.isLocal, false);
	assert.deepEqual(longTail.urls, [
		`${WEB3ICONS_CDN_PRIMARY}/RARECOIN99.svg`,
		`${WEB3ICONS_CDN_FALLBACK}/RARECOIN99.svg`,
	]);

	const custom = resolveCoinIconSources('RARECOIN99-USDT', { cdnBase: 'https://icons.example.com/bg/' });
	assert.equal(custom.isLocal, false);
	assert.deepEqual(custom.urls, ['https://icons.example.com/bg/RARECOIN99.svg']);

	const disabled = resolveCoinIconSources('RARECOIN99-USDT', { cdnBase: 'none' });
	assert.equal(disabled.isLocal, false);
	assert.deepEqual(disabled.urls, []);
});

test('local coin icon files on disk match LOCAL_COIN_ICONS manifest and contain safe valid SVGs', () => {
	const files = readdirSync(iconDir).filter(name => name.endsWith('.svg'));
	const diskSymbols = files.map(name => name.replace(/\.svg$/, '')).sort();
	const manifestSymbols = [...LOCAL_COIN_ICONS].sort();
	assert.deepEqual(diskSymbols, manifestSymbols);

	for (const required of [
		'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'AVAX', 'LINK',
		'TAO', 'SUI', 'LDO', 'HYPE', 'ZEC', 'PEPE',
		'NVDA', 'SPCX', 'GOOGL', 'SNDK', 'MU', 'XAU', 'XAG',
	]) {
		assert.equal(LOCAL_COIN_ICONS.has(required), true, `Missing local coin icon: ${required}`);
	}

	for (const ticker of [
		'BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'BNB-USDT', 'XRP-USDT',
		'TAO-USDT', 'SUI-USDT', 'LDO-USDT', 'HYPE-USDT', 'ZEC-USDT',
		'1000PEPE-USDT', 'NVDA-USDT', 'SPCX-USDT', 'GOOGL-USDT',
		'SNDK-USDT', 'MU-USDT', 'XAU-USDT', 'XAG-USDT',
	]) {
		assert.equal(resolveCoinIconSources(ticker).isLocal, true, `Expected ${ticker} to resolve locally`);
	}

	const taoSvg = readFileSync(join(iconDir, 'TAO.svg'), 'utf8');
	assert.equal(taoSvg.includes('#000'), true, 'TAO.svg must be Bittensor black-background emblem');
	assert.equal(taoSvg.includes('#EA302A'), false, 'TAO.svg must not be the unrelated red TaoDAO flower');

	for (const file of files) {
		const svg = readFileSync(join(iconDir, file), 'utf8').trim();
		assert.equal(svg.startsWith('<svg'), true, `${file} must start with <svg`);
		assert.equal(svg.endsWith('</svg>'), true, `${file} must end with </svg>`);
		assert.equal(/<script/i.test(svg), false, `${file} must not contain <script`);
		assert.equal(/javascript:/i.test(svg), false, `${file} must not contain javascript:`);
	}
});

test('fallbackColorForSymbol returns deterministic 6-digit hex colors', () => {
	const a1 = fallbackColorForSymbol('WIF-USDT');
	const a2 = fallbackColorForSymbol('wif');
	const b = fallbackColorForSymbol('BONK-USDT');
	assert.match(a1, /^#[0-9a-f]{6}$/);
	assert.equal(a1, a2);
	assert.match(b, /^#[0-9a-f]{6}$/);
});
