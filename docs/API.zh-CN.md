# e5-infoscreen API，第 1 版

> English: [`API.md`](API.md)

信息屏由网页（`www/`）和本地 HTTP 接口（`api.uc`）组成，由独立的 uhttpd 提供服务，
地址是 **`http://127.0.0.1:8088`**。插件可以扩展这两部分：在“应用”列表里放自己的页面，
也可以在 `/api/plugins/<id>/` 下提供后端，还可以在“高级”菜单里加入自己的设置项。本文是
这三者第 1 版的约定。

## 1. 约定

* **仅限本机。** 服务只监听 127.0.0.1，设备外部访问不到，所以没有登录。不要把它暴露
  出去（不做端口转发，也不从 LuCI 代理）。
* **信任。** 插件后端运行在接口服务里，身份是 root，可以使用 5.4 节的辅助函数。安装
  插件就等于把设备交给它，只安装你看过代码的插件。
* 输入输出都是 **JSON**（`Content-Type: application/json`）。POST 的请求体是一个 JSON
  对象，最大 4 KiB。出错时返回非 2xx 状态码和 `{ "error": "<说明>" }`。
* **显示给人看的文字**（标签、说明、名称）写成 `{ "zh": "...", "en": "..." }`，页面按屏幕
  语言选择，缺省用 `zh`。普通字符串原样显示。
* **识别码**（IMEI、ICCID、IMSI、本机号码）只由 `/api/identity` 提供。插件不得在用户没有
  要求时显示或发送它们。
* **版本。** `api_version` 为 1。在第 1 版之内，字段和接口只增不改、不删；插件应忽略自己
  不认识的字段。manifest 要求的 `api_version` 高于信息屏的插件不会被加载。

## 2. 核心接口

未注明 POST 的都是 `GET /api/<名称>`。设备上没有的值为 `null`。

| 接口 | 返回 / 作用 |
|---|---|
| `GET /status` | 各页面显示的全部数据，页面每 2 秒读一次（见下） |
| `GET /traffic` | `{ wan, lan }`，各为 `{ available, since, today, month, total, days[] }`，其中 `{ rx, tx }` 单位字节（vnstat；`wan` 为模组数据接口，`lan` 为局域网网桥）；`days` 是最近 7 天，`{ date: "MM-DD", rx, tx }`；`since` 为开始统计的时间。`wan` 的字段在顶层也有一份。 |
| `GET /sms` | `{ messages: [ { id, number, text, time, state, type, unread } ] }`，新的在前；`time` 为 ISO 8601 |
| `POST /sms-read` | 全部标为已读（清空未读列表） |
| `POST /sms-delete` | `{ id }`，从 SIM 卡/模组删除该短信 |
| `GET /qr` | 热点的连接二维码，`image/svg+xml` |
| `GET /wifi-key` | `{ key }`，热点密码 |
| `POST /wifi` | `{ on: true\|false }`，开关热点 |
| `POST /backlight` | `{ level: 0-255, save: bool }`；`save` 表示把它作为亮屏时恢复的亮度 |
| `POST /wan-reconnect` | 重新建立移动网络连接 |
| `GET /advanced` | 设备、基带、锁定、SIM 的详细信息（“高级信息”页） |
| `GET /identity` | `{ imei, iccid, imsi, numbers[] }` |
| `POST /at` | `{ cmd, timeout }`，返回 `{ ok, reply }` 或 `{ ok: false, error }`；对可能让 CP 的 AT 服务（`ATZ`、`AT&F`、`+CPMS=`）或 SIM 卡（`+CFUN=0`、`+SFUN=3`/`5`）直到重启都不可用的指令，额外返回 `warning: true`（e5-linux 的 `e5-at` 同样只是提醒，不再拒绝任何指令）：通过 ModemManager（AT 通道唯一的所有者）发一条 AT 指令，`timeout` 为 1-60 秒（默认 10）。这是原始的指令通道，回复里可能含有识别码。 |
| `GET /at/presets` | `{ presets: [ { cmd, label } ] }`，即“高级 → AT 指令”页的只读指令 |
| `GET /settings` | `{ categories: [ { id, label, view, plugin } ] }` |
| `GET /settings/<分类>` | `{ id, label, items[] }`（见第 3 节） |
| `POST /settings/<分类>` | `{ id, value }`（动作只传 `{ id }`），返回 `{ ok, error, item }`，item 为修改后读回的值 |
| `GET /devices` | `{ devices: [ { mac, ip, name, via, online, signal, blocked } ] }` |
| `POST /devices` | `{ mac, action: "block"\|"unblock"\|"kick" }`，返回 `{ ok, error, devices }` |
| `GET /plugins` | `{ api_version, plugins: [ manifest + { has_backend } ] }` |
| `* /plugins/<id>/<路径>` | 插件自己的后端（第 5.4 节） |

