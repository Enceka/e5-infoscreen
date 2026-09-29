#!/bin/sh
# A release for the screen's online update (/usr/libexec/e5-infoscreen/update, docs/API.md 6):
#
#   tools/make-release.sh "说明" "notes"   -> dist/e5-infoscreen-<VERSION>.tar.gz and dist/latest.json
#
# The version is root/usr/share/e5-infoscreen/VERSION (raise it first).  Upload both files to a GitHub
# release tagged v<VERSION> of Enceka/e5-infoscreen, marked latest: the devices read
# releases/latest/download/latest.json.  The package is root/ as it is in git, owned by root.
set -eu
cd "$(dirname "$0")/.."
V=$(cat root/usr/share/e5-infoscreen/VERSION)
[ -z "$(git status --porcelain root)" ] || { echo "root/ has uncommitted changes" >&2; exit 1; }
mkdir -p dist
P=dist/e5-infoscreen-$V.tar.gz
python3 - "$P" <<'PY'
import os, subprocess, sys, tarfile, time
out = sys.argv[1]
files = subprocess.run(['git', 'ls-files', 'root'], capture_output=True, text=True, check=True).stdout.split()
mtime = int(subprocess.run(['git', 'log', '-1', '--format=%ct'], capture_output=True, text=True).stdout or time.time())
with tarfile.open(out, 'w:gz', format=tarfile.GNU_FORMAT) as t:
    dirs = set()
    for f in sorted(files):
        rel = os.path.relpath(f, 'root')
        parts = rel.split('/')
        for i in range(1, len(parts)):
            d = '/'.join(parts[:i])
            if d not in dirs:
                dirs.add(d)
                ti = tarfile.TarInfo('./' + d); ti.type = tarfile.DIRTYPE; ti.mode = 0o755; ti.mtime = mtime
                t.addfile(ti)
        ti = t.gettarinfo(f, './' + rel)
        ti.uid = ti.gid = 0; ti.uname = ti.gname = 'root'; ti.mtime = mtime
        ti.mode = 0o755 if os.access(f, os.X_OK) else 0o644
        with open(f, 'rb') as fh:
            t.addfile(ti, fh)
PY
SUM=$( (shasum -a 256 "$P" 2>/dev/null || sha256sum "$P") | cut -d' ' -f1)
SIZE=$(wc -c < "$P" | tr -d ' ')
python3 - "$V" "$SUM" "$SIZE" "${1:-}" "${2:-}" > dist/latest.json <<'PY'
import json, sys
v, s, n, zh, en = sys.argv[1:6]
print(json.dumps({'version': v,
                  'url': f'https://github.com/Enceka/e5-infoscreen/releases/download/v{v}/e5-infoscreen-{v}.tar.gz',
                  'sha256': s, 'size': int(n), 'notes': {'zh': zh, 'en': en or zh}}, ensure_ascii=False, indent=1))
PY
echo "$P ($SIZE bytes), dist/latest.json: upload both to the release v$V"
