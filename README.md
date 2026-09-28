# e5-infoscreen

> 中文：[`README.zh-CN.md`](README.zh-CN.md)

An info screen for the Rongyue E5's 320×480 panel under OpenWrt, the OpenWrt
that [e5-linux](https://github.com/Enceka/e5-linux) runs on the device
(`openwrt/` there).  It shows the modem, the traffic, the hotspot and the
device at a glance, and is driven by touch and by the keypad.

| page | shows |
|---|---|
| Overview | download/upload rate side by side, traffic since boot, network state (5G/4G, IPv4/IPv6), hotspot, clients, battery, battery current (+ charging, - discharging) and voltage, memory and storage in use (bars: yellow from 75 %, red from 90 %) |
| Signal | technology and band (n41, B3, ...), RSRP/RSRQ/SINR with grades, PCI, ARFCN, bandwidth, neighbour cells, the subscribed rate (the network's AMBR for the data context: `AT+CGEQOSRDP` / `AT+C5GQOSRDP`, with the QCI/5QI) |
| Traffic | today's and this month's download/upload, WAN (the modem's interface, what the carrier counts) and LAN (the bridge of USB and hotspot) apart; since boot and the last 7 days for the WAN (vnstat, kept in `/etc/vnstat`; 高级 -> 系统 clears it) |
| SMS | the received messages, newest first, unread ones marked; open one to read it, delete it (press twice) |
| Hotspot | SSID, a QR code to join, the passphrase on request, on/off, the clients (Wi-Fi and USB) |
| Device | battery, uptime, time online, load, memory, LAN/IPv4/IPv6 addresses, brightness, reconnect |
| Details (高级信息) | device (system, image, kernel, storage, temperature, battery voltage); baseband (model, firmware, 5G SA, modes); band locks (LTE, NR) and cell locks, decoded from `AT+SPLBAND` / `AT+SPFORCEFRQ`; SIM (active slot, operator, registration); the identifiers on request |
| Settings (高级) | by function: **network** (network mode 5G/4G/3G, 5G/4G, 5G only (SA), 4G only; 5G access SA + NSA or NSA only; APN switch, automatic from the SIM by default; LTE/NR band lock, default bands, cell lock; reconnect), **AT commands** (a list of reads, run and shown; any command through `/api/at`), **devices** (block internet, kick off Wi-Fi), **Bluetooth** (on/off, search, pair and connect headphones or speakers -- the sound then plays there -- disconnect, forget), **charging** (limit, resume level, charge to full once -- e5-linux's `e5-charge`), **notifications** (SMS vibration, light up, SMS sound), **sound** (volume, a test sound -- when e5-linux's `e5-volume` is there), **screen** (brightness, screen-off time, touch on/off, language), **system** (time zone, clock with seconds, clear traffic records, what the next reboot boots, the default boot (Linux or Android), reboot, power off, boot Android once; Debian once is `e5-os debian --once` on the command line), and each plugin's settings |
| Apps | the installed plugins; three come with it -- a calculator, a network test and the USB share |

The status bar carries the operator, the technology, signal bars, the battery
and the time, and ✉ with the number of unread messages.  A new message lights
the screen and opens itself (e5-linux's `e5-sms-notify` vibrates and keeps the
unread list, `/tmp/run/e5-sms/unread`; `e5-notify.sms.screen=0` turns the
lighting up off).  Opening the SMS page marks the messages read.  The SIM's
and the device's identities (IMEI, ICCID, IMSI, own number) are shown only on
the Advanced page, after "show identifiers", and served only by the one
endpoint that button calls (`/api/identity`).

## How it works

Everything is an OpenWrt package except the files in `root/`:

* **Display**: `cage`, a single-application Wayland compositor (wlroots), on
  the panel's KMS device, rendering with Mesa's **panfrost** driver on the
  Mali-G57 (`libmesa-panfrost`); `seatd` hands it the devices.
* **The page**: `cog`, the WPE WebKit browser, full screen, showing
  `http://127.0.0.1:8088/` (`root/usr/share/e5-infoscreen/www`).
* **The data**: a second `uhttpd` instance, on 127.0.0.1:8088 only, with a
  ucode handler (`api.uc`): ModemManager (`mmcli -J`), netifd, hostapd and
  the wireless configuration (ubus, uci), `/sys` for the battery, the
  backlight and the traffic counters.  Nothing outside the device reaches it,
  so it has no login; LuCI stays where it is, on port 80.
* **Fonts**: Noto Sans CJK, in the image when OpenWrt has one of its own
  (e5-linux's standalone install), else from the Debian root image it runs
  from, bound in under `/usr/share/fonts` (WebKit's sandboxed web process sees
  `/usr`, not `/mnt`); DejaVu Sans as the fallback.
* **Screen power**: the backlight goes off after the idle time (60 s by
  default) or on the power key; the first touch or key after that only wakes
  the screen -- unless the keys are locked (power, then `*`: see Keys).

`/etc/init.d/e5-infoscreen` runs the four parts (`seatd`, `api`, `ui`,
`usbguard`) as procd instances.  `usbguard` is `usr/libexec/e5-infoscreen/usb-guard`:
this kernel loses the USB gadget on a replug (it comes back with
`softconnect=0`, so the host enumerates nothing -- docs/USB-SHARE.md 2), and the
port leaves `br-lan` with it.  Nothing re-binds it after boot, so the guard does
two things, and only when something is wrong: an empty UDC is rebound, and a
cable that has not enumerated after GRACE seconds is rebound too (once per RETRY,
so a charger cannot turn it into a loop); `usb0` outside `br-lan` goes back in.
The rebind is unbind, pause 1 s, bind -- it costs the host one ping.  It logs
what it did (`logread -e e5-usb-guard`) and never takes `usb0` down.

Its window and manual way in is the app `usbshare` (USB 供网 in the apps list),
one of the three the image ships: one line for the three parts of the path
(link, uplink, gateway), one switch for auto-repair (with whether the guard is
running and how often it looks), and one Repair now button that re-enumerates,
puts `usb0` back into `br-lan` and gives the gateway back if it is missing.  It
lives in `root/usr/share/e5-infoscreen/www/plugins/usbshare` like the other two;
to install it on its own, `tar -czf usbshare-1.5.tar.gz -C
root/usr/share/e5-infoscreen/www/plugins usbshare`, then upload it in LuCI
(服务 → 信息屏应用) or run `/usr/libexec/e5-infoscreen/plugin install <file>` on
the device.  Its two settings (auto-repair, the check interval) also appear under
高级, and the guard reads them on every tick, so they take effect without a
restart.

## How the cable carries the internet

**The cable is the main path; Wi-Fi is only the emergency one.**  Three things have to hold, and
the app's status line reports them separately (`线通 · 上行通 · 已下发网关`):

| part | what is checked | when it is down |
|---|---|---|
| link | the gadget is bound and `configured`, `usb0` has carrier and is in `br-lan` | unbound / not enumerating / no host / not in br-lan |
| uplink | the device has an exit (netifd's `wan` is up; falls back to the default route) | `uplink down` -- the mobile side, which the app **never touches** (a reconnect storm got the SIM barred, e5-linux §28) |
| gateway | `dhcp.usbhost.dhcp_option` holds `3,192.168.9.1` | `no gateway` -- e5-linux's `90-e5` hands out the reserved lease and *deliberately* withholds the router option ("it has its own uplink"), leaving the PC with an address, DNS and IPv6 but **no IPv4 default route** |

`root/etc/uci-defaults/95-e5-infoscreen-usbhost` gives the gateway back: uci-defaults run in
lexical order, so `95-` lands after `90-e5` and wins.  The app's Repair now button also restores
the option (and restarts dnsmasq) when it is missing, on top of rebinding the gadget and putting
`usb0` back into `br-lan` -- you never have to work out which part broke.

On the PC side, pin the cable **below** Wi-Fi so it wins consistently (Windows otherwise picks by
link speed and the choice drifts).  Admin; undo with `metric=automatic`:

```bat
netsh interface ipv4 set interface "以太网 3" metric=5
netsh interface ipv6 set interface "以太网 3" metric=5
```

Leave Wi-Fi on automatic: the cable wins whenever it is up (5 < 35), and when it is unplugged its
routes disappear and Wi-Fi takes over -- which is the emergency case.

The LAN used to hand out IPv6 as well, and `lan.ip6assign '64'` put a /64 taken straight off the
cellular bearer on `br-lan` -- so a bearer reconnect renumbered the PC and stalled dual-stack
clients on the AAAA path for a few seconds.  On a cable-first device that is noise:
`root/etc/uci-defaults/96-e5-infoscreen-noipv6` stops the LAN advertising it (`dhcpv6` and `ra`
off) and leaves the bearer alone -- `wan.iptype` stays `ipv4v6`, because restarting the data unit
is what got the SIM barred.  Details and how to prove the RA stopped: `docs/USB-SHARE.md` §4.

## Keys

Measured on the device (WebKit's names in brackets):

| key | does |
|---|---|
| left / right | previous / next page |
| up / down | move between the buttons of a page, or scroll it |
| confirm (`KEY_SELECT`, "Unidentified") | press the focused button |
| back (`KEY_BACK` + BackSpace) | close the message, leave the button, or go to the first page |
| 1-9 | go to that page |
| side key (`F1`) | the hotspot page (to show the QR code) |
| power (`PowerOff`) | screen off |
| power, then `*` within 2 s | key lock: the screen stays dark -- no key, touch or new SMS lights it (the motor pulses once); power, then `*` again unlocks and lights it.  The volume keys still work |
| volume up / down | the speaker volume (16 levels, 0 mute), silently, with the level over the page; works with the screen dark, without lighting it |

## Plugins

A plugin is a directory under `/usr/share/e5-infoscreen/www/plugins/<id>/`: a
`manifest.json`, a page that loads `/sdk/e5.js`, and optionally a ucode
`backend.uc` and settings.  [`docs/API.md`](docs/API.md) is the reference for
the core API, the settings items, the SDK and the backend context.

## Apps

The Apps page shows the plugins; three come with the screen.  Install more in
LuCI (服务 -> 信息屏应用: upload a `.tar.gz` or `.zip`), uninstall there or
on the screen (高级 -> 应用管理).  The package format: [`docs/API.md`](docs/API.md) 5.5.

## Install

On an E5 running e5-linux's OpenWrt, with the WAN up (the packages come from
OpenWrt's repositories):

```sh
./install.sh              # 192.168.9.1 over SSH
./install.sh 192.168.9.1
```

It installs `packages.txt` (about 200 MB with WebKit and Mesa), copies `root/`,
runs the image's `uci-defaults` (`??-e5-infoscreen*`, in order), and enables and
starts the service.  A reinstall keeps `/etc/config/e5-infoscreen`.

## Settings

`/etc/config/e5-infoscreen` (`uci`, then `/etc/init.d/e5-infoscreen restart`):

| option | default | |
|---|---|---|
| `touch` | `1` | `0`: the panel ignores touch, the keys only |
| `enabled` | `1` | `0`: no info screen, the panel stays dark |
| `idle` | `60` | seconds before the backlight goes off, `0` never |
| `brightness` | `120` | backlight level while on, 1-255 (the Device page changes and saves it) |
| `lang` | `zh` | `zh` or `en` |
| `donate_seen` | (unset) | `1` once the 赞赏码 has been shown at the first start after an install; after that it is under 高级 -> 关于 -> 赞赏 only |

## Debugging

* `logread -e e5-infoscreen`: the compositor, and the page's console.
* `wget -q -O - http://127.0.0.1:8088/api/status` on the device: all the data.
* `/tmp/e5-infoscreen-keys.log`: the first 200 keys each start of the page,
  as WebKit reports them.

## Maintainer

Enceka <enceka@yeah.net>.  The screen shows this under 高级 -> 关于 (About).

## Disclaimer

Unofficial software, not affiliated with or endorsed by Rongyue or the makers
of the device and its chips.  It is provided "as is", without warranty of any
kind (see [`LICENSE`](LICENSE)).  What it can change -- the network mode, band
and cell locks, raw AT commands, charging -- can cut the connection, leave the
modem or the battery in an unexpected state, or void the device's warranty.
You use it at your own risk; check the local rules for the bands and radio
settings you choose.

## License

MIT, © 2026 Enceka, see [`LICENSE`](LICENSE).
