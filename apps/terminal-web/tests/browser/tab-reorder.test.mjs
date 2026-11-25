/* global document, window, localStorage, PointerEvent */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import test from 'node:test';
import puppeteer from 'puppeteer';

const baseUrl = process.env.TERMINAL_TEST_URL ?? 'http://127.0.0.1:5173';
const screenshotDir = process.env.TERMINAL_SCREENSHOTS;
const storageKey = 'crypto-terminal.workspace.v1';
const key = symbol => `binance:spot:${symbol}-USDT`;
const tab = symbol => `.tab[data-tab-id="${key(symbol)}"]`;
const focus = symbol => `${tab(symbol)} .tab-focus`;

async function setup(page, symbols, width = 1440) {
	await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
	await page.evaluateOnNewDocument((storageKey, symbols) => {
		if (!localStorage.getItem(storageKey)) {
			const tabs = symbols.map(symbol => ({ id: `binance:spot:${symbol}-USDT`, instrumentKey: `binance:spot:${symbol}-USDT` }));
			const preferences = Object.fromEntries(symbols.map((symbol, index) => [`binance:spot:${symbol}-USDT`, {
				instrument: { venue: 'binance', market: 'spot', symbol: `${symbol}-USDT` }, timeframe: ['4h', '15m', '1h'][index % 3],
			}]));
			localStorage.setItem(storageKey, JSON.stringify({ schemaVersion: 1, tabs, activeTabId: tabs[1].id, preferences }));
		}
		window.WebSocket = class extends EventTarget {
			readyState = 0;
			constructor() { super(); setTimeout(() => { this.readyState = 1; this.dispatchEvent(new Event('open')); }, 10); }
			close() { this.readyState = 3; }
		};
	}, storageKey, symbols);
	await page.setRequestInterception(true);
	page.on('request', request => {
		const url = new URL(request.url());
		if (!/binance/.test(url.hostname)) { void request.continue(); return; }
		let data;
		if (url.pathname.endsWith('/klines')) {
			const seconds = { '15m': 900, '1h': 3600, '4h': 14400 }[url.searchParams.get('interval')] ?? 3600;
			data = url.searchParams.has('endTime') ? [] : Array.from({ length: 500 }, (_, i) => {
				const price = 2000 + Math.sin(i * .16) * 30 + i * .2;
				return [(1700006400 + i * seconds) * 1000, String(price), String(price + 8), String(price - 7), String(price + 3), String(20 + i % 30)];
			});
		} else if (url.pathname.endsWith('/exchangeInfo')) {
			data = { symbols: symbols.map(baseAsset => ({ symbol: `${baseAsset}USDT`, baseAsset, quoteAsset: 'USDT', status: 'TRADING', contractType: 'PERPETUAL', filters: [{ filterType: 'PRICE_FILTER', tickSize: '.01' }] })) };
		} else data = { lastPrice: '2100', priceChange: '30', priceChangePercent: '1.4', highPrice: '2150', lowPrice: '2050', closeTime: 1700006400000 };
		void request.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(data) });
	});
	await page.goto(baseUrl);
	await page.waitForSelector('.drawing-toolbar button:not(:disabled)');
}

const readState = page => page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey)), storageKey);
const order = page => page.$$eval('.tabs .tab', nodes => nodes.map(node => node.dataset.tabId));
const bounds = (page, selector) => page.$eval(selector, el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right }; });
const screenshot = async (page, name) => {
	if (!screenshotDir) return;
	await mkdir(screenshotDir, { recursive: true });
	await page.evaluate(() => { document.querySelector('.demo-badge').textContent = 'UI 测试 · 固定行情'; });
	await page.screenshot({ path: `${screenshotDir}/${name}.png` });
};

async function startDrag(page, from, to, after = true) {
	await page.waitForFunction(() => document.querySelector('.tabs').getAnimations({ subtree: true }).length === 0);
	const source = await bounds(page, focus(from));
	const target = await bounds(page, tab(to));
	await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
	await page.mouse.down();
	await page.mouse.move(after ? target.right - 12 : target.x + 12, target.y + target.height / 2, { steps: 12 });
	await page.waitForSelector('.tabs.is-reordering');
}

