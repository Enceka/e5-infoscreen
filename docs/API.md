# e5-infoscreen API, version 1

> 中文：[`API.zh-CN.md`](API.zh-CN.md)

The info screen is a web page (`www/`) and a local HTTP API (`api.uc`), served by
their own uhttpd on **`http://127.0.0.1:8088`**.  Plugins extend both: a page of
their own in the Apps list, optionally a backend under `/api/plugins/<id>/`, and
optionally settings in the 高级 (settings) menu.  This document is the contract
for version 1 of all three.

## 1. Conventions

* **Local only.**  The server listens on 127.0.0.1; nothing outside the device
  reaches it, which is why there is no login.  Do not expose it (no port
  forward, no proxy from LuCI).
* **Trust.**  A plugin backend runs inside the API server, as root, with the
  helpers of section 5.3.  Installing a plugin means trusting it with the
  device.  Only install plugins you have read.
* **JSON** in and out (`Content-Type: application/json`).  A POST body is one
  JSON object, at most 4 KiB.  An error is a non-2xx status with
  `{ "error": "<text>" }`.
* **Text for people** is `{ "zh": "...", "en": "..." }` wherever it is shown on
  the screen (labels, notes, names); the page picks the screen's language and
  falls back to `zh`.  Plain strings are shown as they are.
* **Identifiers** (IMEI, ICCID, IMSI, own number) come from `/api/identity`
  alone.  A plugin must not show or send them without the user asking.
* **Versions.**  `api_version` is 1.  Within version 1, fields and endpoints are
  only added, never renamed or removed; a plugin ignores fields it does not
  know.  A plugin whose manifest asks for a higher `api_version` than the
  screen's is not loaded.

## 2. Core API

`GET /api/<name>` unless marked POST.  Values the device does not have are
`null`.

