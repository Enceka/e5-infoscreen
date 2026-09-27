'use strict';
// The E5 info screen: four pages (overview, signal, hotspot, device) fed by
// /api/status, driven by touch (tap, swipe) and the keypad (arrows, confirm,
// back, digits, power).  The backlight goes off after the configured idle
// time; the first touch or key after that only wakes the screen.

const I18N = {
	zh: {
		overview: '概览', signal: '信号', hotspot: '热点', device: '设备',
		since_boot: '本次开机', network: '网络', clients: '在线设备', battery: '电池',
		bandwidth: '带宽', neighbours: '邻区', uptime: '开机时长', wan_uptime: '联网时长',
		load: '负载', memory: '内存', brightness: '亮度', reconnect: '重新连接网络',
		show_key: '显示密码', hide_key: '隐藏密码', on: '开', off: '关',
		connected: '已连接', connecting: '连接中', disconnected: '未连接',
		no_modem: '无模组', no_sim: '无 SIM 卡', searching: '搜索网络',
		charging: '充电中', full: '已充满', discharging: '使用电池',
		none: '无', wifi: 'Wi-Fi', usb: 'USB', unnamed: '未命名',
		hotspot_on: '已开启', hotspot_off: '已关闭', hotspot_starting: '启动中',
		reconnecting: '正在重新连接…', turning_on: '正在开启热点…', turning_off: '正在关闭热点…',
		roaming: '漫游', devices: '台',
		excellent: '极好', good: '好', fair: '一般', weak: '弱', poor: '差'
	},
	en: {
		overview: 'Overview', signal: 'Signal', hotspot: 'Hotspot', device: 'Device',
		since_boot: 'Since boot', network: 'Network', clients: 'Clients', battery: 'Battery',
		bandwidth: 'Bandwidth', neighbours: 'Neighbours', uptime: 'Uptime', wan_uptime: 'Online',
		load: 'Load', memory: 'Memory', brightness: 'Brightness', reconnect: 'Reconnect',
		show_key: 'Show key', hide_key: 'Hide key', on: 'On', off: 'Off',
		connected: 'Connected', connecting: 'Connecting', disconnected: 'Offline',
		no_modem: 'No modem', no_sim: 'No SIM', searching: 'Searching',
		charging: 'Charging', full: 'Full', discharging: 'On battery',
		none: 'None', wifi: 'Wi-Fi', usb: 'USB', unnamed: 'unnamed',
		hotspot_on: 'On', hotspot_off: 'Off', hotspot_starting: 'Starting',
		reconnecting: 'Reconnecting…', turning_on: 'Turning the hotspot on…', turning_off: 'Turning the hotspot off…',
		roaming: 'Roaming', devices: '',
		excellent: 'Excellent', good: 'Good', fair: 'Fair', weak: 'Weak', poor: 'Poor'
	}
};

const POLL_AWAKE = 2000;
const POLL_BLANK = 30000;
const KEY_LOG_MAX = 200;

let lang = 'zh';
let page = 0;
let last = null;           // the last /api/status
let blank = false;
let idleTimer = null;
let pollTimer = null;
let keyLogged = 0;
let showKey = false;
let wifiPending = null;    // the state asked for, until the status shows it
let qrFor = null;          // the SSID the QR code was made for
let brightness = 120;

const $ = (id) => document.getElementById(id);
const pages = Array.from(document.querySelectorAll('.page'));
const t = (k) => (I18N[lang] && I18N[lang][k]) ?? I18N.zh[k] ?? k;

function applyLang() {
	document.documentElement.lang = lang;
	for (const el of document.querySelectorAll('[data-t]'))
		el.textContent = t(el.dataset.t);
	$('foot-title').textContent = t(pages[page].dataset.title);
}

/* ---------- formatting ---------- */

function fmtBytes(n) {
	if (n == null) return ['--', ''];
	const u = ['B', 'KB', 'MB', 'GB', 'TB'];
	let i = 0;
	while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
	return [n >= 100 || i == 0 ? n.toFixed(0) : n.toFixed(1), u[i]];
}

function fmtRate(n) {
	const [v, u] = fmtBytes(n);
	return [v, u ? u + '/s' : ''];
}

