// Exercise host + SDK with the key names measured on the E5 WPE session.
// All network requests are mocked; no modem is contacted.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require(process.env.E5_PLAYWRIGHT || 'playwright');
const www = path.resolve(__dirname, '../root/usr/share/e5-infoscreen/www');
(async () => {
 const browser = await chromium.launch({ headless: true });
 const page = await browser.newPage({ viewport: { width: 320, height: 480 } });
 const errors = [];
 page.on('pageerror', e => errors.push(e.message));
 await page.route('http://screen.test/**', async route => {
  const p = new URL(route.request().url()).pathname;
  if (p.startsWith('/api/')) {
   if (p === '/api/status') return route.fulfill({ json: {
    time: 0, tz_offset: 0, modem: { present: false, sim: false, signal: {} }, wan: { up: false },
    traffic: { rx_total: 0, tx_total: 0, rx_rate: 0, tx_rate: 0 }, wifi: { enabled: false },
    clients: [], battery: { capacity: 80 }, usb: {}, system: { temperatures: {} },
    screen: { idle: 60, brightness: 120, lang: 'zh', touch: true, donate_seen: true },
    sms: { unread: [] }, notifications: []
   } });
   if (p === '/api/plugins') return route.fulfill({ json: { plugins: [
    { id: 'fixture', api_version: 2, name: { zh: '测试', en: 'Test' }, entry: 'index.html' }
   ] } });
   if (p === '/api/update') return route.fulfill({ json: { current: '1.5.1', available: false } });
   return route.fulfill({ json: { ok: true, categories: [] } });
  }
  if (p.startsWith('/plugins/fixture/')) return route.fulfill({ contentType: 'text/html', body:
   '<button>Test</button><script src="/sdk/e5.js"></script><script>window.keys=[];e5.onKey(k=>{keys.push(k);return true;});</script>' });
  const file = path.join(www, p);
  if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
  return route.fulfill({ contentType: p.endsWith('.js') ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(file) });
 });
 async function key(target, key, keyCode = 0, repeat = false) {
  await target.evaluate(({key, keyCode, repeat}) => document.dispatchEvent(new KeyboardEvent('keydown', {
   key, keyCode, repeat, code: 'Unidentified', bubbles: true, cancelable: true
  })), {key, keyCode, repeat});
  await page.waitForTimeout(80);
 }
 await page.goto('http://screen.test/index.html');
 await page.waitForTimeout(500);
 await page.evaluate(() => {
  const b = document.createElement('button'); b.id = 'probe'; window.clicks = 0;
  b.onclick = () => clicks++; document.body.append(b); b.focus();
 });
 await key(page, 'Unidentified'); await key(page, '#', 51); await key(page, 'F13', 124);
 assert.equal(await page.evaluate(() => clicks), 0, 'unknown/#/call confirmed a host button');
 await key(page, 'Enter', 13);
 assert.equal(await page.evaluate(() => clicks), 1, 'confirm did not activate the focused button');
 await key(page, 'ContextMenu', 93);
 await page.waitForSelector('[data-app="0"]');
 assert.equal(await page.locator('#foot-title').textContent(), '应用');
 await key(page, 'ArrowDown', 40); await key(page, 'Enter', 13);
 await page.waitForSelector('#app-frame:not([hidden])');
 const frame = page.frames().find(f => f.url().includes('/plugins/fixture/'));
 await frame.waitForFunction(() => !!window.e5);
 for (const [k, c] of [['Unidentified', 0], ['ArrowUp', 38], ['ArrowDown', 40], ['F13', 124], ['#', 51], ['Enter', 13], ['F1', 112]]) await key(frame, k, c);
 assert.deepEqual(await frame.evaluate(() => keys.map(k => k.kind)), ['other', 'up', 'down', 'call', 'digit', 'ok', 'other']);
 assert.equal(await frame.evaluate(() => keys[4].key), '#');
 await frame.evaluate(() => e5.capturePower(true)); await page.waitForTimeout(80);
 await key(frame, 'PowerOff', 409);
 assert.equal(await frame.evaluate(() => keys.at(-1).kind), 'power');
 assert(!await page.locator('body').evaluate(el => el.classList.contains('blank')), 'captured hangup blanked screen');
 await frame.evaluate(() => e5.capturePower(false)); await page.waitForTimeout(80);
 const count = await frame.evaluate(() => keys.length);
 await key(frame, 'PowerOff', 409);
 assert.equal(await frame.evaluate(() => keys.length), count, 'idle power reached plugin');
 assert(await page.locator('body').evaluate(el => el.classList.contains('blank')), 'idle power did not blank screen');
 // One wake key is consumed; the next menu key returns to the application list.
 await key(frame, 'ArrowUp', 38); await key(frame, 'ContextMenu', 93);
 assert(await page.locator('#app-frame').evaluate(el => el.hidden), 'menu did not leave plugin');
 assert.equal(await page.locator('#foot-title').textContent(), '应用');
 assert.deepEqual(errors, []);
 console.log('E5 keypad host and SDK checks passed'); await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
