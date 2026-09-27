/*
 * e5-infoscreen plugin SDK, API version 1 (docs/API.md, "Frontend").
 *
 *   <script src="/sdk/e5.js"></script>
 *
 * A plugin's page runs in a frame over the info screen's pages.  Keys go to
 * the frame; this script turns them into the same kinds the host uses (left,
 * right, up, down, ok, back, power, digit, other), hands them to the plugin,
 * and tells the host about each one -- the host keeps the power key, the
 * screen's idle timer and waking the screen.  "back" that the plugin does not
 * take closes it.
 */
(function () {
	'use strict';

	const params = new URLSearchParams(location.search);
	const m = /^\/plugins\/([a-z0-9][a-z0-9_-]*)\//.exec(location.pathname);
	const id = m ? m[1] : null;

	let keyFn = null, backFn = null, langFn = null;
	let blank = false;
	let lastBack = 0;
	let touch = true;            // the host's 触摸 setting
	let keyClick = false;

	// touch off: drop every touch and every click (WebKit's own, after a tap,
	// is untrusted), except the clicks the plugin makes from a key (e5.press)
	for (const ev of ['touchstart', 'touchmove', 'touchend', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click'])
		window.addEventListener(ev, (e) => {
			if (!touch && !(ev == 'click' && keyClick)) {
				e.preventDefault();
				e.stopImmediatePropagation();
			}
		}, { capture: true, passive: false });

	function send(msg) {
		if (window.parent !== window) window.parent.postMessage(msg, '*');
	}

	function kindOf(e) {
		const k = e.key, c = e.keyCode;
		if (k == 'Unidentified' && c == 0) return 'ok';          // the keypad's confirm key
		if (k == 'ArrowLeft' || c == 37) return 'left';
		if (k == 'ArrowRight' || c == 39) return 'right';
		if (k == 'ArrowUp' || c == 38) return 'up';
		if (k == 'ArrowDown' || c == 40) return 'down';
		if (k == 'Enter' || k == 'Select' || c == 13) return 'ok';
		if (k == 'BrowserBack' || k == 'GoBack' || k == 'Backspace' || k == 'Escape' || c == 8 || c == 27 || c == 166) return 'back';
		if (k == 'PowerOff' || k == 'Power') return 'power';
		if (k.length == 1 && ((k >= '0' && k <= '9') || k == '*' || k == '#')) return 'digit';
		return 'other';
	}

	document.addEventListener('keydown', (e) => {
		const kind = kindOf(e);
		send({ e5: 'key', kind, key: e.key, code: e.code, keyCode: e.keyCode, repeat: e.repeat });
		// while the screen is dark the host only wakes it; power is the host's
		if (blank || kind == 'power') {
			e.preventDefault();
			return;
		}
		// the keypad's back key reports KEY_BACK and BackSpace in one press
		// (kernel 0004): the second of the two, within 150 ms, is the same press
		if (kind == 'back') {
			const now = performance.now();
			if (now - lastBack < 150) {
				e.preventDefault();
				return;
			}
			lastBack = now;
		}
		let taken = false;
		if (keyFn) taken = keyFn({ kind, key: e.key, code: e.code, repeat: e.repeat }) === true;
		if (!taken && kind == 'back') {
			if (!(backFn && backFn() === true)) send({ e5: 'exit' });
			taken = true;
		}
		if (taken) e.preventDefault();
	}, true);

	window.addEventListener('message', (e) => {
		const msg = e.data;
		if (e.source !== window.parent || !msg || typeof msg != 'object') return;
		if (msg.e5 == 'blank') blank = !!msg.on;
		if (msg.e5 == 'touch') touch = msg.on !== false;
		if (msg.e5 == 'hello') {
			blank = !!msg.blank;
			touch = msg.touch !== false;
			e5.tzOffset = +msg.tz_offset || 0;
			if (msg.lang && msg.lang != e5.lang) {
				e5.lang = msg.lang;
				if (langFn) langFn(e5.lang);
			}
		}
	});

	async function call(url, opts = {}) {
		const init = { method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'), cache: 'no-store' };
		if (opts.body !== undefined) {
			init.headers = { 'Content-Type': 'application/json' };
			init.body = JSON.stringify(opts.body);
		}
		const r = await fetch(url, init);
		const type = r.headers.get('Content-Type') ?? '';
		const data = type.includes('json') ? await r.json() : await r.text();
		if (!r.ok) throw Object.assign(new Error(data?.error ?? `HTTP ${r.status}`), { status: r.status, data });
		return data;
	}

	const e5 = {
		version: 1,
		id,
		lang: params.get('lang') ?? 'zh',
		/* this plugin's backend: /api/plugins/<id><path> */
		api: (path, opts) => call(`/api/plugins/${id}${path.startsWith('/') ? path : '/' + path}`, opts),
		/* the info screen's own API: /api/<path> (docs/API.md, "Core API") */
		core: (path, opts) => call(`/api/${path.replace(/^\//, '')}`, opts),
		onKey: (fn) => { keyFn = fn; },
		onBack: (fn) => { backFn = fn; },
		onLang: (fn) => { langFn = fn; },
		toast: (text) => send({ e5: 'toast', text: String(text) }),
		exit: () => send({ e5: 'exit' }),
		/* click an element from a key: goes through even when touch is off */
		press: (el) => { keyClick = true; try { el.click(); } finally { keyClick = false; } },
		keepAwake: (on) => send({ e5: 'keep-awake', on: !!on }),
		/* the device's offset from UTC, seconds (WebKit's own zone is UTC here) */
		tzOffset: 0,
		/* a time (ms since the epoch, default now) as HH:MM:SS in the device's zone */
		time: (ms) => {
			const d = new Date((ms ?? Date.now()) + e5.tzOffset * 1000);
			const p2 = (n) => String(n).padStart(2, '0');
			return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
		},
		/* { zh: '...', en: '...' } -> the text in the screen's language */
		t: (d) => (d && typeof d == 'object') ? (d[e5.lang] ?? d.zh ?? d.en ?? '') : String(d ?? '')
	};
	window.e5 = e5;
	send({ e5: 'ready' });
})();