function fmtDuration(s) {
	if (s == null) return '--';
	const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
	if (lang == 'zh')
		return (d ? d + '天' : '') + (d || h ? h + '小时' : '') + m + '分';
	return (d ? d + 'd ' : '') + (d || h ? h + 'h ' : '') + m + 'm';
}

function techName(tech) {
	return { '5gnr': '5G', lte: '4G', umts: '3G', hsdpa: '3G', hsupa: '3G', hspa: '3G',
		'hspa-plus': '3G', gsm: '2G', edge: '2G', gprs: '2G' }[tech] ?? (tech ? tech.toUpperCase() : '--');
}

// quality of a measurement, 0..1 and a word, from the usual thresholds
function grade(kind, v) {
	if (v == null) return null;
	const T = {
		rsrp: [-80, -90, -100, -110, -140, -44],
		rsrq: [-10, -12, -15, -18, -25, -3],
		sinr: [20, 13, 5, 0, -10, 30]
	}[kind];
	const [ex, gd, fr, wk, min, max] = T;
	const frac = Math.max(0, Math.min(1, (v - min) / (max - min)));
	const word = v >= ex ? 'excellent' : v >= gd ? 'good' : v >= fr ? 'fair' : v >= wk ? 'weak' : 'poor';
	return { frac, word };
}

const GRADE_COLOR = { excellent: 'var(--good)', good: 'var(--good)', fair: 'var(--fair)', weak: 'var(--poor)', poor: 'var(--poor)' };

function setText(id, s) {
	const el = $(id);
	if (el && el.textContent !== s) el.textContent = s;
}

function setHTML(id, html) {
	const el = $(id);
	if (el && el.innerHTML !== html) el.innerHTML = html;
}

