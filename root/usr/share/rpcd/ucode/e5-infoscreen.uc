// The info screen's apps for LuCI (服务 -> 信息屏应用): rpcd object
// "e5-infoscreen" over /usr/libexec/e5-infoscreen/plugin.  The package to
// install is the file LuCI's upload wrote, and only that one.
'use strict';

import { popen, unlink } from 'fs';

const TOOL = '/usr/libexec/e5-infoscreen/plugin';
const UPLOAD = '/tmp/e5-plugin.upload';

function run(cmd) {
	let p = popen(`${cmd} 2>&1`);
	let out = p ? p.read('all') : '';
	let rc = p ? p.close() : -1;
	return { rc, out: trim(out ?? '') };
}

return {
	'e5-infoscreen': {
		list: {
			call: function() {
				let apps = [];
				for (let line in split(run(`${TOOL} list`).out, '\n')) {
					let f = split(line, '\t');
					if (length(f) >= 3 && f[0] != '')
						push(apps, { id: f[0], version: f[1], builtin: f[2] == 'builtin', name: f[3] ?? f[0] });
				}
				return { apps };
			}
		},
		install: {
			call: function() {
				let r = run(`${TOOL} install ${UPLOAD}`);
				unlink(UPLOAD);
				return { ok: r.rc == 0, message: r.out };
			}
		},
		remove: {
			args: { id: '' },
			call: function(req) {
				let id = req.args?.id ?? '';
				if (!match(id, /^[a-z0-9][a-z0-9_-]*$/))
					return { ok: false, message: 'bad id' };
				let r = run(`${TOOL} remove ${id}`);
				return { ok: r.rc == 0, message: r.out };
			}
		}
	}
};
