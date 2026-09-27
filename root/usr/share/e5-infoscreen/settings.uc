// The info screen's settings ("高级"): categories of declarative items the page
// draws by type, and what reading and changing each one does.  Loaded by
// api.uc (loadfile) for every settings request and handed `ctx` -- the same
// helpers a plugin backend gets (docs/API.md, "Backend context").
//
// An item, as the page receives it:
//   { id, type, label, value, ... }
//   type toggle   value true|false
//        choice   value, options: [ { value, label } ]
//        number   value, min, max, step, unit
//        multi    value: [ ... ], options: [ { value, label } ] (none chosen = no lock)
//        action   no value; confirm: true -> the page asks for a second press
//        info     value is text, read-only
//   confirm      the change asks for a second press (it can cut the connection)
//   note         a line under the item (why, or what it does)
// label and note are { zh, en }.  A change is POST /api/settings/<category>
// { id, value } or { id } for an action; the reply is the item again, read back.

'use strict';

return function(ctx) {

const L = (zh, en) => ({ zh, en });

/* ---------- network ---------- */

// the bands Android's RIL itself allows on this modem (unisoc-cpd FINDINGS
// 1.4), and the NR bands in the CP's tables that Chinese networks use
const LTE_CHOICES = [ 1, 3, 5, 7, 8, 20, 28, 34, 38, 39, 40, 41 ];
const LTE_ANDROID = LTE_CHOICES;
const NR_CHOICES = [ 1, 3, 5, 8, 28, 41, 77, 78, 79 ];

// AT+SPTESTMODE=<card 1>,<card 2>,<primary SIM>: the work mode of each card
// (the values UFI-TOOLS uses on this CP generation, uficode's
// UniSocCellularUtils.kt NetworkMode); the read form answers the same three
// first.  5G without 4G is SA: "5G only" is SA only.
const NET_MODES = [
	[ '134', L('5G/4G/3G 自动', '5G/4G/3G auto') ],
	[ '131', L('5G/4G', '5G/4G') ],
	[ '128', L('仅 5G (SA)', '5G only (SA)') ],
	[ '3', L('仅 4G', '4G only') ]
];

function testmode() {
	let w = ctx.payload_ints(ctx.at('AT+SPTESTMODE?'));
	return (length(w) >= 3) ? { card1: w[0], card2: w[1], primary: w[2] } : null;
}

// AT+SPLBAND=1,<49-64>,<33-48>,<17-32>,<1-16>,<65-80>  (unisoc-cpd lte_band_lock_command)
function lte_lock_cmd(bands) {
	// (ucode object keys are strings)
	let g = { '1': 0, '17': 0, '33': 0, '49': 0, '65': 0 };
	for (let b in bands) {
		for (let base in [ 1, 17, 33, 49, 65 ])
			if (b >= base && b < base + 16)
				g[`${base}`] |= 1 << (b - base);
	}
	return `AT+SPLBAND=1,${g['49']},${g['33']},${g['17']},${g['1']},${g['65']}`;
}

// AT+SPLBAND=2,<value1>,0,<value3>,<super>  (nr_band_lock_command)
function nr_lock_cmd(bands) {
	let v1 = 0, v3 = 0, sup = 0;
	for (let b in bands) {
		let i = index(ctx.NR_V1, b);
		if (i >= 0) { v1 |= 1 << i; continue; }
		i = index(ctx.NR_V3, b);
		if (i >= 0) { v3 |= 1 << i; continue; }
		i = index(ctx.NR_SUPER, b);
		if (i >= 0) sup |= 1 << i;
	}
	return `AT+SPLBAND=2,${v1},0,${v3},${sup}`;
}

function same_set(a, b) {
	a = sort([ ...a ]); b = sort([ ...b ]);
	if (length(a) != length(b))
		return false;
	for (let i = 0; i < length(a); i++)
		if (a[i] != b[i])
			return false;
	return true;
}

function apn_options() {
	let seen = {}, out = [];
	let add = (apn) => {
		if (apn && apn != 'ims' && !seen[apn]) {
			seen[apn] = true;
			push(out, { value: apn, label: apn });
		}
	};
	add(ctx.uci().get('network', 'wan', 'apn'));
	// the contexts the modem holds (ims is the voice one)
	let pl = ctx.sh_json('mmcli -J -m any --timeout=5 --3gpp-profile-manager-list 2>/dev/null');
	for (let line in (pl?.modem?.['3gpp']?.['profile-manager']?.list ?? pl?.['modem.3gpp.profile-manager.list'] ?? [])) {
		let m = match(line, /apn: ([^,]+)/);
		if (m) add(trim(m[1]));
	}
	// and the ones listed for the switch: uci add_list e5-infoscreen.main.apn=<apn>
	for (let a in (ctx.uci().get('e5-infoscreen', 'main', 'apn') ?? []))
		add(a);
	return out;
}

// the cells to lock to: the serving one and its neighbours, of its technology
function cell_options(cells) {
	let out = [ { value: 'none', label: L('不锁定', 'Not locked') } ];
	for (let c in cells) {
		if (c.pci == null || c.arfcn == null || (c.type != '5gnr' && c.type != 'lte'))
			continue;
		let rat = (c.type == '5gnr') ? 'nr' : 'lte';
		let what = c.serving ? L('当前小区', 'serving') : L('邻区', 'neighbour');
		push(out, {
			value: `${rat}:${c.arfcn}:${c.pci}`,
			label: L(`${what.zh} ${rat == 'nr' ? 'NR' : 'LTE'} PCI ${c.pci} · ${c.arfcn}${c.rsrp != null ? ' · ' + c.rsrp + ' dBm' : ''}`,
				`${what.en} ${rat == 'nr' ? 'NR' : 'LTE'} PCI ${c.pci} · ${c.arfcn}${c.rsrp != null ? ' · ' + c.rsrp + ' dBm' : ''}`)
		});
	}
	return out;
}

function cell_lock_value() {
	let nr = ctx.cell_locks(ctx.at('AT+SPFORCEFRQ=16,3'));
	if (length(nr)) return `nr:${nr[0].arfcn}:${nr[0].pci}`;
	let lte = ctx.cell_locks(ctx.at('AT+SPFORCEFRQ=12,3'));
	if (length(lte)) return `lte:${lte[0].arfcn}:${lte[0].pci}`;
	return 'none';
}

const network = {
	id: 'network', label: L('网络', 'Network'),
	items: function() {
		let modem = ctx.modem_present();
		let cells = modem ? ctx.cells() : [];
		let cur_cell = modem ? cell_lock_value() : 'none';
		let tm = modem ? testmode() : null;
		let opts = cell_options(cells);
		// a lock on a cell that is not in view any more is still shown
		if (cur_cell != 'none' && !length(filter(opts, (o) => o.value == cur_cell))) {
			let p = split(cur_cell, ':');
			push(opts, { value: cur_cell, label: L(`已锁定 ${uc(p[0])} PCI ${p[2]} · ${p[1]}`, `locked ${uc(p[0])} PCI ${p[2]} · ${p[1]}`) });
		}
		return [
			{ id: 'apn', type: 'choice', label: L('APN', 'APN'), value: ctx.uci().get('network', 'wan', 'apn'),
			  options: apn_options(), confirm: true,
			  note: L('切换后会重新连接网络', 'The connection restarts on a change') },
			{ id: 'net_mode', type: 'choice', label: L('网络模式', 'Network mode'), confirm: true,
			  value: (modem && tm) ? `${tm.card1}` : null,
			  options: map(NET_MODES, (m) => ({ value: m[0], label: m[1] })),
			  note: L('切换时会重新注册网络', 'The modem registers again on a change') },
			{ id: 'nr_mode', type: 'choice', label: L('5G 组网', '5G access'), confirm: true,
			  value: modem ? ((ctx.payload_ints(ctx.at('AT+SP5GRAN?'))[0] == 1) ? 'sa' : 'nsa') : null,
			  options: [ { value: 'sa', label: L('SA + NSA', 'SA + NSA') },
			             { value: 'nsa', label: L('仅 NSA', 'NSA only') } ] },
			{ id: 'lte_bands', type: 'multi', label: L('LTE 频段锁定', 'LTE band lock'), confirm: true,
			  value: modem ? ctx.lte_bands(ctx.at('AT+SPLBAND=0')) : [],
			  options: map(LTE_CHOICES, (b) => ({ value: b, label: `B${b}` })),
			  note: L('都不选 = 不锁定', 'None chosen = no lock') },
			{ id: 'nr_bands', type: 'multi', label: L('NR 频段锁定', 'NR band lock'), confirm: true,
			  value: modem ? ctx.nr_bands(ctx.at('AT+SPLBAND=3')) : [],
			  options: map(NR_CHOICES, (b) => ({ value: b, label: `n${b}` })),
			  note: L('都不选 = 不锁定', 'None chosen = no lock') },
			{ id: 'bands_default', type: 'action', label: L('恢复默认频段', 'Default bands'), confirm: true,
			  note: L('LTE 恢复 Android 的频段组合，NR 不锁定', "LTE back to Android's set, NR unlocked") },
			{ id: 'cell_lock', type: 'choice', label: L('锁定小区', 'Cell lock'), value: cur_cell,
			  options: opts, confirm: true,
			  note: L('锁到某个小区后只连这个小区（实验）', 'Only that cell once locked (experimental)') },
			{ id: 'reconnect', type: 'action', label: L('重新连接网络', 'Reconnect'), confirm: true }
		];
	},
	set: function(id, value) {
		if (id == 'apn') {
			let ok = false;
			for (let o in apn_options())
				if (o.value == value) ok = true;
			if (!ok) return 'unknown APN';
			let c = ctx.uci();
			c.set('network', 'wan', 'apn', value);
			c.commit('network');
			ctx.run('(ifup wan) >/dev/null 2>&1 &');
			return null;
		}
		if (id == 'net_mode') {
			let ok = false;
			for (let m in NET_MODES) if (m[0] == `${value}`) ok = true;
			let tm = testmode();
			if (!ok || !tm) return ok ? 'cannot read the current mode' : 'unknown mode';
			// card 2's mode and the primary SIM stay as the modem has them
			ctx.at(`AT+SPTESTMODE=${int(value)},${tm.card2},${tm.primary}`);
			ctx.forget('modem');
			// the CP applies it a moment after the OK: read back for up to 3 s
			for (let i = 0; i < 6; i++) {
				let now = testmode();
				if (now && now.card1 == int(value)) return null;
				sleep(500);
			}
			return 'the modem did not take it';
		}
		if (id == 'nr_mode') {
			if (value != 'sa' && value != 'nsa') return 'unknown';
			let v = (value == 'sa') ? 1 : 0;
			ctx.at(`AT+SP5GRAN=${v}`);
			return (ctx.payload_ints(ctx.at('AT+SP5GRAN?'))[0] == v) ? null : 'the modem did not take it';
		}
		if (id == 'lte_bands' || id == 'nr_bands' || id == 'bands_default') {
			let lte = (id == 'bands_default') ? LTE_ANDROID : (id == 'lte_bands') ? value : null;
			let nr = (id == 'bands_default') ? [] : (id == 'nr_bands') ? value : null;
			if (lte != null) {
				lte = filter(map(lte, (b) => +b), (b) => index(LTE_CHOICES, b) >= 0);
				ctx.at(lte_lock_cmd(lte));
				// (a lock that did not take must not look like one)
				if (!same_set(ctx.lte_bands(ctx.at('AT+SPLBAND=0')), lte))
					return 'LTE: the modem read back other bands';
			}
			if (nr != null) {
				nr = filter(map(nr, (b) => +b), (b) => index(NR_CHOICES, b) >= 0);
				ctx.at(nr_lock_cmd(nr));
				if (!same_set(ctx.nr_bands(ctx.at('AT+SPLBAND=3')), nr))
					return 'NR: the modem read back other bands';
			}
			return null;
		}
		if (id == 'cell_lock') {
			if (value == 'none') {
				ctx.at('AT+SPFORCEFRQ=16,4');
				ctx.at('AT+SPFORCEFRQ=12,4');
				return (cell_lock_value() == 'none') ? null : 'still locked';
			}
			let p = split(value ?? '', ':');
			if (length(p) != 3 || (p[0] != 'nr' && p[0] != 'lte'))
				return 'bad cell';
			let arfcn = int(p[1]), pci = int(p[2]);
			ctx.at(`AT+SPFORCEFRQ=${p[0] == 'nr' ? 16 : 12},6,${arfcn},${pci}`);
			return (cell_lock_value() == `${p[0]}:${arfcn}:${pci}`) ? null : 'the modem did not take the lock';
		}
		if (id == 'reconnect') {
			ctx.forget('modem');
			ctx.run('(ifup wan) >/dev/null 2>&1 &');
			return null;
		}
		return 'no such setting';
	}
};

/* ---------- charging, notifications, screen: uci-backed ---------- */

// a setting that is a uci option: `apply` runs after a change
function uci_item(def) {
	let u = split(def.uci, '.');
	let raw = ctx.uci().get(u[0], u[1], u[2]) ?? def.default;
	let v = raw;
	if (def.type == 'toggle') v = (raw == '1');
	else if (def.type == 'number') v = +raw;
	// what the page sees: not the uci name, the apply command or the converters
	let out = { value: (def.to_page ? def.to_page(v) : v) };
	for (let k in [ 'id', 'type', 'label', 'note', 'confirm', 'options', 'min', 'max', 'step', 'unit' ])
		if (def[k] != null) out[k] = def[k];
	return out;
}

function uci_set(def, value) {
	let u = split(def.uci, '.');
	if (def.from_page) value = def.from_page(value);
	let v;
	if (def.type == 'toggle') v = value ? '1' : '0';
	else if (def.type == 'number') {
		v = +value;
		if (v != v || v < def.raw_min || v > def.raw_max) return 'out of range';
		v = `${int(v)}`;
	}
	else if (def.type == 'choice') {
		let ok = false;
		for (let o in def.options) if (`${o.value}` == `${value}`) ok = true;
		if (!ok) return 'not a choice';
		v = `${value}`;
	}
	let c = ctx.uci();
	c.set(u[0], u[1], u[2], v);
	c.commit(u[0]);
	if (def.apply) ctx.run(def.apply);
	return null;
}

function uci_category(id, label, defs, extra_items, extra_set) {
	return {
		id, label,
		items: function() {
			let out = map(defs, uci_item);
			if (extra_items) out = [ ...extra_items(), ...out ];
			return out;
		},
		set: function(item, value) {
			for (let d in defs)
				if (d.id == item) return uci_set(d, value);
			return extra_set ? extra_set(item, value) : 'no such setting';
		}
	};
}

const charge = uci_category('charge', L('充电', 'Charging'), [
	{ id: 'enabled', type: 'toggle', uci: 'e5-charge.main.enabled', default: '0',
	  label: L('充电上限', 'Charge limit'), apply: '/etc/init.d/e5-charge reload',
	  note: L('到上限停止充电，降到下限再充', 'Stop at the upper limit, charge again at the lower') },
	{ id: 'stop', type: 'number', uci: 'e5-charge.main.stop', default: '80', min: 50, max: 100, step: 5, unit: '%',
	  raw_min: 50, raw_max: 100, label: L('停止充电于', 'Stop at'), apply: '/etc/init.d/e5-charge reload' },
	{ id: 'start', type: 'number', uci: 'e5-charge.main.start', default: '70', min: 20, max: 95, step: 5, unit: '%',
	  raw_min: 20, raw_max: 95, label: L('恢复充电于', 'Charge again at'), apply: '/etc/init.d/e5-charge reload' }
], function() {
	let st = ctx.sh('/usr/libexec/e5-charge status 2>/dev/null') ?? '';
	let m = match(st, /capacity=([0-9]+) status=([^ ]+)/);
	let once = match(st, /full_once=1/);
	let paused = match(st, /stopped=1/);
	let word = !m ? null : paused ? L('已暂停充电', 'paused')
		: (m[2] == 'Charging') ? L('充电中', 'charging') : (m[2] == 'Full') ? L('已充满', 'full')
		: (m[2] == 'Discharging') ? L('使用电池', 'on battery') : L(m[2], m[2]);
	return [
		{ id: 'state', type: 'info', label: L('当前', 'Now'),
		  value: m ? L(`${m[1]}% · ${word.zh}`, `${m[1]}% · ${word.en}`) : '--' },
		{ id: 'full_once', type: 'action', label: once ? L('正在临时充满…', 'Charging to full…') : L('临时充满一次', 'Charge to full once'),
		  note: L('充到 100% 后回到上限', 'Back to the limit at 100 %') }
	];
}, function(item, value) {
	if (item != 'full_once') return 'no such setting';
	let c = ctx.uci();
	c.set('e5-charge', 'main', 'full_once', '1');
	c.commit('e5-charge');
	ctx.run('/etc/init.d/e5-charge reload');
	return null;
});

const notify = uci_category('notify', L('通知', 'Notifications'), [
	{ id: 'vibrate', type: 'toggle', uci: 'e5-notify.sms.vibrate', default: '1', label: L('短信震动', 'Vibrate on SMS') },
	{ id: 'screen', type: 'toggle', uci: 'e5-notify.sms.screen', default: '1', label: L('短信亮屏', 'Light up on SMS') }
], function() {
	return [ { id: 'test', type: 'action', label: L('试一下震动', 'Test the vibration') } ];
}, function(item, value) {
	if (item != 'test') return 'no such setting';
	ctx.run('(e5-sms-notify test) >/dev/null 2>&1 &');
	return null;
});

const screen = uci_category('screen', L('屏幕', 'Screen'), [
	// shown in percent, stored as the backlight level 1-255
	{ id: 'brightness', type: 'number', uci: 'e5-infoscreen.main.brightness', default: '120',
	  min: 5, max: 100, step: 5, unit: '%', raw_min: 1, raw_max: 255, label: L('亮度', 'Brightness'),
	  to_page: (v) => int((v * 100 + 127) / 255), from_page: (p) => int((+p * 255 + 50) / 100) },
	{ id: 'idle', type: 'choice', uci: 'e5-infoscreen.main.idle', default: '60', label: L('自动息屏', 'Screen off after'),
	  options: [ { value: '15', label: L('15 秒', '15 s') }, { value: '30', label: L('30 秒', '30 s') },
	             { value: '60', label: L('1 分钟', '1 min') }, { value: '120', label: L('2 分钟', '2 min') },
	             { value: '300', label: L('5 分钟', '5 min') }, { value: '0', label: L('从不', 'Never') } ] },
	{ id: 'touch', type: 'toggle', uci: 'e5-infoscreen.main.touch', default: '1', label: L('触摸', 'Touch'),
	  note: L('关闭后只用按键操作', 'Off: the keys only') },
	{ id: 'lang', type: 'choice', uci: 'e5-infoscreen.main.lang', default: 'zh', label: L('语言', 'Language'),
	  options: [ { value: 'zh', label: L('中文', '中文') }, { value: 'en', label: L('English', 'English') } ] }
]);

/* ---------- system ---------- */

// zonename -> the POSIX TZ string OpenWrt keeps in system.timezone
const ZONES = [
	[ 'Asia/Shanghai', 'CST-8', L('中国 (北京时间)', 'China (Beijing)') ],
	[ 'Asia/Hong_Kong', 'HKT-8', L('中国香港', 'China (Hong Kong)') ],
	[ 'Asia/Taipei', 'CST-8', L('中国台湾', 'China (Taiwan)') ],
	[ 'Asia/Singapore', '<+08>-8', L('新加坡', 'Singapore') ],
	[ 'Asia/Tokyo', 'JST-9', L('东京', 'Tokyo') ],
	[ 'Asia/Seoul', 'KST-9', L('首尔', 'Seoul') ],
	[ 'Asia/Kolkata', 'IST-5:30', L('印度', 'India') ],
	[ 'Asia/Dubai', '<+04>-4', L('迪拜', 'Dubai') ],
	[ 'Europe/Moscow', 'MSK-3', L('莫斯科', 'Moscow') ],
	[ 'Europe/Berlin', 'CET-1CEST,M3.5.0,M10.5.0/3', L('中欧 (柏林)', 'Central Europe (Berlin)') ],
	[ 'Europe/London', 'GMT0BST,M3.5.0/1,M10.5.0', L('伦敦', 'London') ],
	[ 'America/New_York', 'EST5EDT,M3.2.0,M11.1.0', L('美国东部', 'US Eastern') ],
	[ 'America/Chicago', 'CST6CDT,M3.2.0,M11.1.0', L('美国中部', 'US Central') ],
	[ 'America/Los_Angeles', 'PST8PDT,M3.2.0,M11.1.0', L('美国西部', 'US Pacific') ],
	[ 'UTC', 'UTC0', L('UTC', 'UTC') ]
];

function system_section() {
	let name = null;
	ctx.uci().foreach('system', 'system', (s) => { name ??= s['.name']; });
	return name;
}

const system_cat = {
	id: 'system', label: L('系统', 'System'),
	items: function() {
		let sec = system_section();
		let zone = sec ? ctx.uci().get('system', sec, 'zonename') : null;
		return [
			{ id: 'timezone', type: 'choice', label: L('时区', 'Time zone'), value: zone ?? 'UTC',
			  options: map(ZONES, (z) => ({ value: z[0], label: z[2] })),
			  note: L('屏幕会重新载入', 'The screen reloads') },
			{ id: 'clock_seconds', type: 'toggle', label: L('时间显示秒', 'Clock with seconds'),
			  value: ctx.uci().get('e5-infoscreen', 'main', 'clock_seconds') == '1' },
			{ id: 'version', type: 'info', label: L('镜像版本', 'Image'), value: ctx.read_trim('/etc/e5/image-version') ?? '--' },
			{ id: 'traffic_clear', type: 'action', label: L('清空流量记录', 'Clear traffic records'), confirm: true,
			  note: L('今日、本月和每日的统计都从零开始', 'Today, this month and the days start from zero') },
			{ id: 'reboot', type: 'action', label: L('重启', 'Reboot'), confirm: true },
			{ id: 'poweroff', type: 'action', label: L('关机', 'Power off'), confirm: true,
			  note: L('插着 USB 时可能会进入充电模式', 'With USB plugged in it may start in charging mode') },
			{ id: 'debian_once', type: 'action', label: L('下次启动 Debian', 'Boot Debian once'), confirm: true,
			  note: L('重启进 Debian 一次，再重启回到 OpenWrt', 'One boot of Debian, then OpenWrt again') },
			{ id: 'android_once', type: 'action', label: L('下次启动 Android', 'Boot Android once'), confirm: true,
			  note: L('重启进 Android 一次', 'One boot of Android') }
		];
	},
	set: function(id, value) {
		if (id == 'timezone') {
			let z = null;
			for (let e in ZONES) if (e[0] == value) z = e;
			let sec = system_section();
			if (!z || !sec) return 'unknown time zone';
			let c = ctx.uci();
			c.set('system', sec, 'zonename', z[0]);
			c.set('system', sec, 'timezone', z[1]);
			c.commit('system');
			// /etc/TZ for the system; the screen's WebKit reads TZ at its start
			ctx.run('/etc/init.d/system reload >/dev/null 2>&1');
			ctx.run('(sleep 2; /etc/init.d/e5-infoscreen restart) >/dev/null 2>&1 &');
			return null;
		}
		if (id == 'clock_seconds') {
			let c = ctx.uci();
			c.set('e5-infoscreen', 'main', 'clock_seconds', value ? '1' : '0');
			c.commit('e5-infoscreen');
			return null;
		}
		if (id == 'traffic_clear') {
			// a new, empty database: vnstat adds the configured interfaces again
			ctx.run('/etc/init.d/vnstat stop >/dev/null 2>&1; rm -f /etc/vnstat/vnstat.db; /etc/init.d/vnstat start >/dev/null 2>&1');
			return null;
		}
		if (id == 'reboot') { ctx.run('(sleep 2; reboot) >/dev/null 2>&1 &'); return null; }
		if (id == 'poweroff') { ctx.run('(sleep 2; poweroff) >/dev/null 2>&1 &'); return null; }
		if (id == 'debian_once') { ctx.run('(e5-os debian --once && sleep 2 && reboot) >/dev/null 2>&1 &'); return null; }
		if (id == 'android_once') { ctx.run('(e5-next-boot android && sleep 2 && reboot) >/dev/null 2>&1 &'); return null; }
		return 'no such setting';
	}
};

// (the devices category is its own view: /api/devices)
// (the AT page is its own view as well: /api/at, /api/at/presets)
return [ network, { id: 'at', label: L('AT 指令', 'AT commands'), view: 'at' },
         { id: 'devices', label: L('设备管理', 'Devices'), view: 'devices' },
         charge, notify, screen, system_cat ];

};