| Endpoint | Returns / does |
|---|---|
| `GET /status` | everything the pages show, polled every 2 s (below) |
| `GET /traffic` | `{ available, today, month, total, days[] }`, each `{ rx, tx }` in bytes (vnstat, the modem's interface); `days` the last 7, `{ date: "MM-DD", rx, tx }` |
| `GET /sms` | `{ messages: [ { id, number, text, time, state, type, unread } ] }`, newest first; `time` ISO 8601 |
| `POST /sms-read` | all messages seen (clears the unread list) |
| `POST /sms-delete` | `{ id }` -- deletes the message from the SIM/modem |
| `GET /qr` | the hotspot's join code, `image/svg+xml` |
| `GET /wifi-key` | `{ key }` -- the hotspot passphrase |
| `POST /wifi` | `{ on: true\|false }` -- hotspot on/off |
| `POST /backlight` | `{ level: 0-255, save: bool }` -- `save` makes it the level the screen comes back to |
| `POST /wan-reconnect` | restarts the mobile connection |
| `GET /advanced` | device, baseband, locks, SIM details (the 高级信息 page) |
| `GET /identity` | `{ imei, iccid, imsi, numbers[] }` |
| `GET /settings` | `{ categories: [ { id, label, view, plugin } ] }` |
| `GET /settings/<category>` | `{ id, label, items[] }` (section 3) |
| `POST /settings/<category>` | `{ id, value }` (or `{ id }` for an action) -> `{ ok, error, item }`, the item read back |
| `GET /devices` | `{ devices: [ { mac, ip, name, via, online, signal, blocked } ] }` |
| `POST /devices` | `{ mac, action: "block"\|"unblock"\|"kick" }` -> `{ ok, error, devices }` |
| `GET /plugins` | `{ api_version, plugins: [ manifest + { has_backend } ] }` |
| `* /plugins/<id>/<path>` | the plugin's backend (section 5.3) |

`GET /status`:

```json
{
  "time": 1790479780, "tz_offset": 28800, "clock": "10:46",
  "modem": { "present": true, "state": "connected", "operator": "CHINA BROADNET",
             "registration": "home", "tech": "5gnr", "quality": 67, "sim": true,
             "signal": { "rsrp": -103.0, "rsrq": -22.5, "snr": -10.5 },
             "cell": { "type": "5gnr", "serving": true, "pci": 169, "arfcn": 504990,
                       "band": "n41", "rsrp": -97.3, "rsrq": -12.3, "sinr": 4.6,
                       "bandwidth_mhz": 100 },
             "neighbours": 5 },
  "wan": { "up": true, "uptime": 1519, "ipv4": "10.1.2.3", "ipv6": "240a:...",
           "ipv6_prefix": "240a:.../64", "dns": [ "..." ] },
  "traffic": { "rx_total": 101641661, "tx_total": 47712286, "rx_rate": 1204.5, "tx_rate": 88.0 },
  "wifi": { "ssid": "E5-Linux", "enabled": true, "up": true, "channel": "149", "band": "5g", "secured": true },
  "clients": [ { "name": "phone", "ip": "192.168.9.12", "mac": "..", "via": "wifi", "signal": -52 } ],
  "battery": { "capacity": 99, "status": "Charging", "current_ma": 194, "voltage_mv": 4350, "online": true },
  "system": { "uptime": 5321, "load": 0.42, "mem_total": 1538670592, "mem_available": 794218496, "lan_ip": "192.168.9.1" },
  "screen": { "idle": 60, "brightness": 120, "lang": "zh" },
  "sms": { "unread": [ 3 ], "screen": true }
}
```

Rates are bytes per second over the time since the previous poll (`null` on
the first).  The modem part is cached for 10 s.

## 3. Settings items

A category's `items` are drawn by type; a plugin's settings use the same shape.

| Field | |
|---|---|
| `id` | unique in the category |
| `type` | `toggle` (value `true`/`false`), `choice` (value + `options`), `number` (value + `min`, `max`, `step`, `unit`), `multi` (value = array of option values; none chosen means "no restriction"), `action` (no value; pressing it runs it), `info` (read-only text) |
| `label`, `note` | `{ zh, en }`; `note` is shown under the item |
| `options` | `[ { value, label } ]` |
| `confirm` | `true`: the change needs a second press within 3 s (used for what can cut the connection) |
| `value` | the current value, read back after a change |

## 4. Keys

The page and the SDK report keys as kinds, measured on the E5's keypad:

| Kind | Key | Notes |
|---|---|---|
| `left` `right` `up` `down` | the navigation keys | on the host: pages, focus |
| `ok` | confirm (`KEY_SELECT`, reported by WebKit as "Unidentified"/0) | |
| `back` | back (`KEY_BACK` + BackSpace, one press) | the SDK folds the pair into one |
| `digit` | `0`-`9`, `*` | `key` has the character |
| `power` | power (`PowerOff`) | always the host's: screen off |
| `other` | side key (`F1`), volume, ... | volume is left to the volume |

## 5. Plugins

### 5.1 Layout

```
/usr/share/e5-infoscreen/www/plugins/<id>/
    manifest.json      required
    index.html         the page (the manifest's "entry")
    backend.uc         optional: /api/plugins/<id>/...
    ...                anything else the page loads (relative URLs)
```

`<id>`: lower-case letters, digits, `-` and `_`, starting with a letter or digit;
it is the directory name and the manifest's `id`.  Install by copying the
directory; remove by deleting it.  No restart: the Apps page reads the list
each time it is opened, the settings menu each time it is loaded.

### 5.2 `manifest.json`

```json
{
  "id": "nettest",
  "api_version": 1,
  "version": "1.0",
  "name": { "zh": "网络测试", "en": "Network test" },
  "description": { "zh": "延迟和丢包", "en": "Latency and loss" },
  "entry": "index.html",
  "order": 30,
  "settings": [
    { "id": "count", "type": "number", "uci": "e5-plugin-nettest.settings.count",
      "default": "4", "min": 1, "max": 10, "step": 1,
      "label": { "zh": "每个目标的次数", "en": "Pings per target" } }
  ]
}
```

| Field | |
|---|---|
| `id`, `api_version`, `name` | required |
| `version`, `description` | shown in the Apps list |
| `entry` | the page, relative to the directory; default `index.html` |
| `order` | position in the Apps list, low first; default 50 |
| `settings` | items (section 3) of type `toggle`, `choice` or `number`, each stored in the uci option `uci` (`config.section.option`), with `default` when it is unset.  They appear as a category of their own in 高级.  Use a config named `e5-plugin-<id>`; it is created on the first change. |

### 5.3 Frontend

The page runs in a frame over the pages (320×480, the status bar above it, the
footer below: about 320×424 CSS pixels).  Load the SDK first:

```html
<script src="/sdk/e5.js"></script>
```

| SDK | |
|---|---|
| `e5.id`, `e5.lang`, `e5.version` | the plugin's id, `zh`/`en`, the API version |
| `e5.api(path, { body, method })` | `fetch` of `/api/plugins/<id><path>`; with `body` it is a POST of JSON; resolves to the reply (JSON or text), rejects with `.status` and `.data` on a non-2xx |
| `e5.core(path, opts)` | the same for the core API, `/api/<path>` (section 2) |
| `e5.onKey(fn)` | `fn({ kind, key, code, repeat })` for each key; return `true` when taken |
| `e5.onBack(fn)` | `fn()` on back when `onKey` did not take it; return `true` to stay, anything else closes the plugin |
| `e5.onLang(fn)` | the screen's language changed, `fn(lang)` |
| `e5.toast(text)` | a short message over the screen |
| `e5.keepAwake(on)` | `true`: the screen does not go dark while the plugin is open (a timer, a test running); set it back to `false` |
| `e5.exit()` | close the plugin |
| `e5.t({ zh, en })` | the text in the screen's language |
| `e5.tzOffset`, `e5.time(ms)` | the device's offset from UTC (s); a time as `HH:MM:SS` in the device's zone.  WebKit has no zoneinfo on OpenWrt, so `Date`'s local time is UTC: use these (or `tz_offset` from `/status`). |

While the screen is dark the SDK swallows keys (the host wakes the screen); the
power key is the host's.  Touch works as in any page.  Use large text and a dark
background (the screen's own look: `#0b0e13`, cards `#161b23`, text `#e8ecf2`);
the fonts are Noto Sans CJK SC and DejaVu Sans.

Without the SDK, the protocol is `postMessage` with the parent frame:
plugin -> host `{ e5: "ready" }`, `{ e5: "key", kind, key, code, keyCode, repeat }`
(every key, so the host can wake the screen and reset its idle timer),
`{ e5: "exit" }`, `{ e5: "toast", text }`, `{ e5: "keep-awake", on }`;
host -> plugin `{ e5: "hello", lang, api_version, blank }`, `{ e5: "blank", on }`.

### 5.4 Backend

`backend.uc` is ucode (raw mode, no `{% %}`) that returns a function taking the
context and returning the routes:

```js
'use strict';
return function(ctx) {
	return {
		'GET /hello': function(req) {
			return { text: 'hello', uptime: ctx.read_trim('/proc/uptime') };
		},
		'POST /echo': function(req) {
			return { got: req.body };
		}
	};
};
```

* A route is `"<METHOD> <path>"`, the path after `/api/plugins/<id>`; `/` for
  none.
* `req` is `{ method, path, query, body }`: `query` the parsed query string,
  `body` the parsed JSON of a POST.
* A handler returns an object (sent as JSON), or `{ status, type, body }` for
  anything else (`body` a string).
* It runs in the API server for each request -- nothing survives in a
  variable between requests (keep state with `ctx.state_put`), and a request
  has 30 s.  Start long work in the background (`ctx.run('... &')`) and let
  the page poll a route that reads its state.

`ctx`:

| | |
|---|---|
| `ctx.api_version` | 1 |
| `ctx.sh(cmd)` | runs a shell command, its output (string) or `null`.  Never build `cmd` from `req` without quoting: `req` is data. |
| `ctx.sh_json(cmd)` | the same, parsed as JSON (`null` if it is not) |
| `ctx.run(cmd)` | runs a command, its exit status |
| `ctx.at(cmd)` | an AT command through ModemManager (the AT channel has one owner), the reply without `OK`, or `null`.  Commands that write the IMEI or NV are not for plugins. |
| `ctx.modem()` | the `modem` part of `/status` |
| `ctx.cells()` | the serving and neighbour cells, `[ { type, serving, pci, arfcn, band, rsrp, rsrq, sinr, bandwidth_mhz } ]` |
| `ctx.ubus(object, method, args)` | a ubus call, its reply or `null` |
| `ctx.uci()` | a uci cursor (`get`, `set`, `commit`, `foreach`, ...) |
| `ctx.state_get(name, max_age_s)`, `ctx.state_put(name, value)` | JSON state that outlives the request, per plugin (under `/tmp/run`, so not across a reboot); `state_get` returns `null` when older than `max_age_s` |
| `ctx.forget(name)` | removes a state |
| `ctx.read_trim(path)`, `ctx.read_num(path)` | a file's content, trimmed / as a number |
| `ctx.log(text)` | a line in the system log (`logread -e e5-infoscreen/<id>`) |

The two plugins in `www/plugins/` are the examples: `calculator` (a page, keys,
`onBack`) and `nettest` (a backend, settings, `keepAwake`).
