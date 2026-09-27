# e5-infoscreen

> English: [`README.md`](README.md)

荣悦 E5 在 OpenWrt 下的信息屏，用于设备上 320×480 的屏幕。OpenWrt 指的是
[e5-linux](https://github.com/Enceka/e5-linux) 在这台设备上运行的那个（该仓库的
`openwrt/`）。模组、流量、热点和设备状态一眼可见，可以用触摸或键盘操作。

| 页面 | 内容 |
|---|---|
| 概览 | 下载/上传速率、本次开机的流量、网络状态（5G/4G、IPv4/IPv6）、热点、在线设备、电池 |
| 信号 | 制式和频段（n41、B3 等）、RSRP/RSRQ/SINR 及评级、PCI、ARFCN、带宽、邻区数 |
| 短信 | 收到的短信，新的在前，未读的有标记；打开阅读，可删除（按两次） |
| 热点 | SSID、扫码连接的二维码、按需显示密码、开关、在线设备（Wi-Fi 和 USB） |
| 设备 | 电池、开机时长、联网时长、负载、内存、LAN/IPv4/IPv6 地址、亮度、重新连接网络 |

顶部状态栏显示运营商、制式、信号格、电量和时间，有未读短信时显示 ✉ 和条数。新短信到达
时屏幕会亮起并直接打开该短信（震动和未读列表由 e5-linux 的 `e5-sms-notify` 负责，
列表在 `/tmp/run/e5-sms/unread`；`e5-notify.sms.screen=0` 可关闭亮屏）。打开短信页即
视为已读。SIM 卡和设备的身份信息（本机号码、IMEI、IMSI）既不显示，也不由接口提供。

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
| 1-5 | 跳到对应页面 |
| 侧键（`F1`） | 热点页（显示二维码） |
| 电源（`PowerOff`） | 关屏 |
| 音量 | 保留给音量 |

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
