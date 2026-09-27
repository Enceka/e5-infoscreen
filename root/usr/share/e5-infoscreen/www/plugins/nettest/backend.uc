// The network test plugin's backend: GET /run pings the configured targets.
// A backend returns function(ctx) -> { "METHOD /path": function(req) }
// (docs/API.md, "Backend").

'use strict';

const TARGETS = {
	cn: [ [ '223.5.5.5', 'AliDNS' ], [ '119.29.29.29', 'DNSPod' ], [ '180.76.76.76', 'Baidu' ] ],
	global: [ [ '1.1.1.1', 'Cloudflare' ], [ '8.8.8.8', 'Google' ], [ '9.9.9.9', 'Quad9' ] ]
};

return function(ctx) {
	function setting(name, def) {
		return ctx.uci().get('e5-plugin-nettest', 'settings', name) ?? def;
	}

	return {
		'GET /run': function(req) {
			let set = TARGETS[setting('targets', 'cn')] ?? TARGETS.cn;
			let count = int(setting('count', '4'));
			if (count < 1 || count > 10) count = 4;
			let out = [];
			for (let t in set) {
				// the address comes from the table above, not from the request
				let r = ctx.sh(`ping -c ${count} -W 2 -q ${t[0]} 2>&1`) ?? '';
				let loss = match(r, /([0-9]+)% packet loss/);
				let rtt = match(r, /= ([0-9.]+)\/([0-9.]+)\/([0-9.]+)/);
				push(out, {
					host: t[0], name: t[1],
					loss: loss ? +loss[1] : 100,
					min: rtt ? +rtt[1] : null, avg: rtt ? +rtt[2] : null, max: rtt ? +rtt[3] : null
				});
			}
			ctx.state_put('last', { time: time(), results: out });
			return { results: out };
		},
		'GET /last': function(req) {
			return ctx.state_get('last') ?? { results: [] };
		}
	};
};
