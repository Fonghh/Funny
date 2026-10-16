#!/usr/bin/env python3
"""Builds the GitHub Pages site in ../docs from index.html and the downloaded assets.

index.html is a page fragment (the Claude Artifact host adds <html>/<head>/<body>);
this wraps it into a standalone page that can be added to an iPhone home screen.
Run ./fetch_assets.sh first so mp/ and models/ exist.
"""
import json
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "docs"

HEAD = """<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#050709">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="PicklePose">
<meta name="description" content="在手機上分析匹克球影片的骨架動作，給出參考用的改進建議。影片不會上傳。">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png">
<style>
/* what the Artifact host normally provides around the fragment */
:root { padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }
body { margin: 0; -webkit-text-size-adjust: 100%; }
img { max-width: 100%; }
</style>
"""

MANIFEST = {
    "name": "PicklePose 匹克球動作分析",
    "short_name": "PicklePose",
    "lang": "zh-Hant",
    "start_url": "./",
    "scope": "./",
    "display": "standalone",
    "background_color": "#050709",
    "theme_color": "#050709",
    "icons": [
        {"src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png"},
        {"src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"},
    ],
}


def draw_icon(size):
    import cv2
    import numpy as np

    s = 4  # supersample, then shrink for smooth edges
    n = size * s
    img = np.zeros((n, n, 3), np.uint8)
    img[:] = (9, 7, 5)  # BGR of #050709
    cx = cy = n // 2
    r = int(n * 0.27)
    # pickleball: yellow disc with dark holes
    cv2.circle(img, (cx, cy), r, (60, 210, 243), -1, cv2.LINE_AA)
    for ang in range(0, 360, 60):
        a = np.deg2rad(ang)
        p = (int(cx + np.cos(a) * r * 0.55), int(cy + np.sin(a) * r * 0.55))
        cv2.circle(img, p, int(r * 0.13), (9, 7, 5), -1, cv2.LINE_AA)
    cv2.circle(img, (cx, cy), int(r * 0.13), (9, 7, 5), -1, cv2.LINE_AA)
    # cyan HUD corner brackets
    c, m, L, t = (255, 212, 63), int(n * 0.16), int(n * 0.16), max(2, int(n * 0.035))
    for x, y, dx, dy in [(m, m, 1, 1), (n - m, m, -1, 1), (m, n - m, 1, -1), (n - m, n - m, -1, -1)]:
        cv2.line(img, (x, y), (x + dx * L, y), c, t, cv2.LINE_AA)
        cv2.line(img, (x, y), (x, y + dy * L), c, t, cv2.LINE_AA)
    return cv2.resize(img, (size, size), interpolation=cv2.INTER_AREA)


def main():
    import cv2

    src = (HERE / "index.html").read_text(encoding="utf-8")
    src = src.replace('<meta name="claude:viewport-fit-sides" content="cover">\n', "")
    # Pages serves .task files fine, so use the model's real name
    src = src.replace("./models/pose_full.task.wasm", "./models/pose_full.task")
    page = HEAD + src
    # everything before the first element of the app belongs in <head>
    split = page.index('<div class="app">')
    page = page[:split] + "</head>\n<body>\n" + page[split:] + "\n</body>\n</html>\n"

    OUT.mkdir(exist_ok=True)
    (OUT / "index.html").write_text(page, encoding="utf-8")
    (OUT / "manifest.webmanifest").write_text(json.dumps(MANIFEST, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / ".nojekyll").write_text("")
    for d in ("mp",):
        shutil.copytree(HERE / d, OUT / d, dirs_exist_ok=True)
    (OUT / "models").mkdir(exist_ok=True)
    shutil.copy(HERE / "models" / "pose_full.task.wasm", OUT / "models" / "pose_full.task")
    (OUT / "icons").mkdir(exist_ok=True)
    for name, size in (("apple-touch-icon.png", 180), ("icon-192.png", 192), ("icon-512.png", 512)):
        cv2.imwrite(str(OUT / "icons" / name), draw_icon(size))
    print(f"built {OUT}")


if __name__ == "__main__":
    main()
