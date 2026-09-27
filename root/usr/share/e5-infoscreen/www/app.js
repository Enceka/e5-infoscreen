'use strict';
// The E5 info screen: six pages (overview, signal, SMS, hotspot, device,
// advanced) fed
// by /api/status, driven by touch (tap, swipe) and the keypad (arrows,
// confirm, back, digits, power).  The backlight goes off after the configured
// idle time; the first touch or key after that only wakes the screen.  A new
// SMS (e5-sms-notify's unread list) lights the screen and opens the message.

const I18N = {
	zh: {
		overview: '概览', signal: '信号', sms: '短信', hotspot: '热点', device: '设备',
		back: '返回', delete: '删除', delete_confirm: '再按一次删除', deleted: '已删除',
		no_sms: '没有短信', unknown_sender: '未知号码', new_sms: '新短信',
		advanced: '高级', adv_info: '高级信息', model: '型号',
		traffic: '流量', today: '今日', this_month: '本月', last_days: '最近 7 天', counting_since: '开始统计于',
		settings: '高级', apps: '应用', no_apps: '没有安装应用', press_again: '再按一次确认',
		apply: '应用', clear: '全部取消', save: '保存', saved: '已保存', failed: '失败',
		online: '在线', offline: '离线', blocked: '已禁止上网', block: '禁止上网', unblock: '允许上网',
		kick: '踢下 Wi-Fi', kicked: '已踢下线', mac: 'MAC', via: '连接', no_devices: '没有设备',
		loading: '读取中…', app_settings: '应用设置', current_voltage: '电流 / 电压', system: '系统', image: '镜像版本', kernel: '内核',
		storage: '存储', temperature: '温度', baseband: '基带', modes: '网络模式',
		locks: '锁定', lte_bands: 'LTE 频段', nr_bands: 'NR 频段', cell_lock: '锁小区',
		not_locked: '未锁定', slot: '卡槽', operator: '运营商', registration: '注册',
		number: '本机号码', show_ids: '显示识别码', hide_ids: '隐藏识别码',
		allowed: '允许', nsa_only: '仅 NSA', card: '卡', home: '本地网', roaming_reg: '漫游',
		idle_reg: '未注册', denied: '被拒绝',
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
		overview: 'Overview', signal: 'Signal', sms: 'Messages', hotspot: 'Hotspot', device: 'Device',
		back: 'Back', delete: 'Delete', delete_confirm: 'Press again to delete', deleted: 'Deleted',
		no_sms: 'No messages', unknown_sender: 'Unknown', new_sms: 'New message',
		advanced: 'Advanced', adv_info: 'Details', model: 'Model',
		traffic: 'Traffic', today: 'Today', this_month: 'This month', last_days: 'Last 7 days', counting_since: 'Counting since',
		settings: 'Settings', apps: 'Apps', no_apps: 'No apps installed', press_again: 'Press again',
		apply: 'Apply', clear: 'Clear all', save: 'Save', saved: 'Saved', failed: 'Failed',
		online: 'Online', offline: 'Offline', blocked: 'Blocked', block: 'Block internet', unblock: 'Allow internet',
		kick: 'Kick off Wi-Fi', kicked: 'Kicked', mac: 'MAC', via: 'Via', no_devices: 'No devices',
		loading: 'Loading…', app_settings: 'App settings', current_voltage: 'Current / voltage', system: 'System', image: 'Image', kernel: 'Kernel',
		storage: 'Storage', temperature: 'Temperature', baseband: 'Baseband', modes: 'Modes',
		locks: 'Locks', lte_bands: 'LTE bands', nr_bands: 'NR bands', cell_lock: 'Cell lock',
		not_locked: 'Not locked', slot: 'Slot', operator: 'Operator', registration: 'Registration',
		number: 'Number', show_ids: 'Show identifiers', hide_ids: 'Hide identifiers',
		allowed: 'Allowed', nsa_only: 'NSA only', card: 'SIM ', home: 'Home', roaming_reg: 'Roaming',
		idle_reg: 'Not registered', denied: 'Denied',
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
const POLL_BLANK = 5000;     // (still quick to notice a new SMS)
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
let smsList = [];          // the last /api/sms
let smsOpen = null;        // the id of the message on screen
let smsUnread = null;      // the unread ids at the last poll
let smsArmed = null;       // the delete button's second-press timer

// the pages, in order (the digit keys count from 1)
const P = { overview: 0, signal: 1, traffic: 2, sms: 3, hotspot: 4, device: 5, adv_info: 6, settings: 7, apps: 8 };
let adv = null;            // the last /api/advanced
let advTimer = null;
let showIds = false;

const $ = (id) => document.getElementById(id);
// handlers by element id: an element this page does not have (an index.html
// older than this script) is logged, not a TypeError that stops the script
function on(id, ev, fn) {
	const el = $(id);
	if (el) el.addEventListener(ev, fn);
	else console.log('no element #' + id);
}
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
	tickClock();
	const n_sms = st.sms?.unread?.length ?? 0;
	setText('bar-sms', n_sms ? '✉ ' + n_sms : '');
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
	// + charging, - discharging (the fuel gauge's sign)
	const b = st.battery, ma = b.current_ma;
	setHTML('ov-power', (ma == null ? '--' : `<span class="${ma > 0 ? 'ok' : ma < 0 ? 'warn' : ''}">${ma > 0 ? '+' : ''}${ma} mA</span>`) +
		(b.voltage_mv == null ? '' : ` · ${(b.voltage_mv / 1000).toFixed(2)} V`));
}

function renderSignal(st) {
	const m = st.modem, c = m.cell;
	setText('sg-tech', m.tech ? techName(m.tech) : '--');
	setText('sg-band', c?.band ?? '');
	setText('sg-op', [m.operator, m.registration == 'roaming' ? t('roaming') : null].filter(Boolean).join(' · ') || '--');
	const sig = m.signal ?? {};
	for (const [kind, v, unit] of [['rsrp', sig.rsrp, ' dBm'], ['rsrq', sig.rsrq, ' dB'], ['sinr', sig.snr, ' dB']]) {
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

/* ---------- clock ---------- */

// a time in the device's time zone: the API's offset from UTC, not WebKit's
// zone (it has no zoneinfo on OpenWrt, so it would be UTC)
function localParts(ms) {
	const d = new Date((ms ?? Date.now()) + (last?.tz_offset ?? 0) * 1000);
	return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(),
	         h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
}

// the status bar's clock ticks here, every second: the page has the device's
// time zone (the session passes TZ) and the time is NTP's
function tickClock() {
	const d = localParts(), p2 = (n) => String(n).padStart(2, '0');
	setText('bar-clock', `${p2(d.h)}:${p2(d.mi)}` + (last?.screen?.clock_seconds ? `:${p2(d.s)}` : ''));
}
setInterval(() => { if (!blank) tickClock(); }, 1000);

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
			smsCheck(st);
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
	if (!blank && idle > 0 && !(appOpen && appKeepAwake))
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
	if (page == P.sms) {
		loadSms();
		markSmsRead();
	} else if (smsOpen != null) {
		closeSms();
	}
	clearInterval(advTimer);
	if (page == P.traffic) {
		loadTraffic();
		advTimer = setInterval(() => { if (!blank) loadTraffic(); }, 30000);
	} else if (page == P.adv_info) {
		loadAdvanced();
		advTimer = setInterval(() => { if (!blank) loadAdvanced(); }, 30000);
	} else if (showIds) {
		hideIds();
	}
	if (page == P.settings) stOpen();
	if (page == P.apps) loadApps();
}

function focusables() {
	return Array.from(pages[page].querySelectorAll('button')).filter((b) => b.offsetParent !== null);
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
	if (k >= '1' && k <= '9' && k.length == 1) return 'page' + k;
	return null;
}

// the keypad's back key reports KEY_BACK and BackSpace (kernel 0004) in one
// press: the second of the two, within 150 ms, is the same press
let lastBack = 0;

document.addEventListener('keydown', (e) => {
	if (keyLogged < KEY_LOG_MAX) {
		keyLogged++;
		post('key', { key: e.key, code: e.code, keyCode: e.keyCode, repeat: e.repeat });
	}
	const kind = keyKind(e);
	if (kind == 'back') {
		const now = performance.now();
		if (now - lastBack < 150) {
			e.preventDefault();
			return;
		}
		lastBack = now;
	}
	e.preventDefault();
	if (blank) {
		setBlank(false);
		return;
	}
	resetIdle();
	if (appOpen) {                       // (the plugin's frame lost the focus)
		$('app-frame').focus();
		return;
	}
	if (page == P.settings && stKey(kind)) return;
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
		if (page == P.sms && smsOpen != null)
			closeSms();
		else if (document.activeElement && document.activeElement.tagName == 'BUTTON')
			document.activeElement.blur();
		else
			showPage(P.overview);
		break;
	case 'power':
		if (!e.repeat) setBlank(true);
		break;
	case 'hotspot': showPage(P.hotspot); break;
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


/* ---------- SMS ---------- */

// "2026-09-27T10:25:31+08:00" -> "10:25" today, "09-26 10:25" before
function fmtSmsTime(ts) {
	const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(ts ?? '');
	if (!m) return '';
	const now = localParts();
	const today = now.y == +m[1] && now.mo == +m[2] && now.d == +m[3];
	return (today ? '' : `${m[2]}-${m[3]} `) + `${m[4]}:${m[5]}`;
}

async function loadSms() {
	try {
		const r = await fetch('/api/sms', { cache: 'no-store' });
		if (r.ok) smsList = (await r.json()).messages ?? [];
	} catch (e) {
		console.log('sms: ' + e);
	}
	renderSmsList();
	return smsList;
}

function renderSmsList() {
	const unread = new Set(last?.sms?.unread ?? []);
	const focusedId = document.activeElement?.dataset?.sms;
	setHTML('sms-list', smsList.length ? smsList.map((m) =>
		`<button class="smsitem${m.unread || unread.has(m.id) ? ' unread' : ''}" data-sms="${m.id}">` +
		`<div class="top"><span class="from">${esc(m.number ?? t('unknown_sender'))}</span>` +
		`<span class="when">${esc(fmtSmsTime(m.time))}</span></div>` +
		`<div class="preview">${esc((m.text ?? '').replace(/\s+/g, ' '))}</div></button>`
	).join('') : `<div class="card sub">${esc(t('no_sms'))}</div>`);
	if (focusedId) {
		const el = document.querySelector(`[data-sms="${focusedId}"]`);
		if (el) el.focus();
	}
}

function openSms(id) {
	const m = smsList.find((x) => x.id == id);
	if (!m) return;
	smsOpen = m.id;
	setText('sv-from', m.number ?? t('unknown_sender'));
	setText('sv-time', fmtSmsTime(m.time));
	setText('sv-text', m.text ?? '');
	disarmDelete();
	$('sms-list').hidden = true;
	$('sms-view').hidden = false;
	pages[P.sms].scrollTop = 0;
}

function closeSms() {
	const id = smsOpen;
	smsOpen = null;
	disarmDelete();
	$('sms-view').hidden = true;
	$('sms-list').hidden = false;
	renderSmsList();
	const el = id != null && document.querySelector(`[data-sms="${id}"]`);
	if (el && page == P.sms) el.focus();
}

function disarmDelete() {
	clearTimeout(smsArmed);
	smsArmed = null;
	const b = $('sv-delete');
	b.classList.remove('armed');
	b.textContent = t('delete');
}

function markSmsRead() {
	if (blank || !(last?.sms?.unread?.length)) return;
	post('sms-read');
	last.sms.unread = [];
	smsUnread = [];
	setText('bar-sms', '');
}

// a message in the unread list that was not there at the last poll: light
// the screen (if e5-notify.sms.screen) and show it
async function smsCheck(st) {
	const now = st.sms?.unread ?? [];
	const before = smsUnread;
	smsUnread = now;
	if (before == null) return;                 // the first poll: nothing is new
	const fresh = now.filter((id) => !before.includes(id));
	if (!fresh.length) {
		if (page == P.sms && !blank && smsOpen == null && now.length != before.length) loadSms();
		return;
	}
	if (!st.sms.screen) return;
	if (blank) setBlank(false);
	toast(t('new_sms'));
	if (page != P.sms) showPage(P.sms);
	await loadSms();
	openSms(Math.max(...fresh));
	markSmsRead();
}

on('sms-list', 'click', (e) => {
	const b = e.target.closest('[data-sms]');
	if (b) openSms(+b.dataset.sms);
});

on('sv-back', 'click', () => closeSms());

on('sv-delete', 'click', async () => {
	const b = $('sv-delete');
	if (!smsArmed) {
		b.classList.add('armed');
		b.textContent = t('delete_confirm');
		smsArmed = setTimeout(disarmDelete, 3000);
		return;
	}
	const id = smsOpen;
	disarmDelete();
	const r = await post('sms-delete', { id });
	toast(r?.ok ? t('deleted') : '✗');
	smsList = smsList.filter((m) => m.id != id);
	closeSms();
	loadSms();
});

/* ---------- traffic ---------- */

async function loadTraffic() {
	let u = null;
	try {
		const r = await fetch('/api/traffic', { cache: 'no-store' });
		if (r.ok) u = await r.json();
	} catch (e) {
		console.log('traffic: ' + e);
	}
	const b = (n) => { const [v, unit] = fmtBytes(n); return `${v} ${unit}`; };
	if (last) {
		setText('tf-boot-rx', b(last.traffic.rx_total));
		setText('tf-boot-tx', b(last.traffic.tx_total));
	}
	if (!u || !u.available) return;
	setText('tf-day-rx', b(u.today.rx)); setText('tf-day-tx', b(u.today.tx));
	setText('tf-mon-rx', b(u.month.rx)); setText('tf-mon-tx', b(u.month.tx));
	// counting began inside this month (or today): say so, the total is partial
	const since = u.since ? localParts(u.since * 1000) : null, nowd = localParts();
	const p2 = (n) => String(n).padStart(2, '0');
	const sinceText = since ? `${t('counting_since')} ${p2(since.mo)}-${p2(since.d)} ${p2(since.h)}:${p2(since.mi)}` : '';
	const sameMonth = since && since.y == nowd.y && since.mo == nowd.mo;
	const sameDay = sameMonth && since.d == nowd.d;
	setText('tf-mon-since', sameMonth ? sinceText : '');
	setText('tf-day-since', sameDay ? sinceText : '');
	const max = Math.max(1, ...u.days.map((d) => d.rx + d.tx));
	setHTML('tf-days', u.days.length ? u.days.slice().reverse().map((d) =>
		`<div class="day"><span>${esc(d.date)}</span><span class="bar">` +
		`<i class="rx" style="width:${(d.rx / max * 100).toFixed(1)}%"></i>` +
		`<i class="tx" style="width:${(d.tx / max * 100).toFixed(1)}%"></i></span>` +
		`<span class="sum">${esc(b(d.rx + d.tx))}</span></div>`).join('')
		: `<div class="sub">${esc(t('none'))}</div>`);
}

/* ---------- advanced ---------- */

const REG_WORD = { home: 'home', roaming: 'roaming_reg', idle: 'idle_reg', denied: 'denied', searching: 'searching' };

async function loadAdvanced() {
	try {
		const r = await fetch('/api/advanced', { cache: 'no-store' });
		if (r.ok) adv = await r.json();
	} catch (e) {
		console.log('advanced: ' + e);
	}
	if (adv) renderAdvanced(adv);
}

function renderAdvanced(a) {
	const d = a.device ?? {}, b = a.baseband, s = a.sim;
	setText('ad-model', d.model ?? '--');
	setText('ad-os', d.os ?? '--');
	setText('ad-image', d.image ?? '--');
	setText('ad-kernel', d.kernel ?? '--');
	if (d.disk) {
		const [u, uu] = fmtBytes(d.disk.used), [tt, tu] = fmtBytes(d.disk.total);
		setText('ad-disk', `${u} ${uu} / ${tt} ${tu}`);
	}
	setText('ad-temp', d.thermal ? `${d.thermal.temp.toFixed(0)} °C` : '--');
	setText('ad-bat', [d.battery_mv ? (d.battery_mv / 1000).toFixed(2) + ' V' : null,
		d.battery_temp != null ? d.battery_temp.toFixed(0) + ' °C' : null].filter(Boolean).join(' · ') || '--');

	setText('ad-bb', b ? [b.manufacturer, b.model].filter(Boolean).join(' ') : t('no_modem'));
	setText('ad-sa', b?.sa_allowed == null ? '--' : b.sa_allowed ? t('allowed') : t('nsa_only'));
	setText('ad-modes', b?.modes?.replace(/^allowed: /, '').replace(/; preferred: none$/, '') ?? '--');
	setHTML('ad-fw', (b?.firmware ?? []).map((f) => `${esc(f.name)}: ${esc(f.value)}`).join('<br>'));

	const bands = (list, pre) => list?.length ? list.map((x) => pre + x).join(' ') : t('not_locked');
	setText('ad-lte', b ? bands(b.lte_lock, 'B') : '--');
	setText('ad-nr', b ? bands(b.nr_lock, 'n') : '--');
	const cells = [...(b?.lte_cell_lock ?? []).map((c) => `LTE ${c.arfcn}/${c.pci}`),
		...(b?.nr_cell_lock ?? []).map((c) => `NR ${c.arfcn}/${c.pci}`)];
	setText('ad-cell', b ? (cells.length ? cells.join(', ') : t('not_locked')) : '--');

	setText('ad-slot', s?.active_slot ? t('card') + s.active_slot : '--');
	setText('ad-op', s ? [s.operator, s.operator_code].filter(Boolean).join(' · ') || '--' : '--');
	setText('ad-reg', s?.registration ? t(REG_WORD[s.registration] ?? s.registration) : '--');
}

function hideIds() {
	showIds = false;
	$('ad-ids').hidden = true;
	$('ad-showids').textContent = t('show_ids');
	for (const id of ['id-imei', 'id-iccid', 'id-imsi', 'id-num']) setText(id, '--');
}

on('ad-showids', 'click', async () => {
	if (showIds) return hideIds();
	const r = await fetch('/api/identity', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
	if (!r) return;
	showIds = true;
	setText('id-imei', r.imei ?? '--');
	setText('id-iccid', r.iccid ?? '--');
	setText('id-imsi', r.imsi ?? '--');
	setText('id-num', r.numbers?.length ? r.numbers.join(', ') : '--');
	$('ad-ids').hidden = false;
	$('ad-showids').textContent = t('hide_ids');
});

/* ---------- settings ("高级") ---------- */

// a stack of views: menu -> category -> edit (choice / number / multi),
// menu -> devices -> device
let st = [];
let stCats = null;
let stArmed = null;               // { key, timer }: the row waiting for its second press
const lbl = (l) => (l && typeof l == 'object') ? (l[lang] ?? l.zh ?? '') : (l ?? '');

function stTop() { return st[st.length - 1]; }

async function stOpen() {
	if (!st.length) st = [{ view: 'menu' }];
	stRender();
	if (!stCats) {
		const r = await fetch('/api/settings', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
		stCats = r?.categories ?? [];
		stRender();
	}
}

async function stLoadCat(v) {
	const r = await fetch('/api/settings/' + v.cat.id, { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
	v.items = r?.items ?? [];
	if (stTop() === v) stRender();
}

function stDisarm() {
	if (stArmed) clearTimeout(stArmed.timer);
	stArmed = null;
}

// true when this press was the second one
function stConfirm(key, el) {
	if (stArmed && stArmed.key == key) {
		stDisarm();
		return true;
	}
	stDisarm();
	stArmed = { key, timer: setTimeout(() => { stDisarm(); stRender(); }, 3000) };
	if (el) {
		el.classList.add('armed');
		const sv = el.querySelector('.sv');
		if (sv) sv.textContent = t('press_again');
	}
	return false;
}

function stValue(it) {
	if (it.type == 'toggle') return it.value == null ? '--' : it.value ? t('on') : t('off');
	if (it.type == 'choice') {
		const o = (it.options ?? []).find((o) => String(o.value) == String(it.value));
		return o ? lbl(o.label) : (it.value ?? '--');
	}
	if (it.type == 'number') return it.value == null ? '--' : `${it.value}${it.unit ?? ''}`;
	if (it.type == 'multi') {
		if (!it.value?.length) return lbl(it.none_label) || t('not_locked');
		return it.value.map((v) => lbl((it.options ?? []).find((o) => o.value == v)?.label) || v).join(' ');
	}
	if (it.type == 'info') return String(it.value ?? '--');
	return '';
}

function stRow(key, label, value, opts = {}) {
	const tag = opts.info ? 'div' : 'button';
	return `<${tag} class="strow${opts.info ? ' info' : ''}" data-st="${esc(key)}">` +
		`<span>${esc(label)}</span><span class="sv${opts.on ? ' on' : ''}${opts.chev ? ' chev' : ''}">${esc(value)}</span></${tag}>` +
		(opts.note ? `<div class="stnote">${esc(opts.note)}</div>` : '');
}

function stRender() {
	const v = stTop();
	if (!v) return;
	const path = st.map((x) => x.view == 'menu' ? t('settings') : x.view == 'appcats' ? t('app_settings') : x.cat ? lbl(x.cat.label) : x.item ? lbl(x.item.label) : x.dev ? (x.dev.name ?? x.dev.ip ?? x.dev.mac) : '').join(' › ');
	setText('st-path', path);
	let html = '';
	if (v.view == 'menu') {
		// the core categories, then one entry that holds the plugins' settings
		html = stCats == null ? `<div class="sub">${esc(t('loading'))}</div>` :
			stCats.map((c, i) => c.plugin ? '' : stRow('cat:' + i, lbl(c.label), '', { chev: true })).join('') +
			(stCats.some((c) => c.plugin) ? stRow('appcats:', t('app_settings'), '', { chev: true }) : '');
		// (the API lists a plugin category only when its manifest has settings)
	} else if (v.view == 'appcats') {
		html = stCats.map((c, i) => c.plugin ? stRow('cat:' + i, lbl(c.label), '', { chev: true }) : '').join('');
	} else if (v.view == 'cat') {
		html = v.items == null ? `<div class="sub">${esc(t('loading'))}</div>` :
			v.items.map((it) => stRow('item:' + it.id, lbl(it.label), stValue(it),
				{ info: it.type == 'info', on: it.type == 'toggle' && it.value, note: lbl(it.note),
				  chev: ['choice', 'number', 'multi'].includes(it.type) })).join('');
	} else if (v.view == 'edit') {
		const it = v.item;
		if (it.type == 'choice') {
			html = it.options.map((o, i) => `<button class="strow opt${String(o.value) == String(it.value) ? ' on' : ''}" data-st="opt:${i}"><span>${esc(lbl(o.label))}</span><span class="sv"></span></button>`).join('');
		} else if (it.type == 'number') {
			html = `<div class="card stnum">${esc(String(v.draft))}${esc(it.unit ?? '')}</div>` +
				`<div class="stbtns"><button class="btn" data-st="num:-">−</button><button class="btn" data-st="num:+">+</button></div>` +
				`<div style="height:8px"></div><button class="strow" data-st="num:save"><span>${esc(t('save'))}</span><span class="sv"></span></button>`;
		} else if (it.type == 'multi') {
			html = it.options.map((o, i) => `<button class="strow opt check${v.draft.includes(o.value) ? ' on' : ''}" data-st="chk:${i}"><span>${esc(lbl(o.label))}</span><span class="sv"></span></button>`).join('') +
				`<button class="strow" data-st="multi:clear"><span>${esc(t('clear'))}</span><span class="sv"></span></button>` +
				`<button class="strow" data-st="multi:apply"><span>${esc(t('apply'))}</span><span class="sv">${esc(v.draft.length ? '' : t('not_locked'))}</span></button>`;
		}
		if (it.note) html += `<div class="stnote">${esc(lbl(it.note))}</div>`;
	} else if (v.view == 'devices') {
		html = v.list == null ? `<div class="sub">${esc(t('loading'))}</div>` : v.list.length ?
			v.list.map((d, i) => stRow('dev:' + i, d.name ?? d.ip ?? d.mac,
				d.blocked ? t('blocked') : d.online ? `${t('online')} · ${t(d.via ?? 'wifi')}` : t('offline'),
				{ on: d.online && !d.blocked, chev: true })).join('') : `<div class="sub">${esc(t('no_devices'))}</div>`;
	} else if (v.view == 'device') {
		const d = v.dev;
		html = stRow('info:mac', t('mac'), d.mac, { info: true }) +
			stRow('info:ip', 'IP', d.ip ?? '--', { info: true }) +
			stRow('info:via', t('via'), d.online ? t(d.via ?? 'wifi') + (d.signal ? ` · ${d.signal} dBm` : '') : t('offline'), { info: true }) +
			stRow('act:' + (d.blocked ? 'unblock' : 'block'), d.blocked ? t('unblock') : t('block'), '') +
			(d.online && d.via == 'wifi' ? stRow('act:kick', t('kick'), '') : '');
	}
	const focused = document.activeElement?.dataset?.st;
	setHTML('st-view', html);
	if (focused) {
		const el = document.querySelector(`[data-st="${CSS.escape(focused)}"]`);
		if (el) el.focus();
	}
}

async function stPost(v, body) {
	const r = await fetch('/api/settings/' + v.cat.id, {
		method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
	}).then((r) => r.json()).catch(() => null);
	toast(r?.ok ? t('saved') : `${t('failed')}${r?.error ? ': ' + r.error : ''}`);
	if (r?.item) {
		const i = v.items.findIndex((x) => x.id == r.item.id);
		if (i >= 0) v.items[i] = r.item;
	}
	if (r?.ok && v.cat.id == 'screen') stScreenApplied(body.id, r.item?.value ?? body.value);
	if (r?.ok && v.cat.id == 'system' && body.id == 'clock_seconds' && last) {
		last.screen.clock_seconds = !!body.value;
		tickClock();
	}
	return r;
}

// the screen settings take effect on the page at once
function stScreenApplied(id, value) {
	if (!last) return;
	if (id == 'brightness') {
		brightness = Math.max(1, Math.round(+value * 255 / 100));
		last.screen.brightness = brightness;
		post('backlight', { level: brightness });
	} else if (id == 'idle') {
		last.screen.idle = +value;
		resetIdle();
	} else if (id == 'lang') {
		lang = value in I18N ? value : 'zh';
		last.screen.lang = lang;
		applyLang();
		if (last) render(last);
	}
}

async function stClick(key, el) {
	const v = stTop();
	const [k, arg] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
	if (k == 'appcats') {
		st.push({ view: 'appcats' });
		stRender();
		return;
	}
	if (k == 'cat') {
		const c = stCats[+arg];
		if (c.view == 'devices') {
			const nv = { view: 'devices', cat: c, list: null };
			st.push(nv); stRender();
			const r = await fetch('/api/devices', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
			nv.list = r?.devices ?? [];
			if (stTop() === nv) stRender();
		} else {
			const nv = { view: 'cat', cat: c, items: null };
			st.push(nv); stRender();
			stLoadCat(nv);
		}
		return;
	}
	if (k == 'item') {
		const it = v.items.find((x) => x.id == arg);
		if (!it) return;
		if (it.type == 'toggle') {
			if (it.confirm && !stConfirm(key, el)) return;
			await stPost(v, { id: it.id, value: !it.value });
			stRender();
		} else if (it.type == 'action') {
			if (it.confirm && !stConfirm(key, el)) return;
			await stPost(v, { id: it.id });
			stLoadCat(v);
		} else if (it.type == 'choice' || it.type == 'number' || it.type == 'multi') {
			st.push({ view: 'edit', cat: v.cat, item: it, parent: v,
			          draft: it.type == 'multi' ? [...(it.value ?? [])] : it.value });
			stRender();
			const first = document.querySelector('#st-view button');
			if (first) first.focus();
		}
		return;
	}
	if (v.view == 'edit') {
		const it = v.item;
		if (k == 'opt') {
			const o = it.options[+arg];
			if (it.confirm && String(o.value) != String(it.value) && !stConfirm(key, el)) return;
			if (String(o.value) != String(it.value)) await stPost(v.parent, { id: it.id, value: o.value });
			st.pop(); stRender();
		} else if (k == 'num') {
			if (arg == 'save') {
				if (it.confirm && !stConfirm(key, el)) return;
				await stPost(v.parent, { id: it.id, value: v.draft });
				st.pop(); stRender();
			} else {
				v.draft = Math.min(it.max, Math.max(it.min, +v.draft + (arg == '+' ? 1 : -1) * (it.step ?? 1)));
				stRender();
			}
		} else if (k == 'chk') {
			const o = it.options[+arg];
			v.draft = v.draft.includes(o.value) ? v.draft.filter((x) => x != o.value) : [...v.draft, o.value];
			stRender();
		} else if (k == 'multi') {
			if (arg == 'clear') { v.draft = []; stRender(); return; }
			if (it.confirm && !stConfirm(key, el)) return;
			await stPost(v.parent, { id: it.id, value: v.draft });
			st.pop(); stRender();
		}
		return;
	}
	if (k == 'dev') {
		st.push({ view: 'device', cat: v.cat, dev: v.list[+arg], parent: v });
		stRender();
		return;
	}
	if (k == 'act') {
		if (!stConfirm(key, el)) return;
		const r = await fetch('/api/devices', {
			method: 'POST', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ mac: v.dev.mac, action: arg })
		}).then((r) => r.json()).catch(() => null);
		toast(r?.ok ? (arg == 'kick' ? t('kicked') : t('saved')) : `${t('failed')}${r?.error ? ': ' + r.error : ''}`);
		if (r?.devices) {
			v.parent.list = r.devices;
			v.dev = r.devices.find((d) => d.mac == v.dev.mac) ?? v.dev;
		}
		stRender();
	}
}

// keys on the settings page; true = taken
function stKey(kind) {
	const v = stTop();
	if (!v) return false;
	if (kind == 'back' && st.length > 1) {
		stDisarm();
		st.pop();
		stRender();
		const first = document.querySelector('#st-view button');
		if (first) first.focus();
		return true;
	}
	if ((kind == 'left' || kind == 'right') && st.length > 1) {
		// a number being edited: left/right step it; elsewhere below the menu, nothing
		if (v.view == 'edit' && v.item.type == 'number')
			stClick(kind == 'left' ? 'num:-' : 'num:+', null);
		return true;
	}
	return false;
}

on('st-view', 'click', (e) => {
	const b = e.target.closest('button[data-st]');
	if (b) stClick(b.dataset.st, b);
});

/* ---------- apps: plugins ---------- */

let apps = null;
let appOpen = null;               // the manifest of the open plugin
let appKeepAwake = false;

async function loadApps() {
	const r = await fetch('/api/plugins', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
	apps = r?.plugins ?? [];
	setHTML('ap-list', apps.length ? apps.map((m, i) =>
		`<button class="strow" data-app="${i}"><span>${esc(lbl(m.name) || m.id)}</span><span class="sv chev">${esc(lbl(m.description) ?? '')}</span></button>`).join('')
		: `<div class="card sub">${esc(t('no_apps'))}</div>`);
}

function openApp(m) {
	const f = $('app-frame');
	appOpen = m;
	appKeepAwake = false;
	f.src = `/plugins/${encodeURIComponent(m.id)}/${m.entry ?? 'index.html'}?lang=${lang}`;
	f.hidden = false;
	f.onload = () => f.focus();
	setText('foot-title', lbl(m.name) || m.id);
}

function closeApp() {
	const f = $('app-frame');
	f.hidden = true;
	f.src = 'about:blank';
	appOpen = null;
	appKeepAwake = false;
	resetIdle();
	setText('foot-title', t(pages[page].dataset.title));
	const b = document.querySelector('[data-app]');
	if (b) b.focus();
}

function toApp(msg) {
	const f = $('app-frame');
	if (appOpen && f.contentWindow) f.contentWindow.postMessage({ e5: msg.e5, ...msg }, '*');
}

on('ap-list', 'click', (e) => {
	const b = e.target.closest('[data-app]');
	if (b && apps) openApp(apps[+b.dataset.app]);
});

// the plugin side of the protocol (sdk/e5.js; docs/API.md, "Frontend")
window.addEventListener('message', (e) => {
	const m = e.data;
	if (!appOpen || !m || typeof m != 'object' || e.source !== $('app-frame').contentWindow) return;
	switch (m.e5) {
	case 'key':                     // every key the plugin sees, for the host's own keys
		if (blank) { setBlank(false); toApp({ e5: 'blank', on: false }); return; }
		resetIdle();
		if (m.kind == 'power' && !m.repeat) { setBlank(true); toApp({ e5: 'blank', on: true }); }
		break;
	case 'exit': closeApp(); break;
	case 'toast': toast(String(m.text ?? '')); break;
	case 'keep-awake':
		appKeepAwake = !!m.on;
		resetIdle();
		break;
	case 'ready':
		toApp({ e5: 'hello', lang, api_version: 1, blank, tz_offset: last?.tz_offset ?? 0 });
		break;
	}
});

/* ---------- actions ---------- */

on('hs-toggle', 'click', async () => {
	if (!last) return;
	const on = !(wifiPending ?? last.wifi.enabled);
	wifiPending = on;
	toast(on ? t('turning_on') : t('turning_off'));
	renderHotspot(last);
	await post('wifi', { on });
	setTimeout(poll, 1500);
});

on('hs-showkey', 'click', async () => {
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
on('dv-dim', 'click', () => stepBrightness(-25));
on('dv-bright', 'click', () => stepBrightness(25));

on('dv-reconnect', 'click', async () => {
	toast(t('reconnecting'));
	await post('wan-reconnect');
	setTimeout(poll, 3000);
});

/* ---------- start ---------- */

// the page and this script must be the same version: if an element the
// script needs is missing, load the page once more past the cache
if (!$('ad-showids') && !sessionStorage.getItem('e5-reloaded')) {
	sessionStorage.setItem('e5-reloaded', '1');
	location.reload();
} else {
	sessionStorage.removeItem('e5-reloaded');
	applyLang();
	showPage(0);
	poll();
}
