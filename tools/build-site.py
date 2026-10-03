#!/usr/bin/env python3
"""Build the e5-infoscreen GitHub Pages site and its device update feed.

The release package and metadata are made by make-release.sh first.  The Pages
copy keeps the same JSON fields, but points ``url`` at the Pages-hosted package
so devices can update without going through GitHub Releases.
"""
import json, os, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
TOP = os.path.dirname(HERE)
SOURCE = os.path.join(TOP, 'site')
RELEASE = os.path.join(TOP, 'dist')
OUT = os.path.join(TOP, 'dist-site')
BASE = (sys.argv[1] if len(sys.argv) > 1 else 'https://enceka.github.io/infoscreen').rstrip('/')

def main():
    with open(os.path.join(RELEASE, 'latest.json'), encoding='utf-8') as f:
        latest = json.load(f)
    version = latest['version']
    package = f'e5-infoscreen-{version}.tar.gz'
    package_path = os.path.join(RELEASE, package)
    if not os.path.isfile(package_path):
        raise SystemExit(f'missing release package: {package_path}')
    shutil.rmtree(OUT, ignore_errors=True)
    shutil.copytree(SOURCE, OUT)
    index = os.path.join(OUT, 'index.html')
    with open(index, encoding='utf-8') as f:
        html = f.read().replace('__SITE_BASE_URL__', BASE)
    with open(index, 'w', encoding='utf-8') as f:
        f.write(html)
    latest['release_url'] = latest.get('url')
    latest['url'] = f'{BASE}/{package}'
    with open(os.path.join(OUT, 'latest.json'), 'w', encoding='utf-8') as f:
        json.dump(latest, f, ensure_ascii=False, indent=1)
        f.write('\n')
    shutil.copy2(package_path, os.path.join(OUT, package))
    print(f'{OUT}: version {version}, package {package}')

if __name__ == '__main__':
    main()
