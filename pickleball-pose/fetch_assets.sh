#!/usr/bin/env bash
# Downloads the MediaPipe runtime and pose model that index.html loads from relative paths.
set -euo pipefail
cd "$(dirname "$0")"
VER=0.10.14
mkdir -p mp/wasm models
tmp=$(mktemp -d)
(cd "$tmp" && npm pack "@mediapipe/tasks-vision@$VER" -q >/dev/null && tar xzf ./*.tgz)
cp "$tmp/package/vision_bundle.mjs" mp/
cp "$tmp"/package/wasm/*.js "$tmp"/package/wasm/*.wasm mp/wasm/
rm -rf "$tmp"
curl -sSfLo models/pose_full.task.wasm \
  https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task
echo "assets ready"
