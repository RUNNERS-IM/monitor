#!/usr/bin/env bash
# release 빌드 전에 버전을 올린다. Split · Prompt 와 같은 규칙:
# 출시일(KST) 기준 2.{연도 끝자리}.{MMDD}. 같은 날 이미 낸 버전이 있으면 뒤에 .2, .3 을 붙인다
# (GitHub 태그는 겹칠 수 없어서).
#
# 앱(package.json, electron-updater) · Cargo 는 버전을 semver 로만 받아서 앱 안에 넣는 버전은 모양을 조금 바꾼다:
#   - 앞자리 0 은 뺀다 (0105 -> 105). semver 는 0 으로 시작하는 숫자를 받지 않는다.
#   - 같은 날 두 번째부터는 .2 대신 +2 를 붙인다. semver 는 숫자 세 칸까지만 받는다.
#     -2 는 쓰지 않는다. Linux rpm 이 버전에 - 를 받지 않아 빌드가 멈추고, semver 가 -2 를 시험판으로 봐서
#     2.6.1030 보다 낮게 친다. +2 는 semver 가 비교하지 않으므로 같은 날 판끼리는 자동 업데이트가 되지 않고
#     다음 날 판부터 받는다(태그 v2.6.1030, v2.6.1030.2, v2.6.1030.3 → 앱 2.6.1030, 2.6.1030+2, 2.6.1030+3).
# 태그 · 파일 이름은 Split 과 같은 모양(v2.6.1030.2)을 쓴다.
#
# 두 줄을 출력한다: 1) 태그 · 파일 이름용 버전 2) 앱 안에 넣은 버전
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

YEAR=$(TZ=Asia/Seoul date +%Y)
MMDD=$(TZ=Asia/Seoul date +%m%d)
BASE="2.$((YEAR % 10)).$MMDD"
APP_BASE="2.$((YEAR % 10)).$((10#$MMDD))"
VERSION="$BASE"
APP_VERSION="$APP_BASE"
N=2
while git -C "$REPO_ROOT" rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null; do
  VERSION="$BASE.$N"
  APP_VERSION="$APP_BASE+$N"
  N=$((N + 1))
done

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