`GET /status` 的内容与英文版相同（见 [`API.md`](API.md) 第 2 节的示例）：`modem`、`wan`、
`traffic`（`rx_rate`/`tx_rate` 为距上次读取的每秒字节数，第一次为 `null`）、`wifi`、
`clients`、`battery`、`system`（含 `disk_total`/`disk_used`：根文件系统，`df /`，缓存 60 秒）、`screen`、`sms`。模组部分缓存 10 秒。

## 3. 设置项

分类的 `items` 按类型绘制；插件的设置项格式相同。

| 字段 | 说明 |
|---|---|
| `id` | 在分类内唯一 |
| `type` | `toggle`（值为 `true`/`false`）、`choice`（值 + `options`）、`number`（值 + `min`、`max`、`step`、`unit`）、`multi`（值为选项值的数组；一个都不选表示不限制）、`action`（无值，按下即执行）、`info`（只读文字） |
| `label`、`note` | `{ zh, en }`；`note` 显示在该项下面 |
| `options` | `[ { value, label } ]` |
| `confirm` | `true`：需要在 3 秒内再按一次才生效（用于可能断网的操作） |
| `value` | 当前值，修改后会重新读回 |

## 4. 按键

页面和 SDK 以“类型”报告按键，均在 E5 的键盘上实测：

| 类型 | 按键 | 说明 |
|---|---|---|
| `left` `right` `up` `down` | 方向键 | 主程序中用于翻页和移动焦点 |
| `ok` | 确认（`KEY_SELECT`，WebKit 报告为 "Unidentified"/0） | |
| `back` | 返回（`KEY_BACK` + BackSpace，一次按下） | SDK 会把这一对合并成一次 |
| `digit` | `0`-`9`、`*` | `key` 里是对应字符 |
| `power` | 电源（`PowerOff`） | 始终归主程序：关屏 |
| `other` | 侧键（`F1`）、音量等 | 音量键保留给音量 |

## 5. 插件

### 5.1 目录结构

```
/usr/share/e5-infoscreen/www/plugins/<id>/
    manifest.json      必需
    index.html         页面（manifest 的 "entry"）
    backend.uc         可选：/api/plugins/<id>/...
    ...                页面用到的其他文件（相对路径）
```

`<id>` 由小写字母、数字、`-` 和 `_` 组成，以字母或数字开头；它就是目录名，也是
manifest 的 `id`。复制目录即安装，删除目录即卸载，不需要重启：“应用”页每次打开都会
重新读取列表，“高级”菜单每次加载也会重新读取。

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

| 字段 | 说明 |
|---|---|
| `id`、`api_version`、`name` | 必需 |
| `version`、`description` | 显示在“应用”列表里 |
| `entry` | 页面文件，相对于插件目录；默认 `index.html` |
| `order` | 在“应用”列表中的位置，小的在前；默认 50 |
| `settings` | 设置项（第 3 节），类型限 `toggle`、`choice`、`number`，每项存在 uci 选项 `uci`（`配置.节.选项`）里，未设置时用 `default`。它们在“高级”里单独成为一个分类。配置名请用 `e5-plugin-<id>`，第一次修改时会自动创建。 |

### 5.3 前端

页面运行在覆盖各页面的框架里（屏幕 320×480，上有状态栏，下有页脚，可用区域约
320×424 CSS 像素）。先加载 SDK：

```html
<script src="/sdk/e5.js"></script>
```

| SDK | 说明 |
|---|---|
| `e5.id`、`e5.lang`、`e5.version` | 插件 id、`zh`/`en`、接口版本 |
| `e5.api(路径, { body, method })` | 对 `/api/plugins/<id><路径>` 的 `fetch`；带 `body` 时以 JSON 发 POST；成功时得到回复（JSON 或文本），非 2xx 时失败，错误带 `.status` 和 `.data` |
| `e5.core(路径, opts)` | 同上，用于核心接口 `/api/<路径>`（第 2 节） |
| `e5.onKey(fn)` | 每次按键调用 `fn({ kind, key, code, repeat })`；返回 `true` 表示已处理 |
| `e5.onBack(fn)` | `onKey` 没有处理返回键时调用 `fn()`；返回 `true` 表示留在插件里，其他情况关闭插件 |
| `e5.onLang(fn)` | 屏幕语言改变时调用 `fn(lang)` |
| `e5.toast(文字)` | 在屏幕上显示一条短消息 |
| `e5.keepAwake(on)` | `true`：插件打开期间屏幕不自动熄灭（计时器、测试进行中等）；结束后设回 `false` |
| `e5.exit()` | 关闭插件 |
| `e5.press(el)` | 由按键触发点击 `el`。触摸关闭时（高级 → 屏幕 → 触摸），SDK 会丢弃所有触摸和点击（WebKit 在轻触后自己合成的点击是 untrusted 的，无法区分），只有这种点击能通过。 |
| `e5.t({ zh, en })` | 按屏幕语言取文字 |
| `e5.tzOffset`、`e5.time(ms)` | 设备相对 UTC 的偏移（秒）；把时间格式化为设备时区的 `HH:MM:SS`。OpenWrt 上 WebKit 没有时区数据，`Date` 的本地时间就是 UTC，请用这两个（或 `/status` 里的 `tz_offset`）。 |

