# The USB share: link, uplink, gateway

On this device `usb0` is the network *and* the console at once, so anything that
breaks it is expensive to repair from the outside.  This is what the app and the
guard look at, why the three parts are separate, and what was wrong before.

## 1. Three things have to hold, and they fail separately

| part | read from | what takes it away |
|---|---|---|
| **link** | gadget `configured`, `usb0` carrier, `usb0` a port of `br-lan` | a replug (§2), an image update |
| **uplink** | netifd's `wan` (`ubus call network.interface.wan status`), else a default route | the mobile side — the app **never** touches it (a reconnect storm once got the SIM barred, e5-linux's own findings §28) |
| **gateway** | `dhcp.usbhost.dhcp_option` holding `3,192.168.9.1` | e5-linux's `90-e5` withholding it (§3) |

A link check on its own honestly reports "fine" while the PC has no internet: the
link can be up with the uplink down, or with the gateway missing.  The app
therefore prints all three (`线通 · 上行通 · 已下发网关`) and marks which one is
down, and its Repair button only does what that part needs.

## 2. The gadget is lost on a replug, and only a rebind brings it back

On every replug the SoC's extcon restarts the gadget with `softconnect=0`.  The
host then enumerates *nothing*: no carrier, no `usb0` in `br-lan`, no network and
no console.  Nothing rebinds it after boot — no udev rule, no netifd port
(`10-e5-usb0` only enslaves an `usb0` that already exists).

There is no shortcut to re-arm it: `/sys/kernel/config/usb_gadget/*/soft_connect`
is not there, and `/sys/class/udc/<udc>/soft_connect` is permission-denied even
for root on this kernel.  The only way back is the configfs unbind/bind:

```sh
G=/sys/kernel/config/usb_gadget/linux
echo "" > "$G/UDC"; sleep 1; echo "$UDC" > "$G/UDC"
```

`usb-guard` does exactly that, and only when something is wrong:

* an empty `UDC` (never bound, or unbound) is rebound at once;
* a cable that is present (`/sys/class/power_supply/usb/online`) but has not
  reached `configured` after **GRACE** seconds is rebound too, at most once per
  **RETRY** seconds — so a charger, which never enumerates, cannot turn it into
  a loop;
* `usb0` outside `br-lan` goes back in.

The rebind is unbind, pause 1 s, bind: the port comes back `configured` in about
a second and the host loses exactly **one ping**.  Do not shorten the pause —
`usb0` must never go down, and the vendor NCM function once overwrote kernel
memory and panicked with `usb0` as a plain netifd bridge port.

It writes one line to `logread -e e5-usb-guard` only when it acts, and reads its
interval and on/off from uci on **every tick**, so the app's settings take effect
without a restart.  `usb-guard` runs as a procd instance outside the screen's
`enabled` gate: that link is the way back to a device whose screen is dark.

## 3. DHCP: the router option was being suppressed for the USB host

`90-e5` gives the USB host its reserved lease and then carries one **empty**
`dhcp_option 3` on its tag, with the comment "it has its own uplink".  In dnsmasq
that is not "no opinion" — `dhcp-option=tag:usbhost,3` with no value *suppresses*
option 3 for that tag.  The PC therefore ended up with an IPv4 address,
DHCP-supplied DNS and working IPv6, and **no IPv4 default gateway**:
`ipconfig /all` showed only an IPv6 `默认网关`, and `route print -4` had no
`0.0.0.0/0` on that interface.  Every IPv4 flow failed while the status line,
faithfully, said the link was fine.

`dhcp.usbhost.dhcp_option='3,192.168.9.1'` restores it, and
`root/etc/uci-defaults/95-e5-infoscreen-usbhost` keeps it restored: uci-defaults
run in **lexical** order, so `95-` lands after `90-e5` and wins.  The app's
Repair button applies the same thing (plus a dnsmasq restart) when the option is
missing, so one button covers all three parts.

## 4. IPv6 on the LAN: prefixes that move, for a client that does not use them

`lan.ip6assign '64'` makes netifd copy a **/64 straight off the cellular bearer
onto `br-lan`** — the LAN shares the WAN's own prefix — and earlier PD leases
leave further /64s behind with countdown timers (`expires …` in `ip -6 route`).
The tell that it is the WAN's own prefix: the same /64 appears twice, once
`dev br-lan proto static` and once `unreachable … dev lo`.

Nothing is broken by that in itself, but whenever the bearer reconnects the
client renumbers, and a dual-stack client stalls on the AAAA path for a few
seconds each time.  On a USB-share-first device that is pure noise, so
`root/etc/uci-defaults/96-e5-infoscreen-noipv6` turns off the **LAN side only** —
no RA, no stateful DHCPv6 — and leaves the bearer alone (`wan.iptype` stays
`ipv4v6`; touching the data unit is what got the SIM barred).  Existing addresses
on the client then age out instead of being replaced.

## 5. Proving any of it, from the device

```sh
ip -4 -br addr                    # br-lan 192.168.9.1/24, sipa_eth0 = the bearer
ip -4 route                        # default dev sipa_eth0 metric 10
ip -6 -br addr ; ip -6 route       # the LAN IPv6 addresses and their prefixes
ls /sys/class/net/br-lan/brif/     # usb0 + wlan0, whoever enslaved them
cat /tmp/dhcp.leases               # who got what (the USB host is the static one)
cat /tmp/odhcpd.leases             # empty once DHCPv6 is off
ubus call network.interface.wan status | jsonfilter -e '@.up' -e '@.l3_device'
ping -c 2 -W 2 1.1.1.1             # the device's own exit
uclient-fetch -qO- <url>           # the device has no curl, and busybox has no wget
```

There is **no RA counter to read**, so to prove that `ra` really went off, watch
the client's address lifetimes instead: they must count down monotonically, in
step with the wall clock.  Then restart `odhcpd` and read again a few seconds
later — if `ra server` were still in effect, odhcpd's startup RA burst would
reset them to their full advertised values.  No jump means no RA.

`jsonfilter` chokes on `-e @.ipv4-address` (the dash is parsed as an escape); use
two calls or a different field.
