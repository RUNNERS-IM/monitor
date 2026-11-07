#!/bin/bash
# 트레이 메뉴 아이콘(resources/menu/)을 공식 Lucide SVG 로 만든다. 저장소 뿌리에서 실행한다.
# 아이콘마다 검정(밝은 메뉴) · 흰색(어두운 메뉴) 36 px 이고, 네이티브 메뉴가 그리는 18 pt 칸의 2배다. 상태 점은 색을 채운 원이다.
# 사용법: scripts/menu-icons.sh "<아이콘 이름들>" "<점 이름:색들>"
#   예: scripts/menu-icons.sh "info refresh-cw" "green:#34c759 yellow:#ffcc00 red:#ff3b30"
# macOS 14 이상(AppKit 이 SVG 를 읽음)과 unpkg.com 접속이 있어야 한다.
set -euo pipefail

LUCIDE_VERSION=1.63.0
PIXELS=36
if [ $# -ne 2 ]; then
  echo 'usage: scripts/menu-icons.sh "<icons>" "<dots>"' >&2
  exit 2
fi
read -r -a ICONS <<< "$1"
read -r -a DOTS <<< "$2"

OUT="$PWD/resources/menu"
DRAW="$(cd "$(dirname "$0")" && pwd)/menu-icons.swift"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT"

for name in "${ICONS[@]}"; do
  curl -sfL "https://unpkg.com/lucide-static@$LUCIDE_VERSION/icons/$name.svg" -o "$WORK/$name.svg"
  for tone in black:#000000 white:#ffffff; do
    label="${tone%%:*}"
    color="${tone#*:}"
    # 공통 규격은 Lucide 기본 2 대신 선 굵기 1.5 를 쓴다.
    sed -e "s/currentColor/$color/g" -e 's/stroke-width="2"/stroke-width="1.5"/' "$WORK/$name.svg" > "$WORK/$name-$label.svg"
    swift "$DRAW" "$WORK/$name-$label.svg" "$OUT/$name-$label.png" "$PIXELS"
  done
done

# 18 pt 칸 가운데 9 pt 점이라 아래 아이콘들과 줄이 맞는다.
for dot in "${DOTS[@]}"; do
  label="${dot%%:*}"
  color="${dot#*:}"
  printf '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" fill="%s"/></svg>' "$color" > "$WORK/dot-$label.svg"
  swift "$DRAW" "$WORK/dot-$label.svg" "$OUT/dot-$label.png" "$PIXELS"
done

echo "wrote $(ls "$OUT" | wc -l | tr -d ' ') files to $OUT"
