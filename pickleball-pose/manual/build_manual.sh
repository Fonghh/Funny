#!/usr/bin/env bash
# Rebuilds docs/manual.pdf from manual.html. Needs Playwright's Chromium and the web fonts in fonts/
# (fonts/ is not in git: fetch_fonts below downloads it).
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -f fonts/local.css ]; then
  mkdir -p fonts && cd fonts
  UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
  curl -sS -A "$UA" "https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;700&family=Chakra+Petch:wght@600;700&family=JetBrains+Mono:wght@500&display=swap" -o fonts.css
  python3 - <<'PY'
import re, hashlib, urllib.request
css = open("fonts.css").read()
for u in sorted(set(re.findall(r"url\((https://fonts\.gstatic\.com/[^)]*)\)", css))):
    name = hashlib.md5((u + "\n").encode()).hexdigest()[:12] + ".woff2"
    urllib.request.urlretrieve(u, name)
    css = css.replace(u, name)
open("local.css", "w").write(css)
PY
  cd ..
fi
node pdf.mjs "$PWD/manual.html" ../../docs/manual.pdf
echo "built docs/manual.pdf"