function esc(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- rendering ---------- */

function wanWord(st) {
	const m = st.modem, w = st.wan;
	if (!m.present) return [t('no_modem'), 'bad'];
	if (!m.sim) return [t('no_sim'), 'bad'];
	if (w.up) return [t('connected'), 'ok'];
	if (w.pending || m.state == 'connecting') return [t('connecting'), 'warn'];
	if (m.registration == 'searching') return [t('searching'), 'warn'];
	return [t('disconnected'), 'bad'];
}

function renderBar(st) {
	const m = st.modem;
	setText('bar-op', m.operator ?? (m.present ? t('searching') : t('no_modem')));
	const tech = $('bar-tech');
	setText('bar-tech', m.tech ? techName(m.tech) : '--');
	tech.classList.toggle('off', !st.wan.up);

	const q = m.quality ?? 0;
	const n = !m.present || m.quality == null ? 0 : q >= 75 ? 4 : q >= 50 ? 3 : q >= 25 ? 2 : q > 0 ? 1 : 0;
	$('bar-bars').querySelectorAll('i').forEach((el, i) => el.classList.toggle('on', i < n));

	const b = st.battery, bat = $('bar-bat');
	const cap = b.capacity ?? 0;
	bat.querySelector('b').style.width = Math.round(cap / 100 * 17) + 'px';
	bat.classList.toggle('low', cap <= 15 && b.status != 'Charging');
	bat.classList.toggle('charging', b.status == 'Charging');
	setText('bar-batpct', b.capacity == null ? '--' : cap + '%');
	setText('bar-clock', st.clock);
}

function batteryText(b) {
	if (b.capacity == null) return '--';
	const s = { Charging: t('charging'), Full: t('full'), Discharging: t('discharging'), 'Not charging': t('full') }[b.status] ?? '';
	return b.capacity + '%' + (s ? ' · ' + s : '');
}

function renderOverview(st) {
	const [rx, rxu] = fmtRate(st.traffic.rx_rate);
	const [tx, txu] = fmtRate(st.traffic.tx_rate);
	setText('ov-rx', rx); setText('ov-rx-u', rxu);
	setText('ov-tx', tx); setText('ov-tx-u', txu);
	const [rt, rtu] = fmtBytes(st.traffic.rx_total), [tt, ttu] = fmtBytes(st.traffic.tx_total);
	setText('ov-total', `↓ ${rt} ${rtu}  ↑ ${tt} ${ttu}`);

	const [word, cls] = wanWord(st);
	const fam = st.wan.up ? [st.wan.ipv4 ? 'IPv4' : null, st.wan.ipv6 ? 'IPv6' : null].filter(Boolean).join(' ') : '';
	setHTML('ov-wan', `<span class="${cls}">${esc(word)}</span>` + (st.modem.tech && st.wan.up ? ` · ${techName(st.modem.tech)}` : '') + (fam ? ` · ${fam}` : ''));

	const w = st.wifi;
	const ws = w.enabled ? (w.up ? t('hotspot_on') : t('hotspot_starting')) : t('hotspot_off');
	setHTML('ov-wifi', `<span class="${w.enabled && w.up ? 'ok' : w.enabled ? 'warn' : ''}">${esc(ws)}</span>` + (w.ssid ? ` · ${esc(w.ssid)}` : ''));

	const nw = st.clients.filter((c) => c.via == 'wifi').length, nu = st.clients.filter((c) => c.via == 'usb').length;
	setText('ov-clients', st.clients.length ? `${st.clients.length}${t('devices')}` + (nw ? ` · ${t('wifi')} ${nw}` : '') + (nu ? ` · ${t('usb')}` : '') : t('none'));
	setText('ov-bat', batteryText(st.battery));
}

function renderSignal(st) {
	const m = st.modem, c = m.cell;
	setText('sg-tech', m.tech ? techName(m.tech) : '--');
	setText('sg-band', c?.band ?? '');
	setText('sg-op', [m.operator, m.registration == 'roaming' ? t('roaming') : null].filter(Boolean).join(' · ') || '--');
	for (const [kind, v, unit] of [['rsrp', m.signal.rsrp, ' dBm'], ['rsrq', m.signal.rsrq, ' dB'], ['sinr', m.signal.snr, ' dB']]) {
		const g = grade(kind, v);
		setText('sg-' + kind, v == null ? '--' : `${v.toFixed(1)}${unit} · ${t(g.word)}`);
		const bar = $('sg-' + kind + '-bar');
		bar.style.width = g ? Math.round(g.frac * 100) + '%' : '0';
		bar.style.background = g ? GRADE_COLOR[g.word] : '';
	}
	setText('sg-pci', c?.pci == null ? '--' : String(c.pci));
	setText('sg-arfcn', c?.arfcn == null ? '--' : String(c.arfcn));
	setText('sg-bw', c?.bandwidth_mhz == null ? '--' : `${c.bandwidth_mhz} MHz`);
	setText('sg-nb', m.present ? String(m.neighbours ?? 0) : '--');
}

async function renderHotspot(st) {
	const w = st.wifi;
	setText('hs-ssid', w.ssid ?? '--');
	const on = wifiPending ?? w.enabled;
	const btn = $('hs-toggle');
	setText('hs-toggle', on ? t('on') : t('off'));
	btn.classList.toggle('on', on);
	if (wifiPending != null && wifiPending == w.enabled && (!w.enabled || w.up))
		wifiPending = null;

	$('hs-qr').classList.toggle('off', !(w.enabled && w.up));
	if (w.ssid && qrFor !== w.ssid) {
		qrFor = w.ssid;
		try {
			const r = await fetch('/api/qr', { cache: 'no-store' });
			setHTML('hs-qr', r.ok ? await r.text() : '');
		} catch (e) { qrFor = null; }
	}

	setText('hs-count', `(${st.clients.length})`);
	setHTML('hs-list', st.clients.length ? st.clients.map((c) =>
		`<div class="client"><span>${esc(c.name ?? c.ip ?? c.mac ?? t('unnamed'))}</span>` +
		`<span class="via">${esc(c.ip ?? '')} · ${esc(t(c.via))}${c.signal != null ? ' ' + c.signal + ' dBm' : ''}</span></div>`
	).join('') : `<div class="sub">${esc(t('none'))}</div>`);
}

function renderDevice(st) {
	setText('dv-bat', batteryText(st.battery));
	setText('dv-up', fmtDuration(st.system.uptime));
	setText('dv-wanup', st.wan.up ? fmtDuration(st.wan.uptime) : '--');
	setText('dv-load', st.system.load == null ? '--' : st.system.load.toFixed(2));
	const used = st.system.mem_total - st.system.mem_available;
	const [u, uu] = fmtBytes(used), [tt, tu] = fmtBytes(st.system.mem_total);
	setText('dv-mem', `${u} ${uu} / ${tt} ${tu}`);
	setText('dv-lan', st.system.lan_ip);
	setText('dv-v4', st.wan.ipv4 ?? '--');
	setText('dv-v6', st.wan.ipv6_prefix ?? st.wan.ipv6 ?? '--');
	setText('dv-bl', String(Math.round(brightness / 255 * 100)) + '%');
}

function render(st) {
	renderBar(st);
	renderOverview(st);
	renderSignal(st);
	renderHotspot(st);
	renderDevice(st);
}

/* ---------- data ---------- */

async function poll() {
	clearTimeout(pollTimer);
	try {
		const r = await fetch('/api/status', { cache: 'no-store' });
		if (r.ok) {
			const st = await r.json();
			const first = last == null;
			last = st;
			if (first) {
				lang = st.screen.lang in I18N ? st.screen.lang : 'zh';
				brightness = st.screen.brightness || 120;
				applyLang();
				resetIdle();
			}
			if (!blank) render(st);
		}
	} catch (e) {
		console.log('poll: ' + e);
	}
	pollTimer = setTimeout(poll, blank ? POLL_BLANK : POLL_AWAKE);
}

function post(path, body) {
	return fetch('/api/' + path, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body ?? {})
	}).then((r) => r.json()).catch(() => null);
}