test('tab dragging commits on release, preserves chart and preferences, and supports cancellation and keyboard ordering', { timeout: 60000 }, async () => {
	const browser = await puppeteer.launch({ headless: true });
	try {
		const page = await browser.newPage();
		const errors = []; page.on('pageerror', error => errors.push(error.message));
		await setup(page, ['BTC', 'ETH', 'SOL']);
		// Keep a real drawing and live chart instance across tab-only updates.
		await page.click('[aria-label="展开趋势线工具"]');
		await page.click('#drawing-tool-menu [data-tool="horizontal-line"]');
		const stage = await bounds(page, '.chart-stage');
		await page.mouse.click(stage.x + 300, stage.y + 260);
		const drawingKey = 'crypto-terminal.drawings.v1.binance:spot:ETH-USDT';
		await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) ?? '{"documents":[]}').documents.length === 1, {}, drawingKey);
		await page.keyboard.press('Escape');
		const drawingBefore = await page.evaluate(key => localStorage.getItem(key), drawingKey);
		const chartCanvas = await page.$('.chart-stage canvas');
		const original = await readState(page);
		await startDrag(page, 'BTC', 'SOL');
		assert.deepEqual(await readState(page), original, 'Preview does not persist or switch charts');
		await screenshot(page, 'tabs-drag-preview');
		await page.mouse.up();
		assert.deepEqual(await order(page), ['ETH', 'SOL', 'BTC'].map(key));
		assert.equal((await readState(page)).activeTabId, key('ETH'), 'Dragging an inactive tab does not activate it');
		assert.deepEqual((await readState(page)).preferences, original.preferences);
		assert.equal(await chartCanvas.evaluate(el => el.isConnected), true, 'Reorder preserves the chart instance and viewport');
		assert.equal(await page.evaluate(key => localStorage.getItem(key), drawingKey), drawingBefore);
		await startDrag(page, 'ETH', 'BTC'); await page.mouse.up();
		assert.deepEqual(await order(page), ['SOL', 'BTC', 'ETH'].map(key));
		assert.equal((await readState(page)).activeTabId, key('ETH'));
		await startDrag(page, 'ETH', 'SOL', false); await page.mouse.up();
		assert.deepEqual(await order(page), ['ETH', 'SOL', 'BTC'].map(key));
		const stable = await readState(page);
		for (const cancel of ['escape', 'outside', 'pointercancel']) {
			await startDrag(page, 'BTC', 'ETH', false);
			if (cancel === 'escape') await page.keyboard.press('Escape');
			if (cancel === 'outside') await page.mouse.move(350, 180);
			if (cancel === 'pointercancel') await page.$eval('.tabs', el => el.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true })));
			await page.mouse.up();
			assert.deepEqual(await readState(page), stable, `${cancel} leaves state untouched`);
			assert.equal(await page.$('.tabs.is-reordering'), null);
		}
		await page.focus(focus('BTC'));
		await page.keyboard.down('Alt'); await page.keyboard.press('ArrowLeft'); await page.keyboard.up('Alt');
		assert.deepEqual(await order(page), ['ETH', 'BTC', 'SOL'].map(key));
		assert.equal(await page.$eval(focus('BTC'), el => el === document.activeElement), true);
		assert.equal((await readState(page)).activeTabId, key('ETH'));
		assert.equal(await chartCanvas.evaluate(el => el.isConnected), true);
		await screenshot(page, 'tabs-reordered-desktop');
		await page.reload(); await page.waitForSelector('.drawing-toolbar button:not(:disabled)');
		assert.deepEqual(await order(page), ['ETH', 'BTC', 'SOL'].map(key));
		assert.deepEqual((await readState(page)).preferences, original.preferences);
		assert.equal(await page.evaluate(key => localStorage.getItem(key), drawingKey), drawingBefore);
		// A short click still switches charts; close and duplicate-open keep their original behavior.
		await page.click(focus('BTC'));
		assert.equal((await readState(page)).activeTabId, key('BTC'));
		assert.equal(await page.$eval(`${tab('BTC')} .tab-period`, el => el.textContent), '4h');
		await page.click('[aria-label="打开 BTC-USDT 现货"]');
		assert.deepEqual(await order(page), ['ETH', 'BTC', 'SOL'].map(key));
		await page.click(`${tab('BTC')} .tab-close`);
		assert.deepEqual(await order(page), ['ETH', 'SOL'].map(key));
		await page.click('[aria-label="打开 BTC-USDT 现货"]');
		assert.deepEqual(await order(page), ['ETH', 'SOL', 'BTC'].map(key));
		assert.equal(await page.$eval(`${tab('BTC')} .tab-period`, el => el.textContent), '4h');
		for (const [width, height] of [[390, 844], [844, 390]]) {
			await page.setViewport({ width, height, isMobile: true, hasTouch: true });
			await page.waitForFunction(() => window.getComputedStyle(document.querySelector('.tabstrip')).display === 'none');
			assert.equal(await page.$('.tabs.is-reordering'), null);
			assert.deepEqual(await order(page), ['ETH', 'SOL', 'BTC'].map(key));
			await screenshot(page, `tabs-mobile-${width}`);
		}
		assert.deepEqual(errors, []);
	} finally { await browser.close(); }
});

