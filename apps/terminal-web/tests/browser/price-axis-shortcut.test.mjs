/* global document, window, localStorage */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import test from 'node:test';
import puppeteer from 'puppeteer';
import { PNG } from 'pngjs';

const baseUrl = process.env.TERMINAL_TEST_URL ?? 'http://127.0.0.1:5173';
const screenshotDir = process.env.TERMINAL_SCREENSHOTS;
const storageKey = 'crypto-terminal.drawings.v1.binance:spot:ETH-USDT';
const shortcut = '.price-axis-shortcut';
const button = '.price-axis-shortcut-button';

test('price-axis shortcut creates a persisted horizontal line without a menu or a drag', { timeout: 90000 }, async () => {
	const browser = await puppeteer.launch({ headless: true });
	try {
		const page = await browser.newPage();
		const errors = []; page.on('pageerror', error => errors.push(error.message));
		await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
		await page.evaluateOnNewDocument(() => {
			window.WebSocket = class extends EventTarget {
				readyState = 0;
				constructor() { super(); setTimeout(() => { this.readyState = 1; this.dispatchEvent(new Event('open')); }, 10); }
				close() { this.readyState = 3; }
			};
		});
		await page.setRequestInterception(true);
		page.on('request', request => {
			const url = new URL(request.url());
			if (!/binance/.test(url.hostname)) { void request.continue(); return; }
			let data;
			if (url.pathname.endsWith('/klines')) {
				const seconds = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 }[url.searchParams.get('interval')] ?? 3600;
				data = url.searchParams.has('endTime') ? [] : Array.from({ length: 500 }, (_, i) => {
					const price = 2000 + Math.sin(i * .16) * 30 + i * .2;
					return [(1700006400 + i * seconds) * 1000, String(price), String(price + 8), String(price - 7), String(price + 3), String(20 + i % 30)];
				});
			} else if (url.pathname.endsWith('/exchangeInfo')) {
				data = { symbols: ['BTC', 'ETH', 'SOL'].map(baseAsset => ({ symbol: `${baseAsset}USDT`, baseAsset, quoteAsset: 'USDT', status: 'TRADING', contractType: 'PERPETUAL', filters: [{ filterType: 'PRICE_FILTER', tickSize: '.01' }] })) };
			} else data = { lastPrice: '2100', priceChange: '30', priceChangePercent: '1.4', highPrice: '2150', lowPrice: '2050', closeTime: 1700006400000 };
			void request.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(data) });
		});
		const clickLabel = label => page.click(`button[aria-label="${label}"]`);
		const ready = () => page.waitForSelector('.drawing-toolbar button:not(:disabled)');
		const readStore = () => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{"documents":[]}'), storageKey);
		const waitSaved = count => page.waitForFunction((key, n) => JSON.parse(localStorage.getItem(key) ?? '{"documents":[]}').documents.filter(d => !d.deleted).length === n, {}, storageKey, count);
		const isHidden = () => page.$eval(shortcut, el => el.hidden);
		const geometry = async () => {
			// The chart's ResizeObserver applies the new viewport dimensions on a frame.
			await page.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
			return page.$eval('.stage-wrap', stage => {
				const bounds = stage.getBoundingClientRect();
				const top = bounds.top + parseFloat(stage.style.getPropertyValue('--main-pane-top'));
				const row = Array.from(stage.querySelectorAll('.chart-stage tr')).map(el => el.getBoundingClientRect()).find(r => r.height > 50 && Math.abs(r.top - top) < 2);
				if (!row) throw new Error('Price pane not found');
				return { x: row.right - 20, y: row.top + row.height * .42, top: row.top, height: row.height, right: row.right, axisWidth: parseFloat(stage.style.getPropertyValue('--price-scale-width')) };
			});
		};
		const hoverAxis = async () => {
			const g = await geometry(); await page.mouse.move(g.x, g.y);
			await page.waitForSelector(`${shortcut}:not([hidden])`); return g;
		};
		const displayedPrice = async () => Number((await page.$eval(button, el => el.getAttribute('aria-label').match(/^在 (.+) 绘制水平线$/)[1])).replaceAll(',', ''));
		const screenshot = async name => {
			if (!screenshotDir) return;
			await mkdir(screenshotDir, { recursive: true });
			await page.evaluate(() => { const badge = document.querySelector('.demo-badge'); if (badge) badge.textContent = 'UI 测试 · 固定行情'; });
			await page.screenshot({ path: `${screenshotDir}/${name}.png` });
		};
		await page.goto(baseUrl); await ready();
		assert.equal(await isHidden(), true);
		// Compare actual axis pixels, not just CSS sizes: DOM and Canvas fonts can
		// differ even with identical font-size declarations, especially on Retina.
		for (const deviceScaleFactor of [1, 2]) {
			await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor });
			const axis = await geometry(); const y = Math.round(axis.y);
			const settle = () => page.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
			await page.mouse.move(axis.right - axis.axisWidth - 160, y); await settle();
			assert.equal(await isHidden(), true);
			const clip = { x: axis.right - axis.axisWidth, y: y - 20, width: axis.axisWidth, height: 40 };
			const native = PNG.sync.read(await page.screenshot({ clip }));
			await screenshot(`price-axis-native-${deviceScaleFactor}x`);
			await page.mouse.move(axis.x, y); await page.waitForSelector(`${shortcut}:not([hidden])`);
			const buttonX = await page.$eval(button, el => { const r = el.getBoundingClientRect(); return r.x + r.width / 2; });
			await page.mouse.move(buttonX, y); await settle();
			const hovered = PNG.sync.read(await page.screenshot({ clip }));
			await screenshot(`price-axis-hovered-${deviceScaleFactor}x`);
			assert.equal(hovered.data.equals(native.data), true, `Price label pixels stay identical at ${deviceScaleFactor}x`);
		}
		await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
		const g = await hoverAxis();
		assert.equal((await readStore()).documents.length, 0, 'Hovering never creates drawings');
		const bounds = await page.$eval(button, el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, height: r.height }; });
		assert.ok(Math.abs(bounds.right - (g.right - g.axisWidth)) < 1, 'Plus sits directly left of the price scale');
		assert.ok(Math.abs(bounds.y + bounds.height / 2 - g.y) < 1, 'Price badge and plus follow the hovered price');
		await screenshot('price-axis-desktop-hover');
		// Small steps stay inside the button yet must update price and position on every move.
		const buttonX = bounds.x + (bounds.right - bounds.x) / 2;
		await page.mouse.move(buttonX, Math.round(g.y));
		let previousPrice = await displayedPrice();
		for (const offset of [2, 4, 6, 8, 6, 4, 2, 0, -2, -4]) {
			const y = Math.round(g.y) + offset;
			assert.ok(await page.evaluate((x, y) => Boolean(document.elementFromPoint(x, y)?.closest('.price-axis-shortcut-button')), buttonX, y));
			await page.mouse.move(buttonX, y);
			const price = await displayedPrice();
			assert.notEqual(price, previousPrice, 'Moving inside the plus updates the price immediately');
			const center = await page.$eval(button, el => { const r = el.getBoundingClientRect(); return r.y + r.height / 2; });
			assert.ok(Math.abs(center - y) < 1, 'The plus follows vertical movement without leaving its hit area');
			previousPrice = price;
		}
		const price = await displayedPrice();
		await page.mouse.down();
		await page.mouse.move(buttonX, Math.round(g.y) - 2);
		assert.equal(await displayedPrice(), price, 'A press holds the chosen price despite small pointer jitter');
		await page.mouse.up(); await waitSaved(1);
		const line = (await readStore()).documents.find(d => !d.deleted);
		assert.equal(line.kind, 'horizontal-line'); assert.equal(line.anchors.length, 1); assert.equal(line.anchors[0].price, price);
		assert.ok(line.anchors[0].time > 1700000000 && line.anchors[0].time < 1800000000, 'Anchor stores UTC seconds');
		assert.equal(Object.hasOwn(line.anchors[0], 'logical'), false);
		assert.equal(await page.$eval('#drawing-tool-menu', el => el.hidden), true);
		assert.equal(await page.$('dialog[open]'), null);
		assert.equal(await isHidden(), true);
		await screenshot('price-axis-desktop-created');
		await clickLabel('撤销画线'); await waitSaved(0); await clickLabel('重做画线'); await waitSaved(1);
		assert.deepEqual((await readStore()).documents.find(d => !d.deleted).anchors, line.anchors);

		// A cancelled click, a scale drag (even returning to its start), or Escape never draws.
		await hoverAxis(); await page.hover(button); await page.mouse.down();
		await page.mouse.move(bounds.x - 100, bounds.y + 80, { steps: 5 }); await page.mouse.up();
		assert.equal(await isHidden(), true); assert.equal((await readStore()).documents.filter(d => !d.deleted).length, 1);
		await hoverAxis(); await page.mouse.down(); await page.mouse.move(g.x, g.y + 60, { steps: 5 }); await page.mouse.up();
		assert.equal(await isHidden(), true);
		await hoverAxis(); await page.keyboard.press('Escape'); assert.equal(await isHidden(), true);
		await hoverAxis(); await page.focus(button); const keyboardPrice = await displayedPrice(); await page.keyboard.press('Enter'); await waitSaved(2);
		assert.equal((await readStore()).documents.filter(d => !d.deleted)[1].anchors[0].price, keyboardPrice);
		await clickLabel('隐藏所有画线'); await page.mouse.move(g.x, g.y + 15); assert.equal(await isHidden(), true); await clickLabel('显示所有画线');
		await page.click('[data-group=lines] > button:first-child'); await page.mouse.move(g.x, g.y); assert.equal(await isHidden(), true); await page.keyboard.press('Escape');

		// Follow the actual price pane when users reorder or maximize panes.
		await page.evaluate(() => document.querySelector('[data-pane=price] button[aria-label^="下移"]').click());
		await page.waitForFunction(() => parseFloat(document.querySelector('.stage-wrap').style.getPropertyValue('--main-pane-top')) > 0);
		const moved = await hoverAxis(); assert.ok(moved.top > g.top + 50);
		await page.mouse.move(moved.x, g.top + 80); assert.equal(await isHidden(), true, 'No price shortcut on MACD scale');
		await page.evaluate(() => document.querySelector('[data-pane=macd] button[aria-label^="最大化"]').click());
		await page.mouse.move(g.x, g.y); assert.equal(await isHidden(), true);
		await page.evaluate(() => document.querySelector('[data-pane=macd] button[aria-label^="还原"]').click());
		await page.evaluate(() => document.querySelector('[data-pane=price] button[aria-label^="上移"]').click());

		// A new session restores canonical prices, and stale controls cannot write into it.
		const anchors = (await readStore()).documents.filter(d => !d.deleted).map(d => d.anchors);
		await hoverAxis(); const staleButton = await page.$(button);
		await clickLabel('周期 4h'); await ready(); await staleButton.evaluate(el => el.click());
		assert.equal(await isHidden(), true); assert.deepEqual((await readStore()).documents.filter(d => !d.deleted).map(d => d.anchors), anchors);
		await clickLabel('打开 BTC-USDT 现货'); await ready(); await hoverAxis(); await page.click(button);
		await page.waitForFunction(() => JSON.parse(localStorage.getItem('crypto-terminal.drawings.v1.binance:spot:BTC-USDT') ?? '{"documents":[]}').documents.filter(d => !d.deleted).length === 1);
		assert.deepEqual((await readStore()).documents.filter(d => !d.deleted).map(d => d.anchors), anchors);
		await clickLabel('打开 ETH-USDT 现货'); await ready(); await page.reload(); await ready();
		assert.deepEqual((await readStore()).documents.filter(d => !d.deleted).map(d => d.anchors), anchors);

		// Touch reveals a large target on an axis tap; dragging or cancelling cannot create a line.
		await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
		await page.click('.mobile-nav-item:last-child');
		const tapAxis = async () => { const axis = await geometry(); await page.touchscreen.tap(axis.x, axis.y); await page.waitForSelector(`${shortcut}:not([hidden])`); return axis; };
		const mobile = await tapAxis();
		assert.equal(await page.$eval(button, el => Number.parseFloat(window.getComputedStyle(el, '::after').width)), 40);
		assert.ok(await page.$eval(shortcut, el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth; }));
		await screenshot('price-axis-mobile-portrait');
		const mobilePrice = await displayedPrice(); await page.tap(button); await waitSaved(3);
		assert.equal((await readStore()).documents.filter(d => !d.deleted).at(-1).anchors[0].price, mobilePrice);
		const client = await page.createCDPSession();
		const touch = (type, points) => client.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y]) => ({ x, y })) });
		await touch('touchStart', [[mobile.x, mobile.y]]); await touch('touchMove', [[mobile.x, mobile.y + 45]]); await touch('touchMove', [[mobile.x, mobile.y]]); await touch('touchEnd', []);
		assert.equal(await isHidden(), true);
		await tapAxis(); const touchBounds = await page.$eval(button, el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
		await touch('touchStart', [[touchBounds.x, touchBounds.y]]); await touch('touchCancel', []); assert.equal(await isHidden(), true);
		await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
		await tapAxis(); await screenshot('price-axis-mobile-landscape');
		assert.ok(await page.$eval(shortcut, el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth; }));
		await page.tap(button); await waitSaved(4);
		assert.deepEqual(errors, []);
	} finally { await browser.close(); }
});