屏幕熄灭时 SDK 会吞掉按键（由主程序点亮屏幕）；电源键始终归主程序。触摸和普通网页
一样使用。请用大字号和深色背景（与信息屏一致：背景 `#0b0e13`、卡片 `#161b23`、文字
`#e8ecf2`）；可用字体为 Noto Sans CJK SC 和 DejaVu Sans。

不用 SDK 时，协议是与父框架之间的 `postMessage`：
插件 → 主程序：`{ e5: "ready" }`、`{ e5: "key", kind, key, code, keyCode, repeat }`（每次按键
都要发，主程序据此点亮屏幕、重置息屏计时）、`{ e5: "exit" }`、`{ e5: "toast", text }`、
`{ e5: "keep-awake", on }`；
主程序 → 插件：`{ e5: "hello", lang, api_version, blank, tz_offset, touch }`、`{ e5: "blank", on }`、`{ e5: "touch", on }`。

### 5.4 后端

`backend.uc` 是 ucode 代码（raw 模式，不写 `{% %}`），返回一个函数：接收上下文，返回路由表：

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

* 路由写成 `"<方法> <路径>"`，路径是 `/api/plugins/<id>` 之后的部分，没有时为 `/`。
* `req` 为 `{ method, path, query, body }`：`query` 是解析后的查询参数，`body` 是 POST
  的 JSON。
* 处理函数返回一个对象（以 JSON 发送），或者返回 `{ status, type, body }` 发送其他内容
  （`body` 为字符串）。
* 每个请求都在接口服务里重新运行，变量不会保留到下一个请求（状态请用
  `ctx.state_put` 保存），每个请求最多 30 秒。耗时的工作请放到后台（`ctx.run('... &')`），
  让页面轮询一个读取其状态的路由。

`ctx`：

| | 说明 |
|---|---|
| `ctx.api_version` | 1 |
| `ctx.sh(cmd)` | 运行 shell 命令，返回输出（字符串）或 `null`。不要未经转义就用 `req` 拼接 `cmd`：`req` 是数据。 |
| `ctx.sh_json(cmd)` | 同上，结果按 JSON 解析（不是 JSON 时为 `null`） |
| `ctx.run(cmd)` | 运行命令，返回退出状态 |
| `ctx.at(cmd, timeout)` | 通过 ModemManager 发 AT 指令（AT 通道只有一个所有者），返回不含 `OK` 的回复或 `null`；不拒绝任何指令 |
| `ctx.at_console(cmd, timeout)` | 同 `POST /at`：`{ ok, reply }` 或 `{ ok: false, error }`，对可能让基带直到重启前不可用的指令带 `warning: true` |
| `ctx.modem()` | `/status` 中的 `modem` 部分 |
| `ctx.cells()` | 服务小区和邻区，`[ { type, serving, pci, arfcn, band, rsrp, rsrq, sinr, bandwidth_mhz } ]` |
| `ctx.ubus(对象, 方法, 参数)` | ubus 调用，返回回复或 `null` |
| `ctx.uci()` | uci cursor（`get`、`set`、`commit`、`foreach` 等） |
| `ctx.state_get(名称, 最大秒数)`、`ctx.state_put(名称, 值)` | 跨请求保存的 JSON 状态，按插件区分（在 `/tmp/run` 下，重启后不保留）；超过 `最大秒数` 时 `state_get` 返回 `null` |
| `ctx.forget(名称)` | 删除一项状态 |
| `ctx.read_trim(路径)`、`ctx.read_num(路径)` | 读文件内容，去掉首尾空白 / 转成数字 |
| `ctx.log(文字)` | 写一行系统日志（`logread -e e5-infoscreen/<id>`） |

`www/plugins/` 下的两个插件就是示例：`calculator`（页面、按键、`onBack`）和
`nettest`（后端、设置项、`keepAwake`）。