test('neighbors slide aside smoothly in both directions, settle on drop, and animate back on cancel', { timeout: 60000 }, async () => {
	const browser = await puppeteer.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await setup(page, ['BTC', 'ETH', 'SOL']);
		// Unequal widths exercise the actual vacated slot, not a fixed tab-width assumption.
		await page.$eval(tab('ETH'), el => { el.style.width = '210px'; });
		const original = await readState(page);
		const source = await bounds(page, focus('ETH'));
		const eth = await bounds(page, tab('ETH'));
		const btc = await bounds(page, tab('BTC'));
		await page.mouse.move(source.x + source.width / 2, source.y + 20); await page.mouse.down();
		await page.mouse.move(btc.x + btc.width / 2 - 8, source.y + 20);
		await page.waitForFunction(selector => document.querySelector(selector).getAnimations().length > 0, {}, tab('BTC'));
		// Sample the real rendered transition at its midpoint, then let it finish.
		await page.$eval(tab('BTC'), el => {
			const animation = el.getAnimations()[0]; animation.pause(); animation.currentTime = 90;
		});
		const during = await bounds(page, tab('BTC'));
		assert.ok(during.x > btc.x + 1 && during.x < btc.x + eth.width - 1, 'Left neighbor visibly moves right through intermediate positions');
		await screenshot(page, 'tabs-neighbor-mid-animation');
		await page.$eval(tab('BTC'), el => el.getAnimations()[0].play());
		await page.waitForFunction((selector, x) => Math.abs(document.querySelector(selector).getBoundingClientRect().x - x) < .5, {}, tab('BTC'), btc.x + eth.width);
		// Stable original-slot thresholds keep this target even though BTC has moved to the right.
		await page.mouse.move(btc.x + btc.width / 2 - 7, source.y + 20);
		assert.equal(await page.$eval(tab('BTC'), el => el.style.transform), `translateX(${eth.width}px)`);
		assert.deepEqual(await readState(page), original);
		await page.keyboard.press('Escape'); await page.mouse.up();
		await page.waitForFunction(() => document.querySelector('.tabs').getAnimations({ subtree: true }).length === 0);
		assert.ok(Math.abs((await bounds(page, tab('BTC'))).x - btc.x) < .5);
		assert.deepEqual(await readState(page), original);
		assert.equal(await page.$eval(tab('BTC'), el => el.style.transform), '');
		await startDrag(page, 'ETH', 'BTC', false);
		await page.mouse.up();
		assert.deepEqual(await order(page), ['ETH', 'BTC', 'SOL'].map(key));
		await page.waitForFunction(() => document.querySelector('.tabs').getAnimations({ subtree: true }).length === 0);
		const nextBtc = await bounds(page, tab('BTC'));
		const nextEth = await bounds(page, tab('ETH'));
		await startDrag(page, 'ETH', 'BTC');
		await page.waitForFunction((selector, x) => Math.abs(document.querySelector(selector).getBoundingClientRect().x - x) < .5, {}, tab('BTC'), nextBtc.x - nextEth.width);
		await screenshot(page, 'tabs-neighbor-shift-left');
		await page.mouse.up();
		assert.deepEqual(await order(page), ['BTC', 'ETH', 'SOL'].map(key));
		await page.waitForFunction(() => document.querySelector('.tabs').getAnimations({ subtree: true }).length === 0);
		assert.equal((await readState(page)).activeTabId, key('ETH'));
		await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
		await startDrag(page, 'ETH', 'BTC', false);
		assert.equal(await page.$eval('.tabs', el => el.getAnimations({ subtree: true }).length), 0);
		await page.keyboard.press('Escape'); await page.mouse.up();
		assert.equal(await page.$eval('.tabs', el => el.getAnimations({ subtree: true }).length), 0);
		assert.deepEqual(await order(page), ['BTC', 'ETH', 'SOL'].map(key));
	} finally { await browser.close(); }
});

test('overflowing tab strip auto-scrolls during drag and keeps the add button reachable', { timeout: 60000 }, async () => {
	const browser = await puppeteer.launch({ headless: true });
	try {
		const page = await browser.newPage();
		const symbols = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'AVAX', 'DOGE', 'LINK'];
		await setup(page, symbols, 1100);
		const viewport = await bounds(page, '.tabs');
		const source = await bounds(page, focus('BTC'));
		await page.mouse.move(source.x + 40, source.y + 20); await page.mouse.down();
		await page.mouse.move(viewport.right - 2, source.y + 20, { steps: 12 });
		await page.waitForFunction(() => { const el = document.querySelector('.tabs'); return el.scrollLeft >= el.scrollWidth - el.clientWidth - 2; });
		await screenshot(page, 'tabs-drag-overflow');
		await page.mouse.up();
		assert.deepEqual(await order(page), [...symbols.slice(1), 'BTC'].map(key));
		assert.equal((await readState(page)).activeTabId, key('ETH'));
		// Move all the way back to the first slot using left-edge scrolling.
		await page.waitForFunction(() => document.querySelector('.tabs').getAnimations({ subtree: true }).length === 0);
		const moved = await bounds(page, focus('BTC'));
		await page.mouse.move(moved.x + moved.width / 2, moved.y + 20); await page.mouse.down();
		await page.mouse.move(viewport.x + 2, moved.y + 20, { steps: 12 });
		await page.waitForFunction(() => document.querySelector('.tabs').scrollLeft <= 1);
		await page.mouse.up();
		assert.deepEqual(await order(page), symbols.map(key));
		const add = await bounds(page, '.add-tab');
		assert.ok(add.x >= 0 && add.right <= 1100);
		await page.click('.add-tab');
		assert.ok(await page.$('dialog[open]'));
	} finally { await browser.close(); }
});