function toast(msg) {
	const el = $('toast');
	el.textContent = msg;
	el.classList.add('show');
	clearTimeout(toast.timer);
	toast.timer = setTimeout(() => el.classList.remove('show'), 2000);
}

/* ---------- screen power ---------- */

function setBlank(on) {
	if (on == blank) return;
	blank = on;
	document.body.classList.toggle('blank', on);
	post('backlight', { level: on ? 0 : brightness });
	if (!on) {
		if (last) render(last);
		poll();
	}
	resetIdle();
}

function resetIdle() {
	clearTimeout(idleTimer);
	const idle = last?.screen?.idle ?? 60;
	if (!blank && idle > 0)
		idleTimer = setTimeout(() => setBlank(true), idle * 1000);
}

/* ---------- navigation ---------- */

function showPage(n) {
	page = (n + pages.length) % pages.length;
	$('pages').style.transform = `translateX(${-100 * page}%)`;
	$('dots').innerHTML = pages.map((_, i) => `<i class="${i == page ? 'on' : ''}"></i>`).join('');
	$('foot-title').textContent = t(pages[page].dataset.title);
	if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
	pages[page].scrollTop = 0;
}

function focusables() {
	return Array.from(pages[page].querySelectorAll('button'));
}

function moveFocus(dir) {
	const list = focusables();
	const pg = pages[page];
	if (!list.length) {
		pg.scrollBy({ top: dir * 80, behavior: 'smooth' });
		return;
	}
	let i = list.indexOf(document.activeElement);
	i = i < 0 ? (dir > 0 ? 0 : list.length - 1) : i + dir;
	if (i < 0 || i >= list.length) {
		// past the ends: scroll the page instead
		document.activeElement.blur();
		pg.scrollBy({ top: dir * 80, behavior: 'smooth' });
		return;
	}
	list[i].focus();
	list[i].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// the keypad, by what WebKit reports for it (measured with the key log,
// /api/key).  The confirm key is KEY_SELECT, which WebKit has no name for: it
// arrives as "Unidentified" with keyCode 0.  The power key is "PowerOff"; the
// side key is F1.  The volume keys are left alone: they are for the volume.
function keyKind(e) {
	const k = e.key, c = e.keyCode;
	if (k == 'Unidentified' && c == 0) return 'ok';
	if (k == 'F1' || c == 112) return 'hotspot';
	if (k == 'AudioVolumeUp' || k == 'AudioVolumeDown' || c == 174 || c == 175) return 'volume';
	if (k == 'ArrowLeft' || c == 37) return 'left';
	if (k == 'ArrowRight' || c == 39) return 'right';
	if (k == 'ArrowUp' || c == 38) return 'up';
	if (k == 'ArrowDown' || c == 40) return 'down';
	if (k == 'Enter' || k == 'Select' || k == 'Accept' || c == 13) return 'ok';
	if (k == 'BrowserBack' || k == 'GoBack' || k == 'Backspace' || k == 'Escape' || c == 8 || c == 27 || c == 166) return 'back';
	if (k == 'Power' || k == 'PowerOff' || k == 'Standby' || k == 'Sleep') return 'power';
	if (k >= '1' && k <= '4' && k.length == 1) return 'page' + k;
	return null;
}

document.addEventListener('keydown', (e) => {
	if (keyLogged < KEY_LOG_MAX) {
		keyLogged++;
		post('key', { key: e.key, code: e.code, keyCode: e.keyCode, repeat: e.repeat });
	}
	const kind = keyKind(e);
	e.preventDefault();
	if (blank) {
		setBlank(false);
		return;
	}
	resetIdle();
	switch (kind) {
	case 'left': showPage(page - 1); break;
	case 'right': showPage(page + 1); break;
	case 'up': moveFocus(-1); break;
	case 'down': moveFocus(1); break;
	case 'ok':
		if (document.activeElement && document.activeElement.tagName == 'BUTTON')
			document.activeElement.click();
		break;
	case 'back':
		if (document.activeElement && document.activeElement.tagName == 'BUTTON')
			document.activeElement.blur();
		else
			showPage(0);
		break;
	case 'power':
		if (!e.repeat) setBlank(true);
		break;
	case 'hotspot': showPage(2); break;
	default:
		if (kind && kind.startsWith('page')) showPage(+kind.slice(4) - 1);
	}
}, true);

// touch: the first touch on a dark screen wakes it and does nothing else;
// a horizontal swipe changes the page
let touch = null;
document.addEventListener('touchstart', (e) => {
	if (blank) {
		e.preventDefault();
		e.stopPropagation();
		setBlank(false);
		touch = null;
		return;
	}
	resetIdle();
	const p = e.touches[0];
	touch = { x: p.clientX, y: p.clientY, t: Date.now() };
}, { capture: true, passive: false });

document.addEventListener('touchend', (e) => {
	if (!touch) return;
	const p = e.changedTouches[0];
	const dx = p.clientX - touch.x, dy = p.clientY - touch.y;
	if (Math.abs(dx) > 50 && Math.abs(dx) > 1.5 * Math.abs(dy) && Date.now() - touch.t < 800)
		showPage(page + (dx < 0 ? 1 : -1));
	touch = null;
}, true);

document.addEventListener('mousedown', () => { if (!blank) resetIdle(); }, true);

/* ---------- actions ---------- */

$('hs-toggle').addEventListener('click', async () => {
	if (!last) return;
	const on = !(wifiPending ?? last.wifi.enabled);
	wifiPending = on;
	toast(on ? t('turning_on') : t('turning_off'));
	renderHotspot(last);
	await post('wifi', { on });
	setTimeout(poll, 1500);
});

$('hs-showkey').addEventListener('click', async () => {
	showKey = !showKey;
	$('hs-showkey').textContent = showKey ? t('hide_key') : t('show_key');
	if (!showKey) {
		setText('hs-key', '');
		return;
	}
	const r = await fetch('/api/wifi-key', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
	setText('hs-key', r?.key ?? '');
});

function stepBrightness(d) {
	brightness = Math.max(10, Math.min(255, brightness + d));
	post('backlight', { level: brightness, save: true });
	if (last) renderDevice(last);
}
$('dv-dim').addEventListener('click', () => stepBrightness(-25));
$('dv-bright').addEventListener('click', () => stepBrightness(25));

$('dv-reconnect').addEventListener('click', async () => {
	toast(t('reconnecting'));
	await post('wan-reconnect');
	setTimeout(poll, 3000);
});

/* ---------- start ---------- */

applyLang();
showPage(0);
poll();
