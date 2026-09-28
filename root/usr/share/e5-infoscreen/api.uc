{%
// The info screen's data, served by uhttpd's ucode handler on 127.0.0.1:8088
// (/etc/init.d/e5-infoscreen).  uhttpd runs every request in a fresh child,
// so nothing survives in a variable: what has to outlive a request lives in
// files under /tmp/run/e5-infoscreen -- the last traffic sample (the rate is
// the difference between two polls) and the caches, since every mmcli call
// is a D-Bus round trip to ModemManager and, for the cell information, AT
// commands on the modem.
//
//   GET  /api/status         everything the pages show
//   GET  /api/qr             the hotspot's join code (SVG, WIFI: URI)
//   GET  /api/wifi-key       the hotspot's passphrase, when the page asks to show it
//   GET  /api/sms            the messages, newest first, and which are unread
//   POST /api/sms-read       the messages have been seen (e5-sms-notify read)
//   POST /api/sms-delete     {"id": N}
//   GET  /api/traffic        today's, this month's and the last days' traffic (vnstat)
//   POST /api/at             {"cmd": "AT+...", "timeout": s} -> {ok, reply|error}
//   GET  /api/at/presets     the screen's list of AT reads
//   GET  /api/advanced       device, baseband and SIM details, band and cell locks
//   GET  /api/identity       IMEI, ICCID, IMSI, own number -- when the page asks
//   POST /api/wifi           {"on": true|false}
//   POST /api/backlight      {"level": 0-255, "save": true|false}
//   POST /api/wan-reconnect
//   POST /api/key            {"key": ..., "code": ..., "keyCode": ...}  (key log)
//   GET  /api/settings       the settings categories;  GET /api/settings/<c> its items
//   POST /api/settings/<c>   {"id": ..., "value": ...} -> the item, read back
//   GET  /api/devices        the LAN's devices;  POST /api/devices {"mac", "action"}
//   GET  /api/plugins        the installed plugins (www/plugins/<id>/manifest.json)
//   *    /api/plugins/<id>/<path>   a plugin's own backend (backend.uc)
// docs/API.md is the reference.
//
// The identities of the SIM and the device (own number, IMEI, ICCID, IMSI)
// are returned by /api/identity alone, which the page calls when asked to
// show them.

import { readfile, writefile, popen, open, stat, glob, lsdir, lstat } from 'fs';
import { connect } from 'ubus';
import { cursor } from 'uci';

const WLAN_DEV = 'wlan0';
const USB_HOST_MAC = '02:50:00:00:e5:02';   // the gadget's host_addr
const MODEM_TTL = 10;                        // seconds
const KEY_LOG = '/tmp/e5-infoscreen-keys.log';
// e5-linux's OpenWrt: e5-sms-notify keeps the unread messages here
const SMS_UNREAD = '/tmp/run/e5-sms/unread';
const SMS_PATH = '/org/freedesktop/ModemManager1/SMS/';

let bus = null;
const RUN = '/tmp/run/e5-infoscreen/api';

// state that outlives the request: a JSON file, and its age by its mtime
function state_get(name, ttl) {
	let path = `${RUN}/${name}.json`;
	if (ttl != null) {
		let st = stat(path);
		if (!st || time() - st.mtime > ttl)
			return null;
	}
	try {
		return json(readfile(path) ?? 'null');
	}
	catch (e) {
		return null;
	}
}

// written to a file of its own, then renamed: two requests at once (the
// page polls while a setting is saved) must not share the temporary file
function state_put(name, obj) {
	system(`mkdir -p ${RUN}`);
	let c = clock(true);
	let tmp = `${RUN}/${name}.json.${c[0]}${c[1]}`;
	writefile(tmp, sprintf('%J', obj));
	system(`mv -f ${tmp} ${RUN}/${name}.json`);
}

function now() {
	let c = clock(true);
	return c[0] + c[1] / 1e9;
}

function sh(cmd) {
	let p = popen(cmd, 'r');
	if (!p)
		return null;
	let out = p.read('all');
	p.close();
	return out;
}

function sh_json(cmd) {
	let out = sh(cmd);
	if (!out)
		return null;
	try {
		return json(out);
	}
	catch (e) {
		return null;
	}
}

function read_trim(path) {
	let s = readfile(path);
	return (s == null) ? null : trim(s);
}

function read_num(path) {
	let s = read_trim(path);
	return (s == null || s == '') ? null : +s;
}

// (the reply helpers come first: ucode resolves a name where it is used,
// so a function further down could not call them)
function reply(code, type, body) {
	uhttpd.send(`Status: ${code}\r\nContent-Type: ${type}\r\nCache-Control: no-store\r\n\r\n`);
	if (body != null)
		uhttpd.send(body);
}

function reply_json(code, obj) {
	reply(code, 'application/json', sprintf('%J', obj));
}

// a small JSON body: with a Content-Length (fetch() from the page) or
// chunked, without one (uclient-fetch, wget on the device)
function read_body(env) {
	let len = (env.CONTENT_LENGTH != null) ? +env.CONTENT_LENGTH : null;
	if (len != null && (len <= 0 || len > 4096))
		return {};
	let body = '';
	while (length(body) < (len ?? 4096)) {
		let chunk = uhttpd.recv((len ?? 4096) - length(body));
		if (chunk == null || chunk == '')
			break;
		body += chunk;
	}
	try {
		return json(body) ?? {};
	}
	catch (e) {
		return {};
	}
}

function ubus_call(obj, method, args) {
	if (!bus)
		bus = connect();
	let r = bus ? bus.call(obj, method, args ?? {}) : null;
	if (r == null && bus && bus.error()) {
		bus = connect();
		r = bus ? bus.call(obj, method, args ?? {}) : null;
	}
	return r;
}

// "--" is mmcli's "no value"
function mm_val(v) {
	return (v == null || v == '--' || v == '') ? null : v;
}

function mm_num(v) {
	v = mm_val(v);
	return (v == null) ? null : +v;
}

// NR-ARFCN -> MHz (3GPP TS 38.104 5.4.2.1)
function nr_freq(n) {
	if (n < 600000)
		return n * 0.005;
	if (n < 2016667)
		return 3000 + (n - 600000) * 0.015;
	return 24250.08 + (n - 2016667) * 0.06;
}

// the downlink ranges of the bands a Chinese network uses, in the order a
// frequency that two bands share is named by (n78 inside n77)
const NR_BANDS = [
	[ 'n28', 758, 803 ], [ 'n8', 925, 960 ], [ 'n3', 1805, 1880 ],
	[ 'n1', 2110, 2170 ], [ 'n41', 2496, 2690 ], [ 'n78', 3300, 3800 ],
	[ 'n77', 3300, 4200 ], [ 'n79', 4400, 5000 ]
];

// EARFCN (downlink) ranges, 3GPP TS 36.101 table 5.7.3-1
const LTE_BANDS = [
	[ 'B1', 0, 599 ], [ 'B3', 1200, 1949 ], [ 'B5', 2400, 2649 ],
	[ 'B8', 3450, 3799 ], [ 'B28', 9210, 9659 ], [ 'B34', 36200, 36349 ],
	[ 'B38', 37750, 38249 ], [ 'B39', 38250, 38649 ], [ 'B40', 38650, 39649 ],
	[ 'B41', 39650, 41589 ]
];

function band_of(type, arfcn) {
	if (arfcn == null)
		return null;
	if (type == '5gnr') {
		let f = nr_freq(arfcn);
		for (let b in NR_BANDS)
			if (f >= b[1] && f <= b[2])
				return b[0];
	}
	else if (type == 'lte') {
		for (let b in LTE_BANDS)
			if (arfcn >= b[1] && arfcn <= b[2])
				return b[0];
	}
	return null;
}

// "cell type: 5gnr, serving: yes, ci: A00895006, physical ci: 131, ..." -> object
function parse_cell(line) {
	let cell = {};
	for (let kv in split(line, ', ')) {
		let i = index(kv, ': ');
		if (i > 0)
			cell[substr(kv, 0, i)] = substr(kv, i + 2);
	}
	let type = cell['cell type'];
	let arfcn = mm_num(cell.nrarfcn ?? cell.earfcn ?? cell.uarfcn ?? cell.arfcn);
	let bw = mm_num(cell.bandwidth);
	return {
		type,
		serving: cell.serving == 'yes',
		// (ModemManager prints the cell ids in hex)
		pci: (mm_val(cell['physical ci']) == null) ? null : int(cell['physical ci'], 16),
		arfcn,
		band: band_of(type, arfcn),
		rsrp: mm_num(cell.rsrp),
		rsrq: mm_num(cell.rsrq),
		sinr: mm_num(cell.sinr),
		// Hz in ModemManager's cell info
		bandwidth_mhz: (bw == null) ? null : bw / 1e6
	};
}

function modem_status() {
	let cached = state_get('modem', MODEM_TTL);
	if (cached)
		return cached;

	let m = sh_json('mmcli -J -m any --timeout=5 2>/dev/null')?.modem;
	if (!m) {
		state_put('modem', { present: false });
		return { present: false };
	}
	let g = m.generic ?? {}, g3 = m['3gpp'] ?? {};
	let sig = sh_json('mmcli -J -m any --timeout=5 --signal-get 2>/dev/null')?.modem?.signal ?? {};
	let cells = sh_json('mmcli -J -m any --timeout=5 --get-cell-info 2>/dev/null')?.modem?.generic?.['cell-info'] ?? [];

	let tech = g['access-technologies']?.[0];
	let s = (tech == '5gnr') ? sig['5g'] : sig.lte;
	let serving = null, neighbours = 0;
	for (let line in cells) {
		let c = parse_cell(line);
		if (c.serving && !serving)
			serving = c;
		else
			neighbours++;
	}

	let r = {
		present: true,
		state: mm_val(g.state),
		power: mm_val(g['power-state']),
		operator: mm_val(g3['operator-name']),
		registration: mm_val(g3['registration-state']),
		tech: mm_val(tech),
		quality: mm_num(g['signal-quality']?.value),
		sim: mm_val(g.sim) != null,
		signal: {
			rsrp: mm_num(s?.rsrp) ?? serving?.rsrp,
			rsrq: mm_num(s?.rsrq) ?? serving?.rsrq,
			snr: mm_num(s?.snr) ?? serving?.sinr
		},
		cell: serving,
		neighbours
	};
	state_put('modem', r);
	return r;
}

// the SIM card the modem is for (e5-linux's e5-sim: sipc_wwan card=), and
// with it the data interface: the CP puts the first card's data on SIPA net
// id 0, the second card's on net id 8
function sim_card() {
	return (trim(readfile('/sys/module/sipc_wwan/parameters/card') ?? '') == '1') ? 1 : 0;
}

function wan_dev() {
	return sim_card() ? 'sipa_eth8' : 'sipa_eth0';
}

function traffic() {
	let dev = wan_dev();
	let base = `/sys/class/net/${dev}/statistics/`;
	let rx = read_num(base + 'rx_bytes'), tx = read_num(base + 'tx_bytes');
	let t = now();
	let prev = state_get('traffic');
	// (another card's interface: its counters are not the previous poll's)
	if (prev && prev.dev != dev)
		prev = null;
	let r = { rx_total: rx, tx_total: tx, rx_rate: null, tx_rate: null };
	// (a counter that went down is a new bearer: no rate for this one poll)
	if (rx != null && prev && t > prev.t && t - prev.t < 60 && rx >= prev.rx && tx >= prev.tx) {
		let dt = t - prev.t;
		r.rx_rate = (rx - prev.rx) / dt;
		r.tx_rate = (tx - prev.tx) / dt;
	}
	// a sample less than a second old is kept: two quick polls would divide by ~0
	if (rx != null && (!prev || t - prev.t >= 1 || rx < prev.rx))
		state_put('traffic', { t, rx, tx, dev });
	return r;
}

function wan_status() {
	let w = ubus_call('network.interface.wan', 'status');
	let w6 = ubus_call('network.interface.wan_6', 'status');
	let v6 = null;
	for (let a in (w6?.['ipv6-address'] ?? []))
		v6 ??= a.address;
	for (let a in (w?.['ipv6-address'] ?? []))
		v6 ??= a.address;
	let prefix = w6?.['ipv6-prefix']?.[0];
	return {
		up: w?.up ?? false,
		pending: w?.pending ?? false,
		uptime: w?.uptime ?? null,
		ipv4: w?.['ipv4-address']?.[0]?.address ?? null,
		ipv6: v6,
		ipv6_prefix: prefix ? `${prefix.address}/${prefix.mask}` : null,
		dns: w?.['dns-server'] ?? []
	};
}

function wifi_config() {
	let c = cursor();
	return {
		ssid: c.get('wireless', 'default_radio0', 'ssid'),
		key: c.get('wireless', 'default_radio0', 'key'),
		encryption: c.get('wireless', 'default_radio0', 'encryption'),
		enabled: c.get('wireless', 'radio0', 'disabled') != '1' &&
			c.get('wireless', 'default_radio0', 'disabled') != '1',
		channel: c.get('wireless', 'radio0', 'channel'),
		band: c.get('wireless', 'radio0', 'band')
	};
}

function wifi_status() {
	let cfg = wifi_config();
	let st = ubus_call('network.wireless', 'status')?.radio0;
	return {
		ssid: cfg.ssid,
		enabled: cfg.enabled,
		up: (st?.up ?? false) && length(st?.interfaces ?? []) > 0,
		channel: cfg.channel,
		band: cfg.band,
		secured: cfg.encryption != null && cfg.encryption != 'none'
	};
}

function clients() {
	// the stations, from hostapd: this Wi-Fi driver has no station dump, so
	// iwinfo's assoclist (nl80211) is always empty
	let wifi = {};
	if (!bus)
		bus = connect();
	for (let obj in (bus?.list() ?? [])) {
		if (substr(obj, 0, 8) != 'hostapd.')
			continue;
		for (let mac, st in (ubus_call(obj, 'get_clients')?.clients ?? {}))
			if (st.assoc)
				wifi[lc(mac)] = st.signal;
	}

	let usb_up = read_trim('/sys/class/net/usb0/carrier') == '1';
	let list = [], seen = {};
	for (let line in split(readfile('/tmp/dhcp.leases') ?? '', '\n')) {
		let f = split(line, ' ');
		if (length(f) < 4)
			continue;
		let mac = lc(f[1]);
		let via = null;
		if (exists(wifi, mac))
			via = 'wifi';
		else if (mac == USB_HOST_MAC && usb_up)
			via = 'usb';
		if (!via || seen[mac])
			continue;
		seen[mac] = true;
		push(list, {
			name: (f[3] != '*') ? f[3] : null,
			ip: f[2],
			mac,
			via,
			signal: wifi[mac]
		});
	}
	// stations without a lease (yet)
	for (let mac, sig in wifi)
		if (!seen[mac])
			push(list, { name: null, ip: null, mac, via: 'wifi', signal: sig });
	return list;
}

function battery() {
	let b = '/sys/class/power_supply/battery/';
	let cur = read_num(b + 'current_now'), volt = read_num(b + 'voltage_now');
	return {
		capacity: read_num(b + 'capacity'),
		status: read_trim(b + 'status'),
		// the fuel gauge's own sign (sc27xx_fgu_get_current_now: ADC minus its
		// zero point): + into the battery, - out of it; µA and µV in sysfs
		current_ma: (cur == null) ? null : int(cur / 1000),
		voltage_mv: (volt == null) ? null : int(volt / 1000),
		// e5-linux's e5-charge: its limit, and whether it has stopped charging
		limit: (cursor().get('e5-charge', 'main', 'enabled') == '1')
			? +(cursor().get('e5-charge', 'main', 'stop') ?? 80) : null,
		paused: read_trim('/tmp/run/e5-charge/stopped') == '1',
		online: read_trim('/sys/class/power_supply/usb/online') == '1' ||
			read_trim('/sys/class/power_supply/ac/online') == '1'
	};
}

// the root filesystem's use (df, cached: it changes slowly and /status is
// polled every 2 s) -- OpenWrt's own image standalone, the Debian image for
// the directory form
function root_disk() {
	let d = state_get('root_disk', 60);
	if (d)
		return d;
	let lines = split(trim(sh('df -k / 2>/dev/null') ?? ''), '\n');
	let f = split(replace(lines[length(lines) - 1] ?? '', /\s+/g, ' '), ' ');
	d = (length(f) >= 4) ? { total: +f[1] * 1024, used: +f[2] * 1024 } : { total: null, used: null };
	state_put('root_disk', d);
	return d;
}

function system_status() {
	let mem = {};
	for (let line in split(readfile('/proc/meminfo') ?? '', '\n')) {
		let m = match(line, /^(MemTotal|MemAvailable):\s+([0-9]+)/);
		if (m)
			mem[m[1]] = +m[2] * 1024;
	}
	let up = split(readfile('/proc/uptime') ?? '0', ' ')[0];
	let load = split(readfile('/proc/loadavg') ?? '', ' ');
	return {
		uptime: int(+up),
		load: +load[0],
		mem_total: mem.MemTotal,
		mem_available: mem.MemAvailable,
		disk_total: root_disk().total,
		disk_used: root_disk().used,
		lan_ip: '192.168.9.1'
	};
}

function backlight_path() {
	let g = glob('/sys/class/backlight/*');
	return length(g) ? g[0] : null;
}

function screen_config() {
	let c = cursor();
	return {
		idle: +(c.get('e5-infoscreen', 'main', 'idle') ?? 60),
		brightness: +(c.get('e5-infoscreen', 'main', 'brightness') ?? 120),
		clock_seconds: c.get('e5-infoscreen', 'main', 'clock_seconds') == '1',
		touch: c.get('e5-infoscreen', 'main', 'touch') != '0',
		lang: c.get('e5-infoscreen', 'main', 'lang') ?? 'zh'
	};
}

/* ---------- SMS ---------- */

function sms_unread() {
	let ids = [];
	for (let line in split(readfile(SMS_UNREAD) ?? '', '\n')) {
		let m = match(line, /\/SMS\/([0-9]+)$/);
		if (m)
			push(ids, +m[1]);
	}
	return ids;
}

// a received message does not change: kept in sms.json by id
function sms_one(cache, id) {
	if (cache[id] && cache[id].state == 'received')
		return cache[id];
	let s = sh_json(`mmcli -J -m any --timeout=5 -s ${SMS_PATH}${id} 2>/dev/null`)?.sms;
	if (!s)
		return null;
	let c = s.content ?? {}, p = s.properties ?? {};
	let msg = {
		id,
		number: mm_val(c.number),
		text: mm_val(c.text) ?? '',
		time: mm_val(p.timestamp),
		state: mm_val(p.state),
		type: mm_val(p['pdu-type'])
	};
	cache[id] = msg;
	return msg;
}

function sms_list() {
	// (mmcli names this list with one flat key, "modem.messaging.sms")
	let lj = sh_json('mmcli -J -m any --timeout=5 --messaging-list-sms 2>/dev/null');
	let paths = lj?.['modem.messaging.sms'] ?? lj?.modem?.messaging?.sms ?? [];
	let unread = {}, list = [], live = {}, cache = state_get('sms') ?? {};
	for (let id in sms_unread())
		unread[id] = true;
	for (let p in paths) {
		let m = match(p, /\/SMS\/([0-9]+)$/);
		if (!m)
			continue;
		let msg = sms_one(cache, +m[1]);
		if (!msg || msg.type == 'submit')     // (the ones this device sent)
			continue;
		live[msg.id] = true;
		push(list, { ...msg, unread: !!unread[msg.id] });
	}
	for (let id in keys(cache))
		if (!live[id])
			delete cache[id];
	state_put('sms', cache);
	// newest first: the timestamps are ISO 8601 with the network's offset
	return sort(list, (a, b) => (a.time == b.time) ? b.id - a.id : ((a.time ?? '') < (b.time ?? '') ? 1 : -1));
}

function sms_delete(id) {
	id = int(id);
	if (id < 0 || `${id}` == 'NaN')
		return false;
	let ok = system(`mmcli -m any --timeout=10 --messaging-delete-sms=${SMS_PATH}${id} >/dev/null 2>&1`) == 0;
	if (ok) {
		let cache = state_get('sms') ?? {};
		delete cache[id];
		state_put('sms', cache);
		// and out of the unread list
		let rest = filter(split(readfile(SMS_UNREAD) ?? '', '\n'), (l) => l != '' && l != `${SMS_PATH}${id}`);
		writefile(SMS_UNREAD, length(rest) ? join('\n', rest) + '\n' : '');
	}
	return ok;
}

/* ---------- traffic ---------- */

// vnstat's day and month counters (bytes): wan = the modem's interface,
// lan = the bridge of the USB port and the hotspot
function traffic_iface(dev) {
	let v = sh_json(`vnstat --json -i ${dev} 2>/dev/null`);
	let tr = v?.interfaces?.[0]?.traffic;
	if (!tr)
		return { available: false };
	let lt = localtime();
	let pick = (list, match_fn) => {
		for (let e in (list ?? []))
			if (match_fn(e.date))
				return { rx: e.rx, tx: e.tx };
		return { rx: 0, tx: 0 };
	};
	let days = [];
	for (let e in slice(tr.day ?? [], -7))
		push(days, { date: sprintf('%02d-%02d', e.date.month, e.date.day), rx: e.rx, tx: e.tx });
	return {
		available: true,
		// when counting began: a month (or a day) that started earlier is partial
		since: v.interfaces[0].created?.timestamp,
		today: pick(tr.day, (d) => d.year == lt.year && d.month == lt.mon && d.day == lt.mday),
		month: pick(tr.month, (d) => d.year == lt.year && d.month == lt.mon),
		total: { rx: tr.total?.rx ?? 0, tx: tr.total?.tx ?? 0 },
		days
	};
}

function traffic_usage() {
	let wan = traffic_iface(wan_dev());
	// (the WAN's fields at the top level too, as in the first version)
	return { ...wan, wan, lan: traffic_iface('br-lan') };
}

/* ---------- advanced ---------- */

// mmcli prints  response: '<reply>'  and the reply has line breaks in it
// (a chained command answers once per part): taken between the first
// "response: '" and the last quote -- ucode's regex has no dot-all
function at_reply(out) {
	let i = index(out ?? '', "response: '");
	let j = rindex(out ?? '', "'");
	if (i < 0 || j <= i + 11)
		return (i >= 0) ? '' : null;
	return trim(replace(substr(out, i + 11, j - i - 11), /\r/g, ''));
}

// an AT command through ModemManager (the AT channel has one owner); the
// reply without the final OK, or null.  The command is single-quoted for the
// shell: a ' in it cannot end the quoting.
function at(cmd, timeout) {
	let q = replace(`${cmd}`, /'/g, "'\\''");
	let t = int(timeout ?? 10);
	if (t < 1 || t > 60) t = 10;
	return at_reply(sh(`mmcli -m any --timeout=${t} --command='${q}' 2>&1`));
}


// warned about, not refused (e5-linux's e5-at warns the same way): the
// commands after which the CP's AT server (ATZ, AT&F, AT+CPMS=) or the SIM
// (AT+CFUN=0, AT+SFUN=3/5) is gone until a reboot.  Every ;-separated part is
// checked; the command is still sent.
function at_warning(cmd) {
	let s = uc(replace(`${cmd}`, /\s+/g, ''));
	if (substr(s, 0, 2) == 'AT') s = substr(s, 2);
	for (let part in split(s, ';')) {
		part = replace(part, /^AT/, '');
		if (match(part, /^(Z|&F|\+CPMS=|\+CFUN=0|\+SFUN=3|\+SFUN=5)/))
			return true;
	}
	return false;
}

// /api/at: the reply, or the modem's error text; `warning` marks a command
// that can leave the modem's AT server or SIM dead until a reboot
function at_console(cmd, timeout) {
	let q = replace(`${cmd}`, /'/g, "'\\''");
	let t = int(timeout ?? 10);
	if (t < 1 || t > 60) t = 10;
	let out = sh(`mmcli -m any --timeout=${t} --command='${q}' 2>&1`) ?? '';
	let reply = at_reply(out);
	let r = null;
	if (reply != null)
		r = { ok: true, reply };
	else {
		let i = index(out, 'error: ');
		r = { ok: false, error: trim((i >= 0) ? substr(out, i + 7) : out) };
	}
	if (at_warning(cmd))
		r.warning = true;
	return r;
}

// useful reads for the screen's AT page; nothing here changes the modem
const AT_PRESETS = [
	[ 'AT+CSQ', '信号质量', 'Signal quality' ],
	[ 'AT+CESQ', '扩展信号质量', 'Extended signal' ],
	[ 'AT+COPS?', '运营商', 'Operator' ],
	[ 'AT+CEREG?', '4G 注册状态', 'LTE registration' ],
	[ 'AT+C5GREG?', '5G 注册状态', '5G registration' ],
	[ 'AT+CIREG?', 'IMS 注册状态', 'IMS registration' ],
	[ 'AT+CGDCONT?', 'PDP 上下文', 'PDP contexts' ],
	[ 'AT+CGCONTRDP=1', '连接参数', 'Connection parameters' ],
	[ 'AT+SPTESTMODE?', '网络模式', 'Network mode' ],
	[ 'AT+SP5GRAN?', '5G 组网', '5G access' ],
	[ 'AT+SPLBAND=0', 'LTE 频段锁定', 'LTE band lock' ],
	[ 'AT+SPLBAND=3', 'NR 频段锁定', 'NR band lock' ],
	[ 'AT+SPFORCEFRQ=16,3', 'NR 锁小区', 'NR cell lock' ],
	[ 'AT+SPFORCEFRQ=12,3', 'LTE 锁小区', 'LTE cell lock' ],
	[ 'AT+SPACTCARD?', '当前卡', 'Active card' ],
	[ 'AT+CGMR', '基带固件', 'Baseband firmware' ]
];

function payload_ints(line) {
	let body = line ?? '';
	let i = index(body, ':');
	if (i >= 0)
		body = substr(body, i + 1);
	let out = [];
	for (let n in (match(body, /-?[0-9]+/g) ?? []))
		push(out, +n[0]);
	return out;
}

// AT+SPLBAND=0: five mask words, groups 49-64, 33-48, 17-32, 1-16, 65-80
// (unisoc-cpd src/unisoc_at.rs, parse_lte_bands)
function lte_bands(line) {
	let base = [ 49, 33, 17, 1, 65 ], w = payload_ints(line), out = [];
	for (let g = 0; g < 5 && g < length(w); g++)
		for (let bit = 0; bit < 16; bit++)
			if (w[g] & (1 << bit))
				push(out, base[g] + bit);
	return sort(out, (a, b) => a - b);
}

// AT+SPLBAND=3: words 0, 2 and 3 are masks over these tables (parse_nr_bands)
const NR_V1 = [ 1, 2, 3, 5, 7, 8, 12, 20, 25, 28, 66, 70, 71, 74 ];
const NR_V3 = [ 34, 38, 39, 40, 41, 50, 51, 77, 78, 79 ];
const NR_SUPER = [ 75, 76, 80, 81, 82, 83, 84, 86 ];
function nr_bands(line) {
	let w = payload_ints(line), out = [];
	for (let pair in [ [ 0, NR_V1 ], [ 2, NR_V3 ], [ 3, NR_SUPER ] ])
		if (pair[0] < length(w))
			for (let i = 0; i < length(pair[1]); i++)
				if (w[pair[0]] & (1 << i))
					push(out, pair[1][i]);
	return sort(out, (a, b) => a - b);
}

// AT+SPFORCEFRQ=<12|16>,3: "+SPFORCEFRQ: <rat>,3[,<freq>,<pci>]..."
function cell_locks(line) {
	let w = payload_ints(line), out = [];
	for (let i = 2; i + 1 < length(w); i += 2)
		push(out, { arfcn: w[i], pci: w[i + 1] });
	return out;
}

function read_kv(path) {
	let r = {};
	for (let line in split(readfile(path) ?? '', '\n')) {
		let m = match(line, /^([A-Z_]+)='?([^']*)'?$/);
		if (m)
			r[m[1]] = m[2];
	}
	return r;
}

function thermal() {
	let hot = null;
	for (let z in glob('/sys/class/thermal/thermal_zone*')) {
		let t = read_num(z + '/temp');
		if (t != null && t > -40000 && t < 150000 && (hot == null || t > hot.temp))
			hot = { temp: t / 1000, zone: read_trim(z + '/type') };
	}
	return hot;
}

function disk(path) {
	let out = sh(`df -k ${path} 2>/dev/null`);
	let lines = split(trim(out ?? ''), '\n');
	let f = split(replace(lines[length(lines) - 1] ?? '', /\s+/g, ' '), ' ');
	return (length(f) >= 4) ? { total: +f[1] * 1024, used: +f[2] * 1024 } : null;
}

// a modem string without the unsolicited lines ModemManager can catch with
// it ("+IMSREGADDR:<addresses>" in front of the model, read while the report
// came in): the lines that are not "+NAME:" reports, joined
function mm_clean(v) {
	v = mm_val(v);
	if (v == null)
		return null;
	let keep = filter(map(split(v, /\r?\n/), (l) => trim(l)), (l) => l != '' && !match(l, /^[+^][A-Z0-9]+:/));
	return length(keep) ? join(' ', keep) : v;
}

function advanced() {
	let cached = state_get('advanced', 30);
	if (cached)
		return cached;

	let rel = read_kv('/etc/openwrt_release');
	let b = '/sys/class/power_supply/battery/';
	let m = sh_json('mmcli -J -m any --timeout=5 2>/dev/null')?.modem;
	let g = m?.generic ?? {}, g3 = m?.['3gpp'] ?? {};

	// "Platform Version: ...\nBASE  Version:  ...\nHW Version: ..." -> pairs
	let fw = [];
	for (let line in split(g.revision ?? '', '\n')) {
		line = trim(replace(line, /\s+/g, ' '));
		let i = index(line, ':');
		if (match(line, /^[0-9]{2}-[0-9]{2}-[0-9]{4} /))
			push(fw, { name: 'Build', value: line });    // the build date, "06-25-2024 16:44:53"
		else if (i > 0)
			push(fw, { name: trim(substr(line, 0, i)), value: trim(substr(line, i + 1)) });
	}

	let lte = m ? lte_bands(at('AT+SPLBAND=0')) : [];
	let nr = m ? nr_bands(at('AT+SPLBAND=3')) : [];
	let card = m ? payload_ints(at('AT+SPACTCARD?'))[0] : null;
	let sa = m ? payload_ints(at('AT+SP5GRAN?'))[0] : null;

	let r = {
		device: {
			model: 'Rongyue E5',
			os: rel.DISTRIB_DESCRIPTION,
			image: read_trim('/etc/e5/image-version'),
			kernel: read_trim('/proc/sys/kernel/osrelease'),
			disk: disk('/'),    // the Debian image for the directory form, the own image standalone
			thermal: thermal(),
			battery_mv: (read_num(b + 'voltage_now') ?? 0) / 1000 || null,
			battery_temp: (read_num(b + 'temp') == null) ? null : read_num(b + 'temp') / 10
		},
		baseband: m ? {
			manufacturer: mm_clean(g.manufacturer),
			model: mm_clean(g.model),
			firmware: fw,
			plugin: mm_val(g.plugin),
			sa_allowed: (sa == null) ? null : sa == 1,
			modes: mm_val(g['current-modes']),
			// empty = no lock (every band allowed)
			lte_lock: lte,
			nr_lock: nr,
			lte_cell_lock: cell_locks(at('AT+SPFORCEFRQ=12,3')),
			nr_cell_lock: cell_locks(at('AT+SPFORCEFRQ=16,3'))
		} : null,
		sim: m ? {
			present: mm_val(g.sim) != null,
			active_slot: (card == null) ? null : card + 1,
			state: mm_val(g.state),
			registration: mm_val(g3['registration-state']),
			operator_code: mm_val(g3['operator-code']),
			operator: mm_val(g3['operator-name'])
		} : null
	};
	state_put('advanced', r);
	return r;
}

function identity() {
	let m = sh_json('mmcli -J -m any --timeout=5 2>/dev/null')?.modem;
	let sim = sh_json('mmcli -J -i any --timeout=5 2>/dev/null')?.sim?.properties;
	return {
		imei: mm_val(m?.['3gpp']?.imei) ?? mm_val(m?.generic?.['equipment-identifier']),
		numbers: filter(m?.generic?.['own-numbers'] ?? [], (n) => mm_val(n) != null),
		iccid: mm_val(sim?.iccid),
		imsi: mm_val(sim?.imsi)
	};
}

/* ---------- context: what settings.uc and plugin backends get ---------- */

const API_VERSION = 1;
const WWW = '/usr/share/e5-infoscreen/www';
const PLUGINS = WWW + '/plugins';

function cells() {
	let out = [];
	for (let line in (sh_json('mmcli -J -m any --timeout=5 --get-cell-info 2>/dev/null')?.modem?.generic?.['cell-info'] ?? []))
		push(out, parse_cell(line));
	return out;
}

// a plugin's state files live under its own name
function make_ctx(ns) {
	let pre = ns ? `plugin-${ns}-` : '';
	return {
		api_version: API_VERSION,
		sh, sh_json, read_trim, read_num, payload_ints,
		at,
		at_console,
		ubus: ubus_call,
		uci: () => cursor(),
		run: (cmd) => system(cmd),
		// (single-quoted for the shell: the text is data, $(...) in it stays text)
		log: (msg) => system(`logger -t e5-infoscreen${ns ? '/' + ns : ''} -- '${replace(`${msg}`, /'/g, "'\\''")}'`),
		state_get: (name, ttl) => state_get(pre + name, ttl),
		state_put: (name, obj) => state_put(pre + name, obj),
		forget: (name) => system(`rm -f ${RUN}/${pre}${name}.json`),
		modem: modem_status,
		modem_present: () => modem_status().present,
		sim_card,
		cells,
		lte_bands, nr_bands, cell_locks,
		NR_V1, NR_V3, NR_SUPER
	};
}

/* ---------- plugins ---------- */

function plugin_manifests() {
	let out = [];
	for (let id in (lsdir(PLUGINS) ?? [])) {
		if (!match(id, /^[a-z0-9][a-z0-9_-]*$/))
			continue;
		let m;
		try {
			m = json(readfile(`${PLUGINS}/${id}/manifest.json`) ?? 'null');
		}
		catch (e) {
			continue;
		}
		if (type(m) != 'object' || m.id != id || +(m.api_version ?? 0) > API_VERSION)
			continue;
		m.has_backend = stat(`${PLUGINS}/${id}/backend.uc`) != null;
		// installed ones are links into /etc/e5-infoscreen/plugins (plugin link)
		m.builtin = lstat(`${PLUGINS}/${id}`)?.type != 'link';
		push(out, m);
	}
	return sort(out, (a, b) => (a.order ?? 50) - (b.order ?? 50));
}

// a plugin's settings are uci options, so the generic item code serves them:
// { id, type: toggle|choice|number, uci: "config.section.option", default, ... }
function plugin_category(m) {
	let items = m.settings;
	return {
		id: `plugin:${m.id}`, label: m.name, plugin: m.id,
		items: function() {
			let out = [], c = cursor();
			for (let d in items) {
				let u = split(d.uci ?? '', '.');
				let raw = (length(u) == 3) ? (c.get(u[0], u[1], u[2]) ?? d.default) : d.default;
				let v = raw;
				if (d.type == 'toggle') v = (raw == '1' || raw == true);
				else if (d.type == 'number') v = +raw;
				let it = { value: v };
				for (let k in [ 'id', 'type', 'label', 'note', 'confirm', 'options', 'min', 'max', 'step', 'unit' ])
					if (d[k] != null) it[k] = d[k];
				push(out, it);
			}
			return out;
		},
		set: function(id, value) {
			for (let d in items) {
				if (d.id != id) continue;
				let u = split(d.uci ?? '', '.');
				if (length(u) != 3) return 'no uci option';
				let v = (d.type == 'toggle') ? (value ? '1' : '0') : `${value}`;
				if (d.type == 'number' && (+v < d.min || +v > d.max)) return 'out of range';
				// the plugin's uci config is created on its first setting
				if (!match(u[0], /^[a-z0-9_-]+$/)) return 'bad uci config name';
				if (!stat(`/etc/config/${u[0]}`)) writefile(`/etc/config/${u[0]}`, '');
				let c = cursor();
				if (c.get(u[0], u[1]) == null) c.set(u[0], u[1], 'settings');
				c.set(u[0], u[1], u[2], v);
				c.commit(u[0]);
				return null;
			}
			return 'no such setting';
		}
	};
}

/* ---------- settings ---------- */

let settings_list = null;
function settings() {
	if (settings_list == null) {
		let f = loadfile('/usr/share/e5-infoscreen/settings.uc', { raw_mode: true });
		settings_list = f()(make_ctx(null));
		// the plugins' settings: a category each, uci-backed items from the manifest
		for (let m in plugin_manifests())
			if (length(m.settings ?? []))
				push(settings_list, plugin_category(m));
	}
	return settings_list;
}

function category(id) {
	for (let c in settings())
		if (c.id == id) return c;
	return null;
}

function settings_items(c) {
	return c.items ? c.items() : [];
}

function query_args(qs) {
	let q = {};
	for (let kv in split(qs ?? '', '&')) {
		if (kv == '') continue;
		let i = index(kv, '=');
		let k = (i < 0) ? kv : substr(kv, 0, i), v = (i < 0) ? '' : substr(kv, i + 1);
		q[uhttpd.urldecode(k)] = uhttpd.urldecode(replace(v, /\+/g, ' '));
	}
	return q;
}

// backend.uc returns function(ctx) -> { "GET /path": function(req) ... }; a
// handler returns an object (sent as JSON), or { status, type, body }
function plugin_request(env, id, rest, body) {
	if (!match(id, /^[a-z0-9][a-z0-9_-]*$/))
		return reply_json(404, { error: 'no such plugin' });
	let path = `${PLUGINS}/${id}/backend.uc`;
	if (!stat(path))
		return reply_json(404, { error: 'no backend' });
	let routes = loadfile(path, { raw_mode: true })()(make_ctx(id));
	let key = `${env.REQUEST_METHOD} ${rest == '' ? '/' : rest}`;
	let h = routes?.[key];
	if (type(h) != 'function')
		return reply_json(404, { error: `no route ${key}` });
	let r = h({ method: env.REQUEST_METHOD, path: rest, query: query_args(env.QUERY_STRING), body });
	if (type(r) == 'object' && r.body != null && (r.status || r.type))
		return reply(r.status ?? 200, r.type ?? 'text/plain', r.body);
	return reply_json(200, r ?? {});
}

/* ---------- devices ---------- */

function block_rule(mac) {
	return 'e5_block_' + replace(lc(mac), /:/g, '');
}

function devices() {
	let online = {};
	for (let c in clients())
		if (c.mac || c.ip)
			online[lc(c.mac ?? '')] = c;
	let fw = cursor(), blocked = {};
	fw.foreach('firewall', 'rule', (r) => {
		if (substr(r['.name'], 0, 9) == 'e5_block_' && r.src_mac)
			blocked[lc(r.src_mac)] = true;
	});
	let list = [], seen = {};
	let add = (mac, ip, name, via) => {
		mac = lc(mac);
		if (seen[mac]) return;
		seen[mac] = true;
		let o = online[mac];
		push(list, { mac, ip: o?.ip ?? ip, name: o?.name ?? name, via: o?.via ?? via,
		             online: !!o, signal: o?.signal, blocked: !!blocked[mac] });
	};
	for (let line in split(readfile('/tmp/dhcp.leases') ?? '', '\n')) {
		let f = split(line, ' ');
		if (length(f) >= 4)
			add(f[1], f[2], (f[3] != '*') ? f[3] : null, (lc(f[1]) == USB_HOST_MAC) ? 'usb' : 'wifi');
	}
	for (let mac in keys(blocked))
		add(mac, null, null, null);
	return sort(list, (a, b) => (a.online == b.online) ? ((a.ip ?? '') < (b.ip ?? '') ? -1 : 1) : (a.online ? -1 : 1));
}

function device_action(mac, action) {
	if (!match(mac ?? '', /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/))
		return 'bad MAC';
	let fw = cursor(), name = block_rule(mac);
	if (action == 'block') {
		fw.set('firewall', name, 'rule');
		fw.set('firewall', name, 'name', `e5 block ${mac}`);
		fw.set('firewall', name, 'src', 'lan');
		fw.set('firewall', name, 'dest', 'wan');
		fw.set('firewall', name, 'src_mac', mac);
		fw.set('firewall', name, 'target', 'REJECT');
		fw.commit('firewall');
		system('/etc/init.d/firewall reload >/dev/null 2>&1');
		return null;
	}
	if (action == 'unblock') {
		fw.delete('firewall', name);
		fw.commit('firewall');
		system('/etc/init.d/firewall reload >/dev/null 2>&1');
		return null;
	}
	if (action == 'kick') {
		if (!bus) bus = connect();
		for (let obj in (bus?.list() ?? []))
			if (substr(obj, 0, 8) == 'hostapd.')
				ubus_call(obj, 'del_client', { addr: mac, reason: 5, deauth: true, ban_time: 30000 });
		return null;
	}
	return 'no such action';
}

function sms_config() {
	let c = cursor();
	return { screen: c.get('e5-notify', 'sms', 'screen') != '0' };
}

// the subscribed rate: what the network grants the data context (cid 1, the
// one ModemManager connects), its aggregate maximum bit rate in kbit/s --
// +CGEQOSRDP on LTE (QCI, GBR, MBR, APN-AMBR), +C5GQOSRDP on 5G (5QI, GFBR,
// MFBR, session AMBR).  Cached a minute: it changes with the bearer only.
function qos_status(m) {
	if (!m?.present)
		return null;
	let c = state_get('qos', 60);
	if (c)
		return c.v;
	let nr = (m.tech == '5gnr');
	let f = payload_ints(at(nr ? 'AT+C5GQOSRDP=1' : 'AT+CGEQOSRDP=1', 5));
	let v = (length(f) >= 8 && f[0] == 1 && (f[6] > 0 || f[7] > 0))
		? { qci: f[1], dl_kbps: f[6], ul_kbps: f[7], nr } : null;
	state_put('qos', { v });
	return v;
}

function status() {
	let lt = localtime(), t = time();
	let m = modem_status();
	return {
		time: t,
		// the device's offset from UTC in seconds: the page formats its times
		// with it (WebKit has no zoneinfo here and would use UTC)
		tz_offset: timegm(lt) - t,
		clock: sprintf('%02d:%02d', lt.hour, lt.min),
		modem: { ...m, sim_card: sim_card(), qos: qos_status(m) },
		wan: wan_status(),
		traffic: traffic(),
		wifi: wifi_status(),
		clients: clients(),
		battery: battery(),
		system: system_status(),
		screen: screen_config(),
		sms: { unread: sms_unread(), ...sms_config() }
	};
}

// the join code: WIFI:T:WPA;S:<ssid>;P:<key>;; with \ ; , : " escaped.  The
// text goes to qrencode in a file, not on a command line.
function wifi_qr() {
	let cfg = wifi_config();
	if (!cfg.ssid)
		return null;
	let esc = (s) => replace(s ?? '', /([\\;,:"])/g, '\\$1');
	let uri = cfg.secured
		? `WIFI:T:WPA;S:${esc(cfg.ssid)};P:${esc(cfg.key)};;`
		: `WIFI:T:nopass;S:${esc(cfg.ssid)};;`;
	let tmp = '/tmp/run/e5-infoscreen-qr.txt';
	writefile(tmp, uri);
	let svg = sh(`qrencode -t SVG -m 1 -l M -r ${tmp} -o - 2>/dev/null`);
	writefile(tmp, '');
	return svg;
}

function set_wifi(on) {
	let c = cursor();
	c.set('wireless', 'radio0', 'disabled', on ? '0' : '1');
	c.set('wireless', 'default_radio0', 'disabled', on ? '0' : '1');
	c.commit('wireless');
	// hostapd takes seconds to come up or go
	system('(wifi reload) >/dev/null 2>&1 &');
	return true;
}

// save: the level the screen comes back to (after a blank, at the next boot)
function set_backlight(level, save) {
	let p = backlight_path();
	if (!p)
		return false;
	let max = read_num(p + '/max_brightness') ?? 255;
	level = int(level);
	if (level < 0) level = 0;
	if (level > max) level = max;
	if (save && level > 0) {
		let c = cursor();
		c.set('e5-infoscreen', 'main', 'brightness', `${level}`);
		c.commit('e5-infoscreen');
	}
	return writefile(p + '/brightness', `${level}\n`) != null;
}

/* ---------- Bluetooth (bluetoothd; e5-linux's e5-bt and e5-bt-connect) ---------- */

const BT_STATE = '/tmp/run/e5-bt';

function bt_mac_ok(m) {
	return match(m ?? '', /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/) != null;
}

// "Device <MAC> <name>" lines -> { MAC: name }
function bt_list(filter) {
	let out = {};
	for (let line in split(sh(`bluetoothctl devices ${filter ?? ''} 2>/dev/null`) ?? '', '\n')) {
		let m = match(line, /^Device ([0-9A-F:]{17}) ?(.*)$/);
		if (m) out[m[1]] = m[2];
	}
	return out;
}

function bluetooth_status() {
	if (system('command -v bluetoothctl >/dev/null 2>&1') != 0)
		return { available: false };
	let show = sh('bluetoothctl show 2>/dev/null') ?? '';
	if (!match(show, /Controller /))
		return { available: true, adapter: false, devices: [] };
	let all = bt_list(), paired = bt_list('Paired'), conn = bt_list('Connected');
	let devs = [];
	for (let mac, name in all) {
		// the unnamed ones (their name is the address: most are BLE beacons)
		let unnamed = (name == '' || name == replace(mac, /:/g, '-'));
		if (unnamed && !paired[mac]) continue;
		let d = { mac, name: unnamed ? mac : name, paired: !!paired[mac], connected: !!conn[mac] };
		let st = trim(readfile(`${BT_STATE}/${replace(mac, /:/g, '_')}`) ?? '');
		if (st != '' && !(d.connected && st == 'connected')) d.state = st;
		if (d.paired || d.connected) {
			let info = sh(`bluetoothctl info ${mac} 2>/dev/null`) ?? '';
			d.icon = match(info, /Icon: ([^\n]+)/)?.[1];
		}
		push(devs, d);
	}
	// connected, then paired, then the rest; by name
	devs = sort(devs, (a, b) => (b.connected - a.connected) || (b.paired - a.paired) || ((a.name < b.name) ? -1 : 1));
	return {
		available: true, adapter: true,
		powered: match(show, /Powered: yes/) != null,
		discovering: match(show, /Discovering: yes/) != null,
		name: match(show, /Alias: ([^\n]+)/)?.[1],
		devices: devs
	};
}

function bluetooth_action(b) {
	let mac = uc(b.mac ?? '');
	let a = b.action;
	if (a == 'power')
		return system(`bluetoothctl power ${b.on ? 'on' : 'off'} >/dev/null 2>&1`) == 0 ? null : 'failed';
	if (a == 'scan') {
		system('(bluetoothctl --timeout 20 scan on </dev/null >/dev/null 2>&1 &)');
		return null;
	}
	if (!bt_mac_ok(mac))
		return 'no such device';
	if (a == 'connect') {
		system(`mkdir -p ${BT_STATE}; echo pairing > ${BT_STATE}/${replace(mac, /:/g, '_')}`);
		system(`(/usr/libexec/e5-bt-connect ${mac} >/dev/null 2>&1 &)`);
		return null;
	}
	if (a == 'disconnect')
		return system(`bluetoothctl disconnect ${mac} >/dev/null 2>&1`) == 0 ? null : 'failed';
	if (a == 'remove') {
		system(`rm -f ${BT_STATE}/${replace(mac, /:/g, '_')}`);
		return system(`bluetoothctl remove ${mac} >/dev/null 2>&1`) == 0 ? null : 'failed';
	}
	return 'unknown action';
}

function log_key(k) {
	let f = open(KEY_LOG, 'a');
	if (!f)
		return false;
	f.write(sprintf('%d %J\n', time(), k));
	f.close();
	return true;
}

global.handle_request = function(env) {
	let path = env.PATH_INFO;
	if (path == null) {
		path = replace(env.REQUEST_URI ?? '', /\?.*$/, '');
		path = replace(path, /^\/api/, '');
	}
	// (uhttpd hands the path over still percent-encoded)
	path = uhttpd.urldecode(path) ?? path;
	let post = env.REQUEST_METHOD == 'POST';

	try {
		if (!post && path == '/status')
			return reply_json(200, status());
		if (!post && path == '/qr') {
			let svg = wifi_qr();
			return svg ? reply(200, 'image/svg+xml', svg) : reply_json(404, { error: 'no hotspot' });
		}
		if (!post && path == '/sms')
			return reply_json(200, { messages: sms_list() });
		if (post && path == '/sms-read')
			return reply_json(200, { ok: system('e5-sms-notify read >/dev/null 2>&1 || : > ' + SMS_UNREAD) == 0 });
		if (post && path == '/sms-delete')
			return reply_json(200, { ok: sms_delete(read_body(env).id ?? -1) });
		if (!post && path == '/settings')
			return reply_json(200, { categories: map(settings(), (c) => ({ id: c.id, label: c.label, view: c.view, plugin: c.plugin })) });
		let sm = match(path, /^\/settings\/([a-z0-9:_-]+)$/);
		if (sm) {
			let c = category(sm[1]);
			if (!c || !c.items)
				return reply_json(404, { error: 'no such category' });
			if (!post)
				return reply_json(200, { id: c.id, label: c.label, items: settings_items(c) });
			let b = read_body(env);
			let err = c.set(b.id, b.value);
			let item = null;
			for (let i in settings_items(c))
				if (i.id == b.id) item = i;
			return reply_json(err ? 400 : 200, { ok: !err, error: err, item });
		}
		if (!post && path == '/devices')
			return reply_json(200, { devices: devices() });
		if (post && path == '/devices') {
			let b = read_body(env);
			let err = device_action(lc(b.mac ?? ''), b.action);
			return reply_json(err ? 400 : 200, { ok: !err, error: err, devices: devices() });
		}
		if (post && path == '/plugins-remove') {
			// (installing is LuCI's: 服务 -> 信息屏应用, where a file can be uploaded)
			let id = read_body(env).id ?? '';
			if (!match(id, /^[a-z0-9][a-z0-9_-]*$/))
				return reply_json(400, { ok: false, error: 'bad id' });
			let out = sh(`/usr/libexec/e5-infoscreen/plugin remove ${id} 2>&1`) ?? '';
			let ok = match(out, /^removed /) != null;
			return reply_json(ok ? 200 : 400, { ok, error: ok ? null : trim(out) });
		}
		if (!post && path == '/plugins')
			return reply_json(200, { api_version: API_VERSION, plugins: plugin_manifests() });
		let pm = match(path, /^\/plugins\/([^\/]+)(\/.*)?$/);
		if (pm)
			return plugin_request(env, pm[1], pm[2] ?? '', post ? read_body(env) : null);
		if (post && path == '/at') {
			let b = read_body(env);
			return reply_json(200, at_console(b.cmd ?? '', b.timeout));
		}
		if (!post && path == '/at/presets')
			return reply_json(200, { presets: map(AT_PRESETS, (p) => ({ cmd: p[0], label: { zh: p[1], en: p[2] } })) });
		if (!post && path == '/traffic')
			return reply_json(200, traffic_usage());
		if (!post && path == '/advanced')
			return reply_json(200, advanced());
		if (!post && path == '/identity')
			return reply_json(200, identity());
		if (!post && path == '/wifi-key')
			return reply_json(200, { key: wifi_config().key });
		if (post && path == '/wifi')
			return reply_json(200, { ok: set_wifi(!!read_body(env).on) });
		if (post && path == '/backlight')
		{
			let b = read_body(env);
			return reply_json(200, { ok: set_backlight(b.level ?? 0, !!b.save) });
		}
		if (post && path == '/wan-reconnect') {
			system(`rm -f ${RUN}/modem.json`);
			system('(ifup wan) >/dev/null 2>&1 &');
			return reply_json(200, { ok: true });
		}
		if (!post && path == '/bluetooth')
			return reply_json(200, bluetooth_status());
		if (post && path == '/bluetooth') {
			let err = bluetooth_action(read_body(env));
			return reply_json(err ? 400 : 200, { ok: !err, error: err, ...bluetooth_status() });
		}
		if (path == '/volume') {
			// e5-linux's e5-volume: {"level":N,"max":15,"card":bool}
			if (system('[ -x /usr/libexec/e5-volume ]') != 0)
				return reply_json(200, { available: false });
			let arg = '', b = post ? read_body(env) : {};
			if (post) {
				arg = (b.level != null) ? `set ${int(b.level)}` : (+b.step > 0) ? 'up' : (+b.step < 0) ? 'down' : '';
			}
			let r = json(trim(sh(`/usr/libexec/e5-volume ${arg} 2>/dev/null`) ?? '') || 'null');
			return reply_json(200, { available: true, ...(r ?? {}) });
		}
		if (post && path == '/key')
			return reply_json(200, { ok: log_key(read_body(env)) });
		return reply_json(404, { error: 'not found' });
	}
	catch (e) {
		return reply_json(500, { error: `${e}` });
	}
};

%}
