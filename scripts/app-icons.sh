#!/bin/bash
# 앱 아이콘(build/)을 RUNNERS 공용 화이트 · 블랙 판(1024 안 824 판, 안쪽 그림 55%)으로 만든다. 저장소 뿌리에서 실행한다.
# 만드는 것: build/Assets.car(macOS 26, 어두운 아이콘이면 블랙 판), build/icon.icns(옛 macOS), build/icon.png, build/icon.ico
set -euo pipefail

SRC=build/icon-source
WHITE=$SRC/monitor-white.png
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# macOS 26 은 icon.icon 그림 위에 자기 둥근 판 모양을 씌우므로, 824 판을 1024 칸에 꽉 차게 키워 넣는다.
for k in white black; do
  sips -c 824 824 "$SRC/monitor-$k.png" --out "$TMP/$k.png" >/dev/null
  sips -z 1024 1024 "$TMP/$k.png" --out "$SRC/icon.icon/Assets/$k.png" >/dev/null
done
xcrun actool --compile "$TMP" --platform macosx --minimum-deployment-target 10.12 --app-icon icon \
  --output-partial-info-plist "$TMP/partial.plist" "$SRC/icon.icon" >/dev/null
cp "$TMP/Assets.car" build/Assets.car

# 옛 macOS 는 icon.icns 를 읽고, 다른 Mac 앱처럼 판 둘레 100 px 여백을 둔다.
mkdir "$TMP/icon.iconset"
for s in 16 32 128 256 512; do
  sips -z $s $s "$WHITE" --out "$TMP/icon.iconset/icon_${s}x${s}.png" >/dev/null
  sips -z $((s * 2)) $((s * 2)) "$WHITE" --out "$TMP/icon.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$TMP/icon.iconset" -o build/icon.icns
cp "$WHITE" build/icon.png

# Windows 는 둘레 여백을 비우는 관례가 없어, 여백을 잘라 판이 칸을 채우게 한다(Prompt 와 같은 스크립트).
node scripts/trim-windows-icon-source.mjs
