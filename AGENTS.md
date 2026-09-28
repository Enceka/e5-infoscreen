# Notes for agents working on this repo

Everything under `root/` is copied onto a running device and unpacked at `/`.  A
mistake there can take away the network *and* the console at the same time, so:

* **Keep every file LF.**  A CRLF shebang becomes `#!/bin/sh /etc/rc.common\r` and
  the device answers `can't open '/etc/rc.common'`.  Git on Windows defaults to
  `core.autocrlf=true`; `.gitattributes` (`* text=auto eol=lf`) is what stops it.
  Check with `tr -cd '\r' < file | wc -c`, not with `grep -c $'\r'`.
* **Ship new scripts `755`.**  `git add --chmod=+x` records the mode; a copy that
  lands `644` is skipped by the boot-time `uci-defaults` runner.
* **`uci-defaults` run in lexical order.**  e5-linux's own `90-e5` is the one that
  has to be overruled, so a file that must win is named above it; `install.sh` has
  to actually run it too (its glob is the list of numbers it knows about).
* **The device is the only source of truth.**  A sandbox can check syntax; it
  cannot tell you whether the gadget re-bound, whether `usb0` is in `br-lan`,
  whether a browser appeared, or what dnsmasq generated.  Read it from the device:
  `logread`, `/sys/kernel/config/usb_gadget/*/`, `uci show`, `ip -br addr`.
* **Test both ends.**  "The link is up" and "the host has internet" are different
  claims; so are "dnsmasq has the option" and "the adapter got a default route".
  See `docs/USB-SHARE.md` §5 for the probe set.
* **Assume the SSH session rides the link you are about to break.**  The USB host
  and the hotspot share `192.168.9.0/24`, so a rebind or a `network reload` can cut
  your own transport.  Pin the session to the other interface first, and expect
  `Socket exception … 10054` when you get it wrong.
* **Two things are off limits:** taking `usb0` down (the vendor NCM function once
  overwrote kernel memory with `usb0` as a plain bridge port), and restarting the
  mobile data unit (a reconnect storm got the SIM barred, cf. `docs/USB-SHARE.md` §1).

ucode, as this image builds it (`backend.uc` is raw mode, no `{% %}`):

* no `lower()` — use `lc()`; `match()`, `index()`, `substr()`, `split()`, `??` are
  there; a missing file and a **directory** both read as `null` (use `ctx.run('test -e …')`
  when that matters).
* `ctx.read_trim('/proc/<pid>/cmdline')` is always empty (the file is NUL-separated):
  ask `ctx.run('grep -q … /proc/<pid>/cmdline') == 0` instead.
* `JSON null` survives, but a **nil array element is dropped**, so an array of
  optional parts silently loses its shape — emit a flat object or strings.
* writing uci fails **silently** when the config file does not exist yet: create
  the file/section, then commit.
* busybox ash has no `curl` and no `wget` applet; `uclient-fetch -qO- <url>` is the
  bare HTTP probe on the device.

The device-side API lives on `http://127.0.0.1:8088` only (LuCI is on :80); the
plugin contract is [`docs/API.md`](docs/API.md), and the USB path is
[`docs/USB-SHARE.md`](docs/USB-SHARE.md).
