# e5-infoscreen

> English: [`README.md`](README.md)

荣悦 E5 在 OpenWrt 下的信息屏，用于设备上 320×480 的屏幕。OpenWrt 指的是
[e5-linux](https://github.com/Enceka/e5-linux) 在这台设备上运行的那个（该仓库的
`openwrt/`）。模组、流量、热点和设备状态一眼可见，可以用触摸或键盘操作。

| 页面 | 内容 |
|---|---|
| 概览 | 下载/上传速率、本次开机的流量、网络状态（5G/4G、IPv4/IPv6）、热点、在线设备、电池、电池电流（充电 +，耗电 -）和电压 |
| 信号 | 制式和频段（n41、B3 等）、RSRP/RSRQ/SINR 及评级、PCI、ARFCN、带宽、邻区数 |
| 流量 | 今日和本月的下载/上传，外网（模组数据接口，即运营商计费的流量）和内网（USB 与热点的网桥）分开显示；外网的本次开机流量和最近 7 天（vnstat 统计，数据保存在 `/etc/vnstat`；高级 → 系统可清空） |
| 短信 | 收到的短信，新的在前，未读的有标记；打开阅读，可删除（按两次） |
| 热点 | SSID、扫码连接的二维码、按需显示密码、开关、在线设备（Wi-Fi 和 USB） |
| 设备 | 电池、开机时长、联网时长、负载、内存、LAN/IPv4/IPv6 地址、亮度、重新连接网络 |
| 高级信息 | 设备（系统、镜像、内核、存储、温度、电池电压）；基带（型号、固件、5G SA、网络模式）；频段锁（LTE、NR）和小区锁，由 `AT+SPLBAND` / `AT+SPFORCEFRQ` 解码；SIM（当前卡槽、运营商、注册状态）；按需显示识别码 |
| 高级 | 按功能分类的设置：**网络**（网络模式 5G/4G/3G、5G/4G、仅 5G (SA)、仅 4G；5G 组网 SA + NSA 或仅 NSA；切换 APN；LTE/NR 频段锁定、恢复默认频段、锁小区；重新连接）、**设备管理**（禁止上网、踢下 Wi-Fi）、**充电**（充电上限、恢复充电的电量、临时充满一次，由 e5-linux 的 `e5-charge` 执行）、**通知**（短信震动、亮屏）、**屏幕**（亮度、自动息屏、触摸开关、语言）、**系统**（时区、时间显示秒、清空流量记录、重启、关机、下次启动 Debian 或 Android），以及各插件的设置 |
| 应用 | 已安装的插件；自带计算器和网络测试两个 |

顶部状态栏显示运营商、制式、信号格、电量和时间，有未读短信时显示 ✉ 和条数。新短信到达
时屏幕会亮起并直接打开该短信（震动和未读列表由 e5-linux 的 `e5-sms-notify` 负责，
列表在 `/tmp/run/e5-sms/unread`；`e5-notify.sms.screen=0` 可关闭亮屏）。打开短信页即
视为已读。SIM 卡和设备的识别码（IMEI、ICCID、IMSI、本机号码）只在高级页按“显示识别码”后
显示，也只由这个按钮调用的接口（`/api/identity`）提供。

## 工作方式

除 `root/` 里的文件外，其余全部是 OpenWrt 的软件包：

* **显示**：`cage`，一个只跑单个应用的 Wayland 合成器（基于 wlroots），在屏幕的
  KMS 设备上运行，用 Mesa 的 **panfrost** 驱动在 Mali-G57 上渲染
  （`libmesa-panfrost`）；设备由 `seatd` 交给它。
* **页面**：`cog`，即 WPE WebKit 浏览器，全屏打开 `http://127.0.0.1:8088/`
  （`root/usr/share/e5-infoscreen/www`）。
* **数据**：另起一个 `uhttpd`，只监听 127.0.0.1:8088，带 ucode 处理程序
  （`api.uc`）。数据来自 ModemManager（`mmcli -J`）、netifd、hostapd 和无线配置
  （ubus、uci），电池、背光和流量计数器取自 `/sys`。设备外部访问不到它，所以不需要
  登录；LuCI 照旧在 80 端口。
* **字体**：Noto Sans CJK 取自 E5 上 OpenWrt 所在的 Debian 根镜像，bind 到
  `/usr/share/fonts` 下（WebKit 的网页进程运行在沙箱里，能看到 `/usr`，看不到
  `/mnt`）；DejaVu Sans 作后备。
* **屏幕电源**：空闲超时后（默认 60 秒）或按电源键时关背光；之后的第一次触摸或按键
  只负责点亮屏幕。

`/etc/init.d/e5-infoscreen` 以 procd 实例运行这三部分（`seatd`、`api`、`ui`）。

## 按键

在设备上实测（括号里是 WebKit 给出的键名）：

| 按键 | 作用 |
|---|---|
| 左 / 右 | 上一页 / 下一页 |
| 上 / 下 | 在页面的按钮间移动，或滚动页面 |
| 确认（`KEY_SELECT`，"Unidentified"） | 按下当前选中的按钮 |
| 返回（`KEY_BACK` + BackSpace） | 关闭短信、取消选中按钮，或回到第一页 |
| 1-9 | 跳到对应页面 |
| 侧键（`F1`） | 热点页（显示二维码） |
| 电源（`PowerOff`） | 关屏 |
| 音量 | 保留给音量 |

## 插件

插件是 `/usr/share/e5-infoscreen/www/plugins/<id>/` 下的一个目录：一个 `manifest.json`、
一个加载 `/sdk/e5.js` 的页面，可选的 ucode 后端 `backend.uc` 和设置项。核心接口、设置项、
SDK 和后端上下文的说明见 [`docs/API.zh-CN.md`](docs/API.zh-CN.md)。

## 安装

在运行 e5-linux 的 OpenWrt 的 E5 上安装，WAN 需已联网（软件包来自 OpenWrt 的
软件源）：

```sh
./install.sh              # 通过 SSH 连 192.168.9.1
./install.sh 192.168.9.1
```

脚本会安装 `packages.txt` 里的包（含 WebKit 和 Mesa 约 200 MB），复制 `root/`，
然后启用并启动服务。重装会保留 `/etc/config/e5-infoscreen`。

## 设置

`/etc/config/e5-infoscreen`（用 `uci` 修改，然后 `/etc/init.d/e5-infoscreen restart`）：

| 选项 | 默认值 | 说明 |
|---|---|---|
| `touch` | `1` | `0`：屏幕不响应触摸，只用按键 |
| `enabled` | `1` | `0`：不启动信息屏，屏幕保持黑屏 |
| `idle` | `60` | 多少秒后关背光，`0` 表示从不 |
| `brightness` | `120` | 亮屏时的背光等级，1-255（设备页可调并会保存） |
| `lang` | `zh` | `zh` 或 `en` |

## 调试

* `logread -e e5-infoscreen`：合成器日志和页面的 console 输出。
* 在设备上运行 `wget -q -O - http://127.0.0.1:8088/api/status`：查看全部数据。
* `/tmp/e5-infoscreen-keys.log`：页面每次启动后的前 200 次按键，记录 WebKit 给出的键名。

## 许可

MIT，见 [`LICENSE`](LICENSE)。
