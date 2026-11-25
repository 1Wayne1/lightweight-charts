/* global document, window, localStorage, KeyboardEvent */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import test from 'node:test';
import puppeteer from 'puppeteer';

// Run against a local Vite server. Interception is confined to this isolated test browser.
const baseUrl = process.env.TERMINAL_TEST_URL ?? 'http://127.0.0.1:5173';
const screenshotDir = process.env.TERMINAL_SCREENSHOTS;
const storageKey = 'crypto-terminal.drawings.v1.binance:spot:ETH-USDT';
const menu = '#drawing-tool-menu';

test('grouped toolbar, drawing controls, persistence and responsive menus', { timeout: 90000 }, async () => {
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
		const readStore = () => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{"documents":[]}'), storageKey);
		const waitSaved = count => page.waitForFunction((key, n) => JSON.parse(localStorage.getItem(key) ?? '{"documents":[]}').documents.filter(d => !d.deleted).length === n, {}, storageKey, count);
		const screenshot = async name => {
			if (!screenshotDir) return;
			await mkdir(screenshotDir, { recursive: true });
			await page.evaluate(() => { const badge = document.querySelector('.demo-badge'); if (badge) badge.textContent = 'UI 测试 · 固定行情'; });
			await page.screenshot({ path: `${screenshotDir}/${name}.png` });
		};
		const drawLine = async (y, endY = y) => {
			const bounds = await page.$eval('.chart-stage', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y }; });
			await page.mouse.move(bounds.x + 280, bounds.y + y); await page.mouse.down();
			await page.mouse.move(bounds.x + 480, bounds.y + endY, { steps: 8 }); await page.mouse.up();
		};
		const checkAlignment = async () => {
			const { center, icons } = await page.$eval('.drawing-rail', rail => {
				const bounds = rail.getBoundingClientRect();
				return {
					center: bounds.x + rail.clientWidth / 2,
					icons: Array.from(rail.querySelectorAll('.drawing-rail-button:not(.drawing-group-expand) > .drawing-icon')).map(icon => {
						const rect = icon.getBoundingClientRect(); return { center: rect.x + rect.width / 2, inset: rect.x - bounds.x };
					}),
				};
			});
			assert.equal(icons.length, 15);
			assert.ok(icons.every(icon => Math.abs(icon.center - center) < .5 && icon.inset >= 8), 'Grouped and standalone icons share the rail center and left padding');
		};
		await page.goto(baseUrl); await page.waitForSelector('.drawing-toolbar button:not(:disabled)');
		assert.equal(await page.$$eval('.drawing-tool-slot[data-group]', nodes => nodes.length), 8);
		await checkAlignment();
		const primary = '[data-group=lines] > button:first-child';
		const expand = '[data-group=lines] > .drawing-group-expand';
		const arrowOpacity = () => page.$eval(expand, el => window.getComputedStyle(el).opacity);
		assert.equal(await arrowOpacity(), '0');
		await page.hover(primary); assert.equal(await arrowOpacity(), '1');
		await page.hover(expand); assert.equal(await arrowOpacity(), '1');
		await page.mouse.move(500, 100); assert.equal(await arrowOpacity(), '0');

		// The main icon selects, opens, then closes without losing the displayed tool.
		const defaultIcon = await page.$eval(`${primary} .drawing-icon`, el => el.innerHTML);
		await page.click(primary);
		assert.equal(await page.$eval(menu, el => el.hidden), true);
		assert.equal(await page.$eval(primary, el => el.getAttribute('aria-pressed')), 'true');
		await page.click(primary);
		assert.equal(await page.$eval(menu, el => el.hidden), false);
		assert.equal(await page.$eval(primary, el => el.getAttribute('aria-expanded')), 'true');
		assert.equal(await page.$eval(expand, el => el.getAttribute('aria-expanded')), 'true');
		await page.click(primary);
		assert.equal(await page.$eval(menu, el => el.hidden), true);
		assert.equal(await page.$eval(primary, el => el.getAttribute('aria-expanded')), 'false');
		assert.equal(await page.$eval(primary, el => el.getAttribute('aria-pressed')), 'true');
		await page.mouse.move(500, 100); assert.equal(await arrowOpacity(), '0');

		// Keyboard users can reveal and operate the same menu without a pointer.
		await page.keyboard.press('Tab');
		assert.equal(await arrowOpacity(), '1');
		await page.focus(primary); await page.keyboard.press('Enter');
		assert.equal(await page.$eval(menu, el => el.hidden), false);
		await page.keyboard.press('Escape');
		assert.equal(await page.$eval(primary, el => el === document.activeElement), true);
		await clickLabel('展开趋势线工具');
		assert.deepEqual(await page.$$eval(`${menu} .drawing-menu-heading`, nodes => nodes.map(n => n.textContent)), ['线条', '通道', '分叉线']);
		assert.equal(await page.$eval(menu, el => el.getAttribute('role')), 'menu');
		await screenshot('desktop-lines');
		await page.click(`${menu} [data-tool="horizontal-line"]`);
		assert.equal(await page.$eval('[data-group=lines] > button:first-child', el => el.dataset.tool), 'horizontal-line');
		assert.notEqual(await page.$eval(`${primary} .drawing-icon`, el => el.innerHTML), defaultIcon);
		await page.click(primary); assert.equal(await page.$eval(menu, el => el.hidden), false);
		await page.click(primary); assert.equal(await page.$eval(menu, el => el.hidden), true);
		assert.equal(await page.$eval(primary, el => el.dataset.tool), 'horizontal-line');
		assert.equal(await page.$eval('.drawing-editbar', el => el.hidden), false);
		await drawLine(240); await waitSaved(1);
		assert.equal((await readStore()).documents[0].kind, 'horizontal-line');
		assert.equal(await page.$eval('.drawing-editbar', el => el.hidden), false);
		await page.keyboard.press('Escape');
		assert.equal(await page.$eval('.drawing-editbar', el => el.hidden), true);
		await clickLabel('展开趋势线工具'); await page.click(`${menu} [data-tool="trend-line"]`);
		await drawLine(330, 270); await waitSaved(2);
		const anchors = (await readStore()).documents.map(d => d.anchors);

		// Object toolbar controls are tool-specific; quick edits use the same undo history.
		const prop = '.drawing-properties-dialog';
		const popover = '.drawing-property-popover';
		const setInput = (selector, value) => page.$eval(selector, (input, next) => { input.value = next; input.dispatchEvent(new Event('input', { bubbles: true })); }, String(value));
		assert.equal(await page.$('.drawing-editbar [aria-label="填充颜色"]'), null);
		await clickLabel('线条颜色'); await screenshot('desktop-color-palette');
		await clickLabel('颜色 #089981');
		await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).documents[1].style.color === '#089981', {}, storageKey);
		await clickLabel('线宽'); await clickLabel('线宽 4px');
		await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).documents[1].style.lineWidth === 4, {}, storageKey);
		await clickLabel('线型'); await page.keyboard.press('Escape');
		assert.equal(await page.$(popover), null); assert.equal(await page.$eval('.drawing-editbar', el => el.hidden), false);
		await screenshot('desktop-object-toolbar');
		const grip = await page.$eval('.drawing-bar-grip', el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
		const oldBarX = await page.$eval('.drawing-editbar', el => el.getBoundingClientRect().x);
		await page.mouse.move(grip.x, grip.y); await page.mouse.down(); await page.mouse.move(grip.x + 100, grip.y + 25, { steps: 5 }); await page.mouse.up();
		assert.ok(await page.$eval('.drawing-editbar', el => el.getBoundingClientRect().x) > oldBarX + 90);
		await clickLabel('绘图设置');
		assert.deepEqual(await page.$$eval(`${prop} [role=tab]`, nodes => nodes.map(n => n.textContent)), ['样式', '文字', '坐标', '可见性']);
		await setInput(`${prop} [data-field=lineWidth]`, 7);
		await clickLabel('关闭绘图设置');
		assert.equal((await readStore()).documents[1].style.lineWidth, 4, 'Closing settings discards the draft');
		await clickLabel('绘图设置'); await setInput(`${prop} [data-field=lineWidth]`, 6);
		await page.click('#drawing-tab-coordinates');
		await setInput('[aria-label="锚点 2 价格"]', anchors[1][1].price + 10);
		await screenshot('desktop-coordinates');
		await page.click(`${prop} button[type=submit]`);
		await page.waitForFunction((key, price) => JSON.parse(localStorage.getItem(key)).documents[1].anchors[1].price === price, {}, storageKey, anchors[1][1].price + 10);
		assert.equal((await readStore()).documents[1].style.lineWidth, 6);
		await clickLabel('撤销画线');
		await page.waitForFunction((key, price) => JSON.parse(localStorage.getItem(key)).documents[1].anchors[1].price === price, {}, storageKey, anchors[1][1].price);
		assert.equal((await readStore()).documents[1].style.lineWidth, 4, 'One undo restores both coordinates and style');
		const stageBounds = await page.$eval('.chart-stage', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y }; });
		await page.mouse.click(stageBounds.x + 380, stageBounds.y + 300, { clickCount: 2 });
		assert.equal(await page.$eval(prop, el => el.open), true, 'Double-click opens settings for a non-text drawing');
		await page.keyboard.press('Escape');
		await page.mouse.click(stageBounds.x + 380, stageBounds.y + 300, { button: 'right' });
		await page.waitForSelector(popover, { timeout: 3000 }); await screenshot('desktop-context-menu'); await page.keyboard.press('Escape');


		// Inline notes support IME, multiline, cancel and one-step undo.
		await clickLabel('添加文字'); await page.waitForSelector('.drawing-inline-text textarea');
		await setInput('.drawing-inline-text textarea', '趋势支撑');
		await page.$eval('.drawing-inline-text textarea', input => { input.dispatchEvent(new Event('compositionstart')); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true })); });
		assert.ok(await page.$('.drawing-inline-text'));
		assert.equal((await readStore()).documents[1].style.attachedText, '');
		await page.$eval('.drawing-inline-text textarea', input => input.dispatchEvent(new Event('compositionend')));
		await page.$eval('.drawing-inline-text textarea', input => input.setSelectionRange(input.value.length, input.value.length));
		await page.keyboard.down('Shift'); await page.keyboard.press('Enter'); await page.keyboard.up('Shift'); await page.keyboard.type('Confirm');
		await screenshot('desktop-inline-text'); await page.keyboard.press('Enter');
		await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).documents[1].style.attachedText === '趋势支撑\nConfirm', {}, storageKey);
		await clickLabel('编辑文字'); await setInput('.drawing-inline-text textarea', '取消的草稿'); await page.keyboard.press('Escape');
		assert.equal((await readStore()).documents[1].style.attachedText, '趋势支撑\nConfirm');
		await clickLabel('撤销画线'); await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).documents[1].style.attachedText === '', {}, storageKey);
		await clickLabel('重做画线'); await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).documents[1].style.attachedText === '趋势支撑\nConfirm', {}, storageKey);
		await clickLabel('绘图设置'); await page.click('#drawing-tab-text');
		await page.click(`${prop} [aria-label="粗体"]`); await page.click(`${prop} [aria-label="斜体"]`);
		await setInput(`${prop} [data-field=fontSize]`, 20); await setInput(`${prop} [aria-label=文字不透明度]`, 70);
		await screenshot('desktop-line-text-settings'); await page.click(`${prop} button[type=submit]`);
		await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).documents[1].style.textBold, {}, storageKey);
		assert.equal((await readStore()).documents[1].style.textItalic, true); assert.equal((await readStore()).documents[1].style.textOpacity, .7);
		await screenshot('desktop-line-attached-text');

		// Batch lock/unlock is a single undoable action and cannot be deleted while locked.
		await clickLabel('锁定所有画线');
		await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).documents.every(d => d.style.locked), {}, storageKey);
		await clickLabel('删除画线');
		assert.equal(await page.$$eval(`${menu} button:disabled`, nodes => nodes.length), 2);
		await page.keyboard.press('Escape'); await clickLabel('撤销画线');
		await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).documents.every(d => !d.style.locked), {}, storageKey);
		await clickLabel('隐藏所有画线'); assert.equal(await page.$eval('[aria-label="显示所有画线"]', el => el.getAttribute('aria-pressed')), 'true');
		await clickLabel('显示所有画线');
		await clickLabel('删除画线'); await page.click(`${menu} button:last-child`); await waitSaved(0);
		assert.ok((await readStore()).documents.every(d => d.deleted));
		assert.equal(await page.$eval('.drawing-editbar', el => el.hidden), true);
		await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control'); await waitSaved(2);
		assert.deepEqual((await readStore()).documents.map(d => d.anchors), anchors);
		assert.equal(await page.$eval('.drawing-editbar', el => el.hidden), true);

		// The remembered primary button, continuous drawing, and cursor exit all work.
		await clickLabel('保持绘图模式'); await page.click('[data-group=lines] > button:first-child');
		await drawLine(390, 340); await waitSaved(3);
		assert.equal(await page.$eval('[data-group=lines] > button:first-child', el => el.getAttribute('aria-pressed')), 'true');
		await clickLabel('十字线光标 · Esc'); await clickLabel('保持绘图模式');
		await clickLabel('展开磁吸模式'); await page.click(`${menu} button:last-child`);
		assert.equal(await page.$eval('[aria-label="磁吸：强"]', el => el.getAttribute('aria-pressed')), 'true');
		await clickLabel('放大图表');

		// Exact catalog coverage, semantic grouping, and menu keyboard navigation.
		const allTypes = [];
		for (const label of ['趋势线工具', '江恩与斐波那契工具', '形态', '预测与测量工具', '几何图形与画笔', '文字与标注工具', '图标']) {
			await clickLabel(`展开${label}`);
			allTypes.push(...await page.$$eval(`${menu} [data-tool]`, nodes => nodes.map(n => n.dataset.tool)));
			const box = await page.$eval(menu, el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, bottom: r.bottom, right: r.right }; });
			assert.ok(box.x >= 0 && box.y >= 0 && box.right <= 1440 && box.bottom <= 1000);
			await page.keyboard.press('End'); assert.ok(await page.$eval(menu, el => el.contains(document.activeElement)));
			await page.keyboard.press('Escape');
		}
		const { TOOL_DEFINITIONS } = await import('@tradingview/lwc-plugin-drawing-tools');
		assert.equal(new Set(allTypes).size, allTypes.length);
		assert.deepEqual(allTypes.toSorted(), TOOL_DEFINITIONS.map(d => d.type).toSorted());
		await clickLabel('展开趋势线工具'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
		assert.equal(await page.$eval('[data-group=lines] > button:first-child', el => el.dataset.tool), 'ray');
		await clickLabel('十字线光标 · Esc');

		// A new chart session closes the menu and preserves market-time anchors.
		await clickLabel('展开形态'); await clickLabel('周期 4h');
		assert.equal(await page.$eval(menu, el => el.hidden), true);
		await page.waitForSelector('.drawing-toolbar button:not(:disabled)');
		assert.deepEqual((await readStore()).documents.slice(0, 2).map(d => d.anchors), anchors);
		await page.click('.tab-focus'); await page.waitForSelector('.drawing-toolbar button:not(:disabled)');
		assert.equal(await page.$eval('[aria-label="删除画线"]', el => el.disabled), true);
		await page.click('.tab:nth-child(2) .tab-focus'); await page.waitForSelector('.drawing-toolbar button:not(:disabled)');
		await page.reload(); await page.waitForSelector('.drawing-toolbar button:not(:disabled)');
		assert.equal((await readStore()).documents.filter(d => !d.deleted).length, 3);
		assert.equal(await page.$eval('.drawing-editbar', el => el.hidden), true);
		await page.setViewport({ width: 1036, height: 643 });
		await checkAlignment(); await page.mouse.move(500, 100); await screenshot('desktop-centered-rail');
		await page.hover(primary); assert.equal(await arrowOpacity(), '1'); await screenshot('desktop-hover-arrow');
		await page.setViewport({ width: 1280, height: 720 });
		await clickLabel('展开江恩与斐波那契工具');
		assert.ok(await page.$eval(menu, el => el.getBoundingClientRect().bottom <= window.innerHeight));
		await screenshot('desktop-fibonacci');

		await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
		await page.click('.mobile-nav-item:last-child'); await clickLabel('绘图工具');
		assert.equal(await page.$eval('.drawing-rail', el => window.getComputedStyle(el).display), 'none');
		assert.equal(await page.$eval(menu, el => el.hidden), true);
		await screenshot('mobile-tools');
		await page.type('.drawing-search', '不存在的工具');
		assert.equal(await page.$eval('.drawing-empty', el => el.textContent), '没有找到匹配的绘图工具');
		await page.$eval('.drawing-search', el => { el.value = '水平线'; el.dispatchEvent(new Event('input')); });
		await page.click('.drawing-catalog [data-tool="horizontal-line"]');
		assert.equal(await page.$eval('.drawing-dialog', el => el.open), false);
		await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
		await clickLabel('绘图工具'); await screenshot('mobile-landscape');
		await page.waitForFunction(() => { const r = document.querySelector('.drawing-dialog')?.getBoundingClientRect(); return Boolean(r && r.bottom <= window.innerHeight); }, { timeout: 2000 });
		// Existing shape, Fibonacci, annotation and analytical tools expose their own properties.
		await clickLabel('关闭绘图工具'); await page.setViewport({ width: 1440, height: 1000, isMobile: false, hasTouch: false });
		const choose = async (group, type) => { await clickLabel(`展开${group}`); await page.click(`${menu} [data-tool="${type}"]`); };
		await choose('几何图形与画笔', 'rectangle'); await drawLine(300, 390); await waitSaved(4);
		assert.ok(await page.$('.drawing-editbar [aria-label="填充颜色"]'));
		await clickLabel('填充颜色'); await clickLabel('颜色 #9c27b0');
		await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).documents.at(-1).style.fillColor === '#9c27b0', {}, storageKey);
		await clickLabel('锁定画线'); assert.equal(await page.$eval('[aria-label="删除选中画线"]', el => el.disabled), true); await clickLabel('解锁画线');
		await screenshot('desktop-rectangle-toolbar');

		// Text hit targets are updated during Canvas painting; screenshots are optional.
		await page.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
		const rectBounds = await page.$eval('.chart-stage', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y }; });
		await page.mouse.click(rectBounds.x + 380, rectBounds.y + 345);
		await page.waitForSelector('.drawing-inline-text textarea');
		await setInput('.drawing-inline-text textarea', '需求区'); await clickLabel('保存文字');
		await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).documents.at(-1).style.attachedText === '需求区', {}, storageKey);
		await page.mouse.click(rectBounds.x + 380, rectBounds.y + 345);
		await page.waitForSelector('.drawing-inline-text textarea'); await setInput('.drawing-inline-text textarea', '需求区 · 观察');
		await page.mouse.click(rectBounds.x + 800, rectBounds.y + 350);
		await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).documents.at(-1).style.attachedText === '需求区 · 观察', {}, storageKey);
		await screenshot('desktop-shape-attached-text');

		await choose('江恩与斐波那契工具', 'fib-retracement'); await drawLine(460, 540); await waitSaved(5);
		await clickLabel('绘图设置');
		assert.equal(await page.$$eval('.drawing-level-row', nodes => nodes.length), 7);
		await page.click('.drawing-level-row:first-child input[type=checkbox]');
		await setInput('.drawing-level-row:nth-child(2) input[type=number]', '.25');
		await page.click('.drawing-level-row:nth-child(2) [aria-label="层级颜色"]'); await clickLabel('颜色 #ff9800');
		await setInput('.drawing-level-row:nth-child(2) input[type=text]', '回踩确认');
		await screenshot('desktop-fibonacci-settings');
		await page.click(`${prop} button[type=submit]`);
		await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).documents.at(-1).style.fibLevels[1].value === .25, {}, storageKey);
		let savedFib = (await readStore()).documents.at(-1).style.fibLevels;
		assert.equal(savedFib[1].text, '回踩确认');
		await page.mouse.click(rectBounds.x + 380, rectBounds.y + 505);
		await page.waitForSelector('.drawing-inline-text textarea');
		await setInput('.drawing-inline-text textarea', '中位观察'); await page.keyboard.press('Enter');
		await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).documents.at(-1).style.fibLevels.some(l => l.text === '中位观察'), {}, storageKey);
		await screenshot('desktop-fibonacci-attached-text');
		savedFib = (await readStore()).documents.at(-1).style.fibLevels;
		assert.equal(savedFib[0].visible, false); assert.equal(savedFib[1].color, '#ff9800'); assert.equal(savedFib.length, 7);
		await choose('文字与标注工具', 'text'); await drawLine(580, 580); await waitSaved(6);
		await page.waitForSelector(`${prop}[open] textarea`); await setInput(`${prop} textarea`, '突破观察\n等待确认');
		await page.click(`${prop} button[type=submit]`);
		assert.equal(await page.$('.drawing-editbar [aria-label="线宽"]'), null);
		assert.equal(await page.$('.drawing-editbar [aria-label="线型"]'), null);
		await clickLabel('字号'); await clickLabel('字号 24');
		await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).documents.at(-1).style.fontSize === 24, {}, storageKey);
		await screenshot('desktop-text-toolbar');
		await choose('预测与测量工具', 'long-position');
		const bounds = await page.$eval('.chart-stage', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y }; });
		await page.mouse.click(bounds.x + 520, bounds.y + 400);
		await waitSaved(7);
		await clickLabel('反转多空');
		await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).documents.at(-1).kind === 'short-position', {}, storageKey);
		await clickLabel('反转多空');
		await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).documents.at(-1).kind === 'long-position', {}, storageKey);
		await clickLabel('绘图设置');
		assert.equal(await page.$eval(`${prop} [role=tab][aria-selected=true]`, el => el.textContent), '输入');
		await setInput('[data-field=riskPercent]', 2); await screenshot('desktop-position-settings');
		await page.click(`${prop} button[type=submit]`);
		await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).documents.at(-1).style.riskPercent === 2, {}, storageKey);
		const clickSheetAction = async label => {
			await clickLabel('图表选项');
			const handle = await page.waitForFunction(text => {
				const sheet = document.querySelector('.mobile-sheet.is-open');
				if (!sheet) return false;
				const matrix = window.getComputedStyle(sheet).transform;
				if (matrix && matrix !== 'none' && matrix !== 'matrix(1, 0, 0, 1, 0, 0)') return false;
				const btn = Array.from(sheet.querySelectorAll('.sheet-action')).find(el => el.textContent === text);
				if (!btn) return false;
				const r = btn.getBoundingClientRect();
				return r.height > 0 && r.bottom <= window.innerHeight ? btn : false;
			}, { timeout: 2500 }, label);
			await handle.asElement().click();
		};
		await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
		await page.click('.mobile-nav-item:last-child');
		await clickSheetAction('绘图对象与备份');
		await page.click('.drawing-object:nth-child(7) button:first-child');
		await screenshot('mobile-property-settings');
		await page.waitForFunction(() => { const r = document.querySelector('.drawing-properties-dialog')?.getBoundingClientRect(); return Boolean(r && r.x >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight); }, { timeout: 2000 });
		await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
		await screenshot('mobile-landscape-settings');
		await page.waitForFunction(() => { const r = document.querySelector('.drawing-properties-dialog')?.getBoundingClientRect(); return Boolean(r && r.bottom <= window.innerHeight); }, { timeout: 2000 });
		await clickLabel('关闭绘图设置');

		await clickSheetAction('绘图对象与备份'); await page.click('.drawing-object:nth-child(4) button:first-child');
		await page.click('#drawing-tab-text'); await screenshot('mobile-landscape-text-settings'); await clickLabel('关闭绘图设置');
		await clickLabel('编辑文字'); await screenshot('mobile-landscape-inline-text');
		assert.ok(await page.$eval('.drawing-inline-text', el => { const r = el.getBoundingClientRect(); return r.x >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight; }));
		await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
		await screenshot('mobile-inline-text'); await clickLabel('取消文字编辑');
		await clickLabel('绘图设置'); await page.click('#drawing-tab-text'); await screenshot('mobile-text-settings'); await clickLabel('关闭绘图设置');
		await clickLabel('编辑文字'); await setInput('.drawing-inline-text textarea', '跨会话未保存');
		await page.evaluate(() => document.querySelector('[aria-label="周期 1h"]').click());
		await page.waitForSelector('.drawing-toolbar button:not(:disabled)');
		assert.equal(await page.$('.drawing-inline-text'), null);
		assert.equal((await readStore()).documents[3].style.attachedText, '需求区 · 观察');
		await clickSheetAction('绘图对象与备份'); await page.click('.drawing-object:nth-child(7) button:first-child'); await clickLabel('关闭绘图设置');
		await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
		await page.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));

		await clickLabel('线条颜色'); await page.waitForSelector(popover); await screenshot('mobile-property-palette');
		await page.waitForFunction(() => { const r = document.querySelector('.drawing-property-popover')?.getBoundingClientRect(); return Boolean(r && r.x >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight); }, { timeout: 2000 });
		await page.keyboard.press('Escape');
		const beforeUndo = (await readStore()).documents.filter(d => !d.deleted).length;
		await clickLabel('删除选中画线'); await waitSaved(beforeUndo - 1);
		await clickSheetAction('撤销画线'); await waitSaved(beforeUndo);
		await clickSheetAction('重做画线'); await waitSaved(beforeUndo - 1);
		await clickSheetAction('撤销画线'); await waitSaved(beforeUndo);
		await page.setViewport({ width: 1440, height: 1000, isMobile: false, hasTouch: false });
		await page.reload(); await page.waitForSelector('.drawing-toolbar button:not(:disabled)');
		assert.equal(await page.$eval('.drawing-editbar', el => el.hidden), true);
		const finalStore = await readStore();
		assert.deepEqual(finalStore.documents.find(d => d.kind === 'fib-retracement').style.fibLevels, savedFib);
		assert.equal(finalStore.documents.find(d => d.kind === 'rectangle').style.attachedText, '需求区 · 观察');
		assert.equal(finalStore.documents.find(d => d.kind === 'text').style.text, '突破观察\n等待确认');
		assert.equal(finalStore.documents.find(d => d.kind === 'long-position').style.riskPercent, 2);

		// Representative center, oriented, channel, marker and extension renderers.
		let count = 7;
		for (const [group, type, note] of [['几何图形与画笔', 'circle', '圆心文字'], ['趋势线工具', 'vertical-line', '事件日'], ['趋势线工具', 'parallel-channel', '通道观察'], ['几何图形与画笔', 'arrow-up', '买入观察']]) {
			await choose(group, type);
			if (type === 'parallel-channel') {
				for (const [x, y] of [[600, 400], [820, 320], [600, 500]]) await page.mouse.click(bounds.x + x, bounds.y + y);
			} else await drawLine(type === 'circle' ? 270 : 400, type === 'circle' ? 350 : 400);
			await waitSaved(++count); await clickLabel('添加文字'); await setInput('.drawing-inline-text textarea', note); await clickLabel('保存文字');
			await page.waitForFunction((key, note) => JSON.parse(localStorage.getItem(key)).documents.at(-1).style.attachedText === note, {}, storageKey, note);
			if (type === 'vertical-line') {
				await clickLabel('绘图设置'); await page.click('#drawing-tab-text'); await page.select('[aria-label="文字方向"]', 'horizontal'); await page.select('[aria-label="文字对齐"]', 'left'); await screenshot('desktop-vertical-text-settings'); await page.click(`${prop} button[type=submit]`);
			}
			await screenshot(`desktop-${type}-note`);
		}
		await choose('江恩与斐波那契工具', 'fib-extension');
		for (const [x, y] of [[600, 500], [800, 360], [780, 480]]) await page.mouse.click(bounds.x + x, bounds.y + y);
		await waitSaved(++count); await clickLabel('绘图设置'); await setInput('.drawing-level-row:nth-child(4) input[type=text]', '扩展目标'); await page.click(`${prop} button[type=submit]`);
		await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).documents.at(-1).style.fibLevels[3].text === '扩展目标', {}, storageKey); await screenshot('desktop-extension-note');
		await clickLabel('反转层级');
		await page.waitForFunction(key => { const doc = JSON.parse(localStorage.getItem(key)).documents.at(-1); return doc.kind === 'fib-extension' && doc.anchors[0].price > doc.anchors[1].price; }, {}, storageKey);
		await choose('形态', 'elliott-impulse');
		await page.mouse.click(bounds.x + 260, bounds.y + 420);
		await page.mouse.click(bounds.x + 310, bounds.y + 340);
		await page.waitForSelector('.drawing-hint-actions button:not([hidden])');
		await page.click('.drawing-hint-actions button:first-child');
		for (const [x, y] of [[320, 330], [360, 380], [420, 260], [470, 310], [530, 210]]) await page.mouse.click(bounds.x + x, bounds.y + y);
		await waitSaved(++count);
		await clickLabel('浪级样式'); await page.click(`${popover} button:first-of-type`);
		await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).documents.at(-1).style.waveDegree === 'primary', {}, storageKey);
		await choose('趋势线工具', 'info-line'); await drawLine(450, 400); await waitSaved(++count);
		assert.equal(await page.$('.drawing-editbar [aria-label="添加文字"]'), null);
		assert.equal(await page.$('.drawing-editbar [aria-label="编辑文字"]'), null);
		await page.reload(); await page.waitForSelector('.drawing-toolbar button:not(:disabled)');
		assert.equal((await readStore()).documents.find(d => d.kind === 'parallel-channel').style.attachedText, '通道观察');
		assert.equal((await readStore()).documents.find(d => d.kind === 'fib-extension').style.fibLevels[3].text, '扩展目标');
		assert.equal((await readStore()).documents.find(d => d.kind === 'elliott-impulse').style.waveDegree, 'primary');

		assert.deepEqual(errors, []);
	} finally { await browser.close(); }
});
