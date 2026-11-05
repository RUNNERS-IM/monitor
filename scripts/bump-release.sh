#!/usr/bin/env bash
# release 빌드 전에 버전을 올린다. 규칙은 아래 "버전 규칙" 칸에 있고 Prompt 와 같다.
#
# 예전에는 같은 날 두 번째 판을 2.6.1105.2(앱 안은 2.6.1105+2)로 냈다. semver 는 + 뒤를 비교하지 않아서
# 같은 날 판끼리 자동 업데이트가 되지 않았다. 이제 셋째 자리 끝에 그날 번호를 붙여(2.6.110502) 같은 날에도 받는다.
# Windows 파일 버전은 칸마다 65535 까지라 빌드 설정에서 2.6.1105.2 처럼 나눠 적는다(version-parts.cjs).
#
# 두 줄을 출력한다: 1) 태그 · 파일 이름용 버전 2) 앱 안에 넣은 버전(지금은 둘이 같다)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 바뀐 점(RELEASE_NOTES.md)이 GitHub 릴리스 본문이 되고, 앱의 업데이트 창이 그 목록을 보여 준다.
# 형식: "## 한국어" 와 "## English" 두 칸, 칸마다 "- " 로 시작하는 줄에 바뀐 점 하나씩(한국어는 합니다체).
# 비었거나 지난 릴리스의 글 그대로면 멈춘다. 고치지 않고 내면 업데이트 창이 옛 바뀐 점을 보여 주기 때문이다.
NOTES="$REPO_ROOT/RELEASE_NOTES.md"
python3 - "$NOTES" <<'PY'
import re, sys
text = open(sys.argv[1], encoding="utf-8").read() if __import__("os").path.exists(sys.argv[1]) else ""
for heading in ("한국어", "English"):
    m = re.search(rf"(?m)^##\s+{heading}\s*$(.*?)(?=^##\s|\Z)", text, re.S)
    items = [l for l in (m.group(1).splitlines() if m else []) if re.match(r"^\s*-\s+\S", l)]
    if not items:
        sys.exit(f"RELEASE_NOTES.md: '## {heading}' 아래에 '- ' 줄이 없습니다. 이번 판의 바뀐 점을 적어 주세요.")
PY
LAST_TAG=$(git -C "$REPO_ROOT" tag --list 'v*' --sort=-v:refname | head -1)
if [ -n "$LAST_TAG" ] && git -C "$REPO_ROOT" cat-file -e "$LAST_TAG:RELEASE_NOTES.md" 2>/dev/null; then
  if git -C "$REPO_ROOT" show "$LAST_TAG:RELEASE_NOTES.md" | cmp -s - "$NOTES"; then
    echo "RELEASE_NOTES.md 가 지난 릴리스($LAST_TAG)와 같습니다. 이번 판의 바뀐 점으로 고쳐 주세요." >&2
    exit 1
  fi
fi

# 버전 규칙(네 앱 같음, 2026-11-05 사용자 «2.6.1105 -> 2.6.110502 -> 2.6.110503»): 2.{연도 끝자리}.{MMDD}{NN}.
#   날짜는 출시일(KST), NN 은 그날 몇 번째 출시인지를 두 자리로 적은 것(01 부터 99 까지). Prompt 와 같다.
#   예) 그날 첫 출시 2.6.110501, 두 번째 2.6.110502. 1월 5일은 앞의 0 을 떼고 2.6.10501.
#   셋째 자리가 날짜 순서대로 커지므로 electron-updater 같은 semver 비교가 그대로 맞는다.
# 옛 규칙 태그도 그날 번호로 읽는다: v2.6.1105 → 01, v2.6.1105.3 → 03. 그래서 옛 규칙으로 세 번 낸 날의
#   다음 판은 2.6.110504 이고, 언제나 옛 판보다 크다.
YEAR=$(TZ=Asia/Seoul date +%Y)
MMDD=$(TZ=Asia/Seoul date +%m%d)
# 10#: 0 으로 시작하는 0105 같은 값을 8진수로 읽지 않게 한다.
DAY="2.$((YEAR % 10)).$((10#$MMDD))"
LAST=0
while IFS= read -r tag; do
  suffix="${tag#v$DAY}"
  if [ -z "$suffix" ]; then
    nn=1
  elif [[ "$suffix" =~ ^\.([0-9]+)$ ]]; then
    nn=$((10#${BASH_REMATCH[1]}))
  elif [[ "$suffix" =~ ^[0-9]{2}$ ]]; then
    nn=$((10#$suffix))
  else
    continue
  fi
  [ "$nn" -gt "$LAST" ] && LAST=$nn
done < <(git -C "$REPO_ROOT" tag -l "v$DAY" "v$DAY.*" "v$DAY[0-9][0-9]")
NEXT=$((LAST + 1))
if [ "$NEXT" -gt 99 ]; then
  echo "오늘($DAY) 이미 99 번 출시했습니다. 두 자리 번호를 넘으므로 멈춥니다." >&2
  exit 3
fi
VERSION="$DAY$(printf '%02d' "$NEXT")"
# 앱 안에 넣는 버전도 같은 값이다(예전에는 2.6.1105+3 처럼 + 를 붙였다).
APP_VERSION="$VERSION"

# 두 파일의 버전이 어긋나면 앱 정보 창과 네이티브 모듈의 버전이 서로 달라지니 같이 고친다
python3 - "$REPO_ROOT" "$APP_VERSION" <<'PY'
import json, re, sys
root, version = sys.argv[1], sys.argv[2]
path = f"{root}/package.json"
data = json.load(open(path))
data["version"] = version
with open(path, "w") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write("\n")
path = f"{root}/native/Cargo.toml"
text = open(path).read()
text = re.sub(r'(?m)^version = ".*"$', f'version = "{version}"', text, count=1)
open(path, "w").write(text)
PY

echo "$VERSION"
echo "$APP_VERSION"
