// USB 共享（usbshare）的后端：PC 能不能通过网线上网，以及修一下。
//
// 「线通」和「能上网」是两件事，这里分成三段看：
//   链路  gadget 绑定并配置好、usb0 有载波、在 br-lan 里；
//   上行  设备自己有出口（移动数据的默认路由）；
//   网关  给 USB 侧下发了 IPv4 网关——e5-linux 的 90-e5 只给静态租约、故意
//         不给网关（"it has its own uplink"），PC 于是有地址没路由可走，
//         适配器显示「无 Internet」。95-e5-infoscreen-usbhost 把它补回来。
//
// 重绑的原因见根目录 README：这个内核重新插拔后会带着 softconnect=0 重启
// gadget（docs/USB-SHARE.md 2），主机枚举不到设备。

'use strict';

const GADGET = '/sys/kernel/config/usb_gadget/linux';
const DEFAULT_UDC = 'musb-hdrc.1.auto';
const BR = 'br-lan';
const NETDEV = 'usb0';
const VBUS = '/sys/class/power_supply/usb/online';
const CFG = 'e5-plugin-usbshare';
const PIDFILE = '/var/run/e5-usb-guard.pid';
const LAN = '192.168.9.1';		// br-lan's address, and the gateway the PC needs

return function(ctx) {
	function present(path) {
		return ctx.run(`test -e ${path}`) == 0;
	}

	function udc() {
		let u = ctx.read_trim(`${GADGET}/UDC`);
		return (u != null && u != '') ? u : DEFAULT_UDC;
	}

	function bound() {
		let u = ctx.read_trim(`${GADGET}/UDC`);
		return u != null && u != '';
	}

	// not-attached / attached / powered / default / address / configured
	function state() {
		return ctx.read_trim(`/sys/class/udc/${udc()}/state`);
	}

	// Unbind, pause, bind: the host only comes back through a re-enumeration.
	// Always done, even when this side reads "configured" -- the state a replug
	// leaves behind is not the whole story, and the pause costs the host one
	// ping (measured).
	function rebind() {
		let u = udc();
		ctx.run(`echo "" > ${GADGET}/UDC`);
		ctx.run('sleep 1');
		ctx.run(`echo ${u} > ${GADGET}/UDC`);
		return u;
	}

	// 10-e5-usb0's three lines: the initramfs may have left 192.168.77.1 on usb0
	function enslave() {
		ctx.run(`ip -4 addr flush dev ${NETDEV}`);
		ctx.run(`echo 1 > /proc/sys/net/ipv6/conf/${NETDEV}/disable_ipv6`);
		ctx.run(`ip link set ${NETDEV} master ${BR}`);
		ctx.run(`ip link set ${NETDEV} up`);
	}

	// The device's own uplink.  netifd knows; the route is the fallback for a
	// status call that does not answer.
	function wan_up() {
		let r = ctx.sh("ubus call network.interface.wan status 2>/dev/null | jsonfilter -e '@.up'") ?? '';
		if (trim(r) == 'true')
			return true;
		if (trim(r) == 'false')
			return false;
		return ctx.run('ip -4 route show default | grep -q .') == 0;
	}

	// Does the USB host get a router option?  uci keeps it as a list, and an
	// empty "3" means dnsmasq withholds option 3 for that tag.
	function gw_on() {
		let r = ctx.sh(`uci -q get dhcp.usbhost.dhcp_option 2>/dev/null`) ?? '';
		for (let tok in split(trim(r), ' ')) {
			let t = trim(tok);
			if (match(t, /^3,/) != null && index(t, LAN) != null)
				return true;
		}
		return false;
	}

	// Only our own option 3 is touched: the tag and the reserved lease are
	// e5-linux's 90-e5, and the bearer is e5-bearer-watch's business (a
	// reconnect storm once got the SIM barred -- never restart the data unit
	// from here).
	function give_gw() {
		ctx.run('uci -q set dhcp.usbhost=tag');
		ctx.run('uci -q delete dhcp.usbhost.dhcp_option');
		ctx.run(`uci -q add_list dhcp.usbhost.dhcp_option='3,${LAN}'`);
		if (ctx.run('uci -q commit dhcp') != 0)
			return false;
		ctx.run('/etc/init.d/dnsmasq restart');
		return true;
	}

	// The guard's pidfile is on tmpfs and removed on the way out, but a stale
	// pid may have gone to another process, so ask it what it is.
	// (/proc/<pid>/cmdline is read with a command: its stat size is 0, so
	// readfile comes back empty.)
	function guard_pid() {
		let pid = ctx.read_trim(PIDFILE);
		if (pid == null || pid == '' || match(pid, /[^0-9]/) != null)
			return null;
		if (ctx.run(`grep -q usb-guard /proc/${pid}/cmdline 2>/dev/null`) != 0)
			return null;
		return +pid;
	}

	function setting(name, def) {
		return ctx.uci().get(CFG, 'settings', name) ?? def;
	}

	function settings() {
		return {
			guard: setting('guard', '1') != '0',
			interval: +setting('interval', '3')
		};
	}

	// Three answers and the first one that is wrong, as a code -- the page owns
	// the words, this file stays the only place that knows sysfs and uci.
	function status() {
		let s = bound() ? state() : null, link = true, why = null;
		if (!bound()) {
			link = false;
			why = 'unbound';
		} else if (s != 'configured') {
			link = false;
			why = (ctx.read_trim(VBUS) == '1') ? 'no-enum' : 'no-host';
		} else if (!present(`/sys/class/net/${NETDEV}`)) {
			link = false;
			why = 'no-netdev';
		} else if (ctx.read_trim(`/sys/class/net/${NETDEV}/carrier`) != '1') {
			link = false;
			why = 'no-carrier';
		} else if (!present(`/sys/class/net/${BR}/brif/${NETDEV}`)) {
			link = false;
			why = 'no-bridge';
		}
		let wan = wan_up(), gw = gw_on();
		if (link && !wan)
			why = 'no-wan';
		else if (link && !gw)
			why = 'no-gw';
		let pid = guard_pid(), st = settings();
		return {
			up: link && wan && gw,
			why: why,
			link: link,
			wan: wan,
			gw: gw,
			state: s,
			guard: { running: pid != null, on: st.guard, interval: st.interval }
		};
	}

	// The settings are uci options.  The config file does not exist until the
	// first change (the screen's own plugin settings code has the same
	// problem: without the file, set() and commit() have nothing to write to),
	// and the section has to be made before the option can go in.
	function store(name, value) {
		ctx.run(`touch /etc/config/${CFG}`);
		let c = ctx.uci();
		if (c.get(CFG, 'settings') == null)
			c.set(CFG, 'settings', 'settings');
		c.set(CFG, 'settings', name, value);
		c.commit(CFG);
	}

	return {
		'GET /status': function(req) {
			return status();
		},
		// Re-enumerate, put usb0 back, and give the gateway back if it is gone:
		// whatever of the three is wrong, this is the part an app can do.
		'POST /fix': function(req) {
			let u = rebind();
			enslave();
			let gw = false;
			if (!gw_on()) {
				give_gw();
				gw = true;
			}
			return { ok: true, udc: u, gw: gw };
		},
		// the manifest's two settings, so the app's own row can flip them too.
		// The reply carries the settings as they are stored afterwards, so the
		// page never has to guess.
		'POST /settings': function(req) {
			let b = req.body ?? {};
			if (b.guard != null)
				store('guard', b.guard ? '1' : '0');
			if (b.interval != null) {
				let iv = +b.interval;
				if (iv < 1 || iv > 60)
					return { ok: false, error: 'the interval is 1-60 s' };
				store('interval', `${iv}`);
			}
			return { ok: true, settings: settings() };
		}
	};
};
