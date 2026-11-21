/* global document, window, localStorage */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import test from 'node:test';
import puppeteer from 'puppeteer';
import { PNG } from 'pngjs';

const baseUrl = process.env.TERMINAL_TEST_URL ?? 'http://127.0.0.1:5173';
const screenshotDir = process.env.TERMINAL_SCREENSHOTS;
const key = 'crypto-terminal.indicators.v1';

test('indicator legends collapse together, show hovered values, and retain hidden indicators for restoration', { timeout: 90000 }, async () => {
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

		const ready = () => page.waitForSelector('.drawing-toolbar button:not(:disabled)');
		const row = id => `.indicator-legend-row[data-indicator="${id}"]`;
		const values = id => page.$$eval(`${row(id)} .indicator-legend-value`, nodes => nodes.map(n => n.textContent));
		const stored = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
		const settle = () => page.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
		const screenshot = async name => {
			if (!screenshotDir) return;
			await mkdir(screenshotDir, { recursive: true });
			await page.screenshot({ path: `${screenshotDir}/legend-${name}.png` });
		};
		const clickAction = async (id, action) => { await page.hover(row(id)); await page.click(`${row(id)} [data-action=${action}]`); await settle(); };
		await page.goto(baseUrl); await ready();
		assert.equal(await page.$$eval('.indicator-legend-row', rows => rows.length), 4);
		assert.equal((await values('macd')).length, 3);
		assert.ok((await values('macd')).every(value => value !== '—'));
		assert.ok(await page.$eval(`${row('macd')} .indicator-legend-values`, el => el.scrollWidth <= el.clientWidth + 1), 'Desktop MACD values fit without clipping');
		const stage = await page.$eval('.chart-stage', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width }; });
		const latest = await values('macd');
		await page.mouse.move(stage.x + 300, stage.y + 260); await settle();
		assert.notDeepEqual(await values('macd'), latest, 'Legend reads the candle under the crosshair');
		await page.mouse.move(500, 50); await settle();
		assert.deepEqual(await values('macd'), latest, 'Leaving the chart restores the latest candle');
		assert.equal(await page.$eval(`${row('ma')} .indicator-legend-actions`, el => window.getComputedStyle(el).opacity), '0');
		await page.hover(row('ma'));
		assert.equal(await page.$eval(`${row('ma')} .indicator-legend-actions`, el => window.getComputedStyle(el).opacity), '1');
		await screenshot('desktop-expanded');

		await page.click('.indicator-legend .legend-collapse'); await settle();
		assert.equal((await stored()).legendCollapsed, true);
		assert.equal(await page.$eval('.pane-macd', el => el.hidden), true);
		assert.equal(await page.$$eval('.indicator-legend-row', rows => rows.length), 0);
		assert.equal(await page.$eval('.legend-collapse', el => el.textContent), '3');
		await screenshot('desktop-collapsed');
		await page.reload(); await ready();
		assert.equal(await page.$eval('.pane-macd', el => el.hidden), true);
		await page.focus('.legend-collapse'); await page.keyboard.press('Enter'); await settle();
		assert.equal(await page.$eval('.pane-macd', el => el.hidden), false);

		// Hiding preserves pane and configuration, but removes its actual rendered plots.
		const macdPixels = async () => {
			await settle();
			const clip = await page.$eval('.pane-macd', el => {
				const r = el.getBoundingClientRect(); const stage = document.querySelector('.chart-stage').getBoundingClientRect();
				return { x: stage.x + 25, y: r.y + 40, width: stage.width - 150, height: 80 };
			});
			const png = PNG.sync.read(await page.screenshot({ clip }));
			let colored = 0;
			for (let i = 0; i < png.data.length; i += 4) if (Math.max(...png.data.subarray(i, i + 3)) - Math.min(...png.data.subarray(i, i + 3)) > 60) colored++;
			return colored;
		};
		assert.ok(await macdPixels() > 50);
		await clickAction('macd', 'visibility');
		assert.equal((await stored()).enabled.macd, true);
		assert.ok((await stored()).hidden.includes('macd'));
		assert.equal(await page.$eval('.pane-macd', el => el.hidden), false);
		assert.equal(await macdPixels(), 0, 'Hidden MACD plots are absent from the canvas');
		await screenshot('desktop-hidden-macd');
		await clickAction('macd', 'settings');
		const input = 'input[aria-label="MACD 快线周期"]';
		await page.waitForSelector(input);
		await page.$eval(input, el => { el.value = '10'; el.dispatchEvent(new Event('change', { bubbles: true })); });
		await page.keyboard.press('Escape');
		assert.ok(await page.$eval(row('macd'), el => el.classList.contains('is-hidden')));
		assert.match(await page.$eval(`${row('macd')} .indicator-legend-params`, el => el.textContent), /^10 /);
		await page.reload(); await ready();
		assert.ok((await stored()).hidden.includes('macd'));
		await clickAction('macd', 'visibility'); assert.ok(await macdPixels() > 50);
		await clickAction('ma', 'visibility'); assert.equal((await stored()).maEnabled, true);
		await clickAction('ma', 'settings'); await page.waitForSelector('input[aria-label="MA 1 周期"]'); await page.keyboard.press('Escape');
		await clickAction('ma', 'visibility');

		// Layout changes retain the global collapse state and an accessible restore control.
		await page.evaluate(() => document.querySelector('[data-pane=price] button[aria-label^="下移"]').click()); await settle();
		await page.click('.indicator-legend .legend-collapse'); await settle();
		assert.equal(await page.$eval('.pane-macd', el => el.hidden), true);
		await page.evaluate(() => document.querySelector('[data-pane=macd] button[aria-label^="最大化"]').click()); await settle();
		await page.click('.pane-macd .legend-collapse'); await settle();
		assert.ok(await page.$(row('macd')));
		await page.evaluate(() => document.querySelector('[data-pane=macd] button[aria-label^="还原"]').click()); await settle();
		await page.evaluate(() => document.querySelector('[data-pane=price] button[aria-label^="上移"]').click()); await settle();

		for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
			await page.setViewport({ ...viewport, isMobile: true, hasTouch: true });
			await page.click('.mobile-nav-item:last-child'); await settle();
			await screenshot(`mobile-${viewport.width}`);
			assert.ok(await page.$eval(row('ma'), el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth; }));
			assert.equal(await page.$eval(`${row('ma')} .indicator-legend-actions`, el => window.getComputedStyle(el).opacity), '1');
			await page.tap(`${row('ma')} [data-action=visibility]`); await settle();
			await page.tap(`${row('ma')} [data-action=visibility]`); await settle();
			await page.tap(`${row('macd')} [data-action=settings]`);
			await page.waitForSelector('.mobile-sheet[open] input[aria-label="MACD 快线周期"]');
			await page.keyboard.press('Escape'); await settle();
			await page.tap('.indicator-legend .legend-collapse'); await settle();
			assert.equal(await page.$eval('.pane-macd', el => el.hidden), true);
			await screenshot(`mobile-${viewport.width}-collapsed`);
			await page.tap('.indicator-legend .legend-collapse'); await settle();
		}
		assert.deepEqual(errors, []);
	} finally { await browser.close(); }
});
