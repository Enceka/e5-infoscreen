# e5-infoscreen

> English: [`README.md`](README.md)

荣悦 E5 在 OpenWrt 下的信息屏，用于设备上 320×480 的屏幕。OpenWrt 指的是
[e5-linux](https://github.com/Enceka/e5-linux) 在这台设备上运行的那个（该仓库的
`openwrt/`）。模组、流量、热点和设备状态一眼可见，可以用触摸或键盘操作。

| 页面 | 内容 |
|---|---|
| 概览 | 下载/上传速率（并排）、本次开机的流量、网络状态（5G/4G、IPv4/IPv6）、热点、在线设备、电池、电池电流（充电 +，耗电 -）和电压、内存和存储占用（进度条：75% 起黄色，90% 起红色） |
| 信号 | 制式和频段（n41、B3 等）、RSRP/RSRQ/SINR 及评级、PCI、ARFCN、带宽、邻区数、签约速率（网络给数据上下文的 AMBR，来自 `AT+CGEQOSRDP` / `AT+C5GQOSRDP`，附 QCI/5QI） |
| 流量 | 今日和本月的下载/上传，外网（模组数据接口，即运营商计费的流量）和内网（USB 与热点的网桥）分开显示；外网的本次开机流量和最近 7 天（vnstat 统计，数据保存在 `/etc/vnstat`；高级 → 系统可清空） |
| 短信 | 收到的短信，新的在前，未读的有标记；打开阅读，可删除（按两次） |
| 热点 | SSID、扫码连接的二维码、按需显示密码、开关、在线设备（Wi-Fi 和 USB） |
| 设备 | 电池、开机时长、联网时长、负载、内存、LAN/IPv4/IPv6 地址、亮度、重新连接网络 |
| 高级信息 | 设备（系统、镜像、内核、存储、温度、电池电压）；基带（型号、固件、5G SA、网络模式）；频段锁（LTE、NR）和小区锁，由 `AT+SPLBAND` / `AT+SPFORCEFRQ` 解码；SIM（当前卡槽、运营商、注册状态）；按需显示识别码 |
| 高级 | 按功能分类的设置：**网络**（网络模式 5G/4G/3G、5G/4G、仅 5G (SA)、仅 4G；5G 组网 SA + NSA 或仅 NSA；切换 APN（默认按 SIM 卡自动选择）；LTE/NR 频段锁定、恢复默认频段、锁小区；重新连接）、**AT 指令**（常用查询，点选执行并显示回复；任意指令通过 `/api/at`）、**设备管理**（禁止上网、踢下 Wi-Fi）、**蓝牙**（开关、搜索、配对并连接耳机或音箱——连上后声音从蓝牙播放——断开、忘记设备）、**充电**（充电上限、恢复充电的电量、临时充满一次，由 e5-linux 的 `e5-charge` 执行）、**通知**（短信震动、亮屏、短信提示音）、**声音**（音量、测试音，需要 e5-linux 的 `e5-volume`）、**屏幕**（亮度、自动息屏、触摸开关、语言）、**系统**（时区、时间显示秒、清空流量记录、下次重启进入的系统、默认启动（Linux 或 Android）、重启、关机、下次启动 Android；下次启动 Debian 用命令行的 `e5-os debian --once`），以及各插件的设置 |
| 应用 | 已安装的插件；自带计算器、网络测试、USB 供网三个 |

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
* **字体**：Noto Sans CJK。OpenWrt 有独立镜像时（e5-linux 的独立安装）字体就在镜像里；
  否则取自 OpenWrt 所在的 Debian 根镜像，bind 到 `/usr/share/fonts` 下（WebKit 的网页
  进程运行在沙箱里，能看到 `/usr`，看不到 `/mnt`）；DejaVu Sans 作后备。
* **屏幕电源**：空闲超时后（默认 60 秒）或按电源键时关背光；之后的第一次触摸或按键
  只负责点亮屏幕——按键锁（电源键再按 `*`，见“按键”）打开时除外。

`/etc/init.d/e5-infoscreen` 以 procd 实例运行这四个部分（`seatd`、`api`、`ui`、`usbguard`）。
`usbguard` 是 `usr/libexec/e5-infoscreen/usb-guard`：这个内核在**重新插拔 USB 后会丢掉
gadget**（回来时带着 `softconnect=0`，主机什么都枚举不到——docs/USB-SHARE.md 2），`usb0`
也会跟着掉出 `br-lan`。开机之后没有任何东西会重新绑定它，所以这个守护只做两件事，
而且只在出问题时动手：UDC 为空就重新绑定；线插着而过了 GRACE 秒主机还没枚举出来也重新
绑定（同一个插拔里每 RETRY 秒最多一次，免得对着充电器空转）；`usb0` 不在 `br-lan` 里就
放回去。重绑是“解绑、停 1 秒、再绑定”，主机那边只丢一个 ping。它只在自己动手时写日志
（`logread -e e5-usb-guard`），并且**从不把 usb0 down 掉**。

它的窗口和手动入口是应用 `usbshare`（应用列表里的“USB 供网”，自带三个之一）：一行状态把
这条路分三段报出来（链路 / 上行 / 网关），一行开关说断线自动修复在不在（同时显示守护在不在
跑、多久查一次），一个“立即修复”按钮——按一下重新枚举、把 `usb0` 放回 `br-lan`，网关缺了
就补回来。它和另外两个一样住在 `root/usr/share/e5-infoscreen/www/plugins/usbshare`；想单独装，
`tar -czf usbshare-1.5.tar.gz -C root/usr/share/e5-infoscreen/www/plugins usbshare`，
然后在 LuCI（服务 → 信息屏应用）里上传安装，或在设备上运行
`/usr/libexec/e5-infoscreen/plugin install 文件`。它的两个设置（自动修复、检查间隔）同时
出现在“高级”里，守护每拍都重新读一次，所以改完不需要重启。

## 这条链路怎么给 PC 供网

**网线是主路，Wi-Fi 只作应急。** 这条路要通，三段都得成立，应用的状态行就把三段分开报
（例如 `线通 · 上行通 · 已下发网关`）：

| 段 | 判据 | 断了的时候 |
|---|---|---|
| 链路 | gadget 绑定且 `configured`、`usb0` 有载波、在 `br-lan` 里 | 未绑定 / 主机未枚举 / 未接入主机 / 不在 br-lan |
| 上行 | 设备自己有出口（netifd 的 `wan` 是 up；取不到时退回看默认路由） | `上行断`——移动数据的事，应用**不碰**（重连风暴会把 SIM 拉黑，见 e5-linux §28） |
| 网关 | `dhcp.usbhost.dhcp_option` 里有 `3,192.168.9.1` | `未给网关`——e5-linux 的 `90-e5` 只给静态租约、故意不给网关（"it has its own uplink"），PC 于是有地址、有 DNS、有 IPv6，却**没有 IPv4 默认路由** |

`root/etc/uci-defaults/95-e5-infoscreen-usbhost` 把网关补回来：uci-defaults 按文件名字典序执行，
`95-` 排在 `90-e5` 之后，所以它说了算。应用里的「立即修复」也会在网关缺失时补回它并重启
dnsmasq，同时重绑 gadget、把 `usb0` 放回 `br-lan`——哪一段断的不用你判断。

PC 侧要让网线**稳定压过 Wi-Fi**（Windows 默认按链路速度自动挑度量，会飘），把那张网卡设成
固定度量（管理员；撤销用 `metric=automatic`）：

```bat
netsh interface ipv4 set interface "以太网 3" metric=5
netsh interface ipv6 set interface "以太网 3" metric=5
```

Wi-Fi 保持“自动”就行：网线一接上就赢（5 < 35），拔掉后它的路由消失，Wi-Fi 自动接管——应急。

局域网原来也发 IPv6，而 `lan.ip6assign '64'` 会把蜂窝上行自己的 /64 直接铺到 `br-lan` 上
——上行每重连一次 PC 就要重编一次地址，双栈客户端在 AAAA 那条路上白卡几秒。对一个以网线
为主的设备来说这是纯噪声：`root/etc/uci-defaults/96-e5-infoscreen-noipv6` 只关掉局域网这一
侧的广告（`dhcpv6` 与 `ra` 关闭），**不动蜂窝承载**——`wan.iptype` 保持 `ipv4v6`，因为重启
数据单元正是把 SIM 弄黑的那件事。细节与“怎么证明 RA 真的停了”见 `docs/USB-SHARE.md` §4。

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
| 电源键，2 秒内再按 `*` | 按键锁：屏幕保持熄灭，按键、触摸和新短信都不会点亮（马达振动一下表示已锁定）；再按一次电源键 + `*` 解锁并亮屏。音量键照常可用 |
| 音量加 / 减 | 调节扬声器音量（16 级，0 为静音），不发声，在屏幕上显示音量；息屏时也能用，且不会点亮屏幕 |

## 插件

插件是 `/usr/share/e5-infoscreen/www/plugins/<id>/` 下的一个目录：一个 `manifest.json`、
一个加载 `/sdk/e5.js` 的页面，可选的 ucode 后端 `backend.uc` 和设置项。核心接口、设置项、
SDK 和后端上下文的说明见 [`docs/API.zh-CN.md`](docs/API.zh-CN.md)。

## 应用

“应用”页显示已安装的插件，自带三个。更多应用在 LuCI 里安装（服务 → 信息屏应用：上传 `.tar.gz` 或 `.zip`），
可以在那里或屏幕上（高级 → 应用管理）卸载。应用包格式见 [`docs/API.zh-CN.md`](docs/API.zh-CN.md) 5.5 节。

## 安装

在运行 e5-linux 的 OpenWrt 的 E5 上安装，WAN 需已联网（软件包来自 OpenWrt 的
软件源）：

```sh
./install.sh              # 通过 SSH 连 192.168.9.1
./install.sh 192.168.9.1
```

脚本会安装 `packages.txt` 里的包（含 WebKit 和 Mesa 约 200 MB），复制 `root/`，
按顺序运行镜像带的 `uci-defaults`（`??-e5-infoscreen*`），然后启用并启动服务。重装会
保留 `/etc/config/e5-infoscreen`。

## 设置

`/etc/config/e5-infoscreen`（用 `uci` 修改，然后 `/etc/init.d/e5-infoscreen restart`）：

| 选项 | 默认值 | 说明 |
|---|---|---|
| `touch` | `1` | `0`：屏幕不响应触摸，只用按键 |
| `enabled` | `1` | `0`：不启动信息屏，屏幕保持黑屏 |
| `idle` | `60` | 多少秒后关背光，`0` 表示从不 |
| `brightness` | `120` | 亮屏时的背光等级，1-255（设备页可调并会保存） |
| `lang` | `zh` | `zh` 或 `en` |
| `donate_seen` | （未设置） | 安装后第一次开机显示过赞赏码后为 `1`；之后只在“高级 → 关于 → 赞赏”里显示 |

## 调试

* `logread -e e5-infoscreen`：合成器日志和页面的 console 输出。
* 在设备上运行 `wget -q -O - http://127.0.0.1:8088/api/status`：查看全部数据。
* `/tmp/e5-infoscreen-keys.log`：页面每次启动后的前 200 次按键，记录 WebKit 给出的键名。

## 维护者

Enceka <enceka@yeah.net>。屏幕上的“高级 → 关于”也显示这些信息。

## 免责声明

本软件为非官方软件，与荣悦及设备、芯片厂商无关，也未获其认可。软件按“原样”提供，不作任何
明示或暗示的担保（见 [`LICENSE`](LICENSE)）。它能修改的内容，包括网络模式、频段和小区锁定、
原始 AT 指令以及充电设置，可能导致断网、模组或电池处于异常状态，或使设备失去保修。使用风险
由使用者自行承担；所选频段和无线设置请遵守当地法规。

## 许可

MIT，© 2026 Enceka，见 [`LICENSE`](LICENSE)。
