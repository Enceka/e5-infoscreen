# e5-infoscreen

> 中文：[`README.zh-CN.md`](README.zh-CN.md)

An info screen for the Rongyue E5's 320×480 panel under OpenWrt, the OpenWrt
that [e5-linux](https://github.com/Enceka/e5-linux) runs on the device
(`openwrt/` there).  It shows the modem, the traffic, the hotspot and the
device at a glance, and is driven by touch and by the keypad.

| page | shows |
|---|---|
| Overview | download/upload rate, traffic since boot, network state (5G/4G, IPv4/IPv6), hotspot, clients, battery, battery current (+ charging, - discharging) and voltage |
| Signal | technology and band (n41, B3, ...), RSRP/RSRQ/SINR with grades, PCI, ARFCN, bandwidth, neighbour cells |
| Traffic | today's and this month's download/upload, since boot, the last 7 days (vnstat on the modem's interface, kept in `/etc/vnstat`) |
| SMS | the received messages, newest first, unread ones marked; open one to read it, delete it (press twice) |
| Hotspot | SSID, a QR code to join, the passphrase on request, on/off, the clients (Wi-Fi and USB) |
| Device | battery, uptime, time online, load, memory, LAN/IPv4/IPv6 addresses, brightness, reconnect |
| Details (高级信息) | device (system, image, kernel, storage, temperature, battery voltage); baseband (model, firmware, 5G SA, modes); band locks (LTE, NR) and cell locks, decoded from `AT+SPLBAND` / `AT+SPFORCEFRQ`; SIM (active slot, operator, registration); the identifiers on request |
| Settings (高级) | by function: **network** (network mode 5G/4G/3G, 5G/4G, 5G only (SA), 4G only; 5G access SA + NSA or NSA only; APN switch; LTE/NR band lock, default bands, cell lock; reconnect), **devices** (block internet, kick off Wi-Fi), **charging** (limit, resume level, charge to full once -- e5-linux's `e5-charge`), **notifications** (SMS vibration, light up), **screen** (brightness, screen-off time, language), **system** (time zone, clock with seconds, reboot, boot Debian or Android once), and each plugin's settings |
| Apps | the installed plugins; two come with it, a calculator and a network test |

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
* **Fonts**: Noto Sans CJK from the Debian root image the E5's OpenWrt runs
  from, bound in under `/usr/share/fonts` (WebKit's sandboxed web process sees
  `/usr`, not `/mnt`); DejaVu Sans as the fallback.
* **Screen power**: the backlight goes off after the idle time (60 s by
  default) or on the power key; the first touch or key after that only wakes
  the screen.

`/etc/init.d/e5-infoscreen` runs the three parts (`seatd`, `api`, `ui`) as procd
instances.

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
| volume | left to the volume |

## Plugins

A plugin is a directory under `/usr/share/e5-infoscreen/www/plugins/<id>/`: a
`manifest.json`, a page that loads `/sdk/e5.js`, and optionally a ucode
`backend.uc` and settings.  [`docs/API.md`](docs/API.md) is the reference for
the core API, the settings items, the SDK and the backend context.

## Install

On an E5 running e5-linux's OpenWrt, with the WAN up (the packages come from
OpenWrt's repositories):

```sh
./install.sh              # 192.168.9.1 over SSH
./install.sh 192.168.9.1
```

It installs `packages.txt` (about 200 MB with WebKit and Mesa), copies `root/`,
and enables and starts the service.  A reinstall keeps `/etc/config/e5-infoscreen`.

## Settings

`/etc/config/e5-infoscreen` (`uci`, then `/etc/init.d/e5-infoscreen restart`):

| option | default | |
|---|---|---|
| `enabled` | `1` | `0`: no info screen, the panel stays dark |
| `idle` | `60` | seconds before the backlight goes off, `0` never |
| `brightness` | `120` | backlight level while on, 1-255 (the Device page changes and saves it) |
| `lang` | `zh` | `zh` or `en` |

## Debugging

* `logread -e e5-infoscreen`: the compositor, and the page's console.
* `wget -q -O - http://127.0.0.1:8088/api/status` on the device: all the data.
* `/tmp/e5-infoscreen-keys.log`: the first 200 keys each start of the page,
  as WebKit reports them.

## License

MIT, see [`LICENSE`](LICENSE).
