#!/bin/sh
# Install the info screen on an E5 running OpenWrt (e5-linux's openwrt/),
# over SSH:
#
#   ./install.sh [HOST]        (default 192.168.9.1, the E5's USB LAN)
#
# Installs the packages in packages.txt from OpenWrt's repositories (the E5
# needs its WAN up for that), copies root/ onto the device, enables the
# service and (re)starts it.  SSH asks for root's password unless a key is
# set up (LuCI -> System -> Administration -> SSH-Keys).
set -eu
HOST=${1:-192.168.9.1}
HERE="$(cd "$(dirname "$0")" && pwd)"
PKGS=$(grep -v '^#' "$HERE/packages.txt" | tr '\n' ' ')

echo "== packages on $HOST"
ssh "root@$HOST" "apk update >/dev/null && apk add $PKGS"
echo "== files"
( cd "$HERE/root" && COPYFILE_DISABLE=1 tar --exclude .DS_Store -czf - . ) |
    ssh "root@$HOST" 'tar -xzf - -C / &&
        for f in /etc/uci-defaults/[0-9][0-9]-e5-infoscreen*; do sh "$f" && rm -f "$f"; done;
        /etc/init.d/e5-infoscreen enable && /etc/init.d/e5-infoscreen restart'
echo "== done: the panel shows the info screen in a few seconds"
