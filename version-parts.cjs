// 앱 버전(package.json)을 빌드에 쓰는 두 모양으로 나눈다. 규칙은 scripts/bump-release.sh 의 "버전 규칙".
//   shown: Finder · brew · 정보 창에 보이는 버전. 태그와 같다 (2.6.110504).
//   file:  Windows 파일 버전 · macOS CFBundleVersion 용 네 칸 (2.6.1105.4).
// Why: Windows 는 파일 버전을 칸마다 65535 까지인 숫자 네 칸으로 적어서 110504 를 그대로 못 넣는다.
//   그래서 셋째 칸을 날짜(1105)와 그날 번호(4)로 나눈다. Prompt 의 windows-file-version.cjs 와 같은 방식이다.
// 옛 규칙 버전(2.6.1105, 2.6.1105+3)도 읽는다: 2.6.1105 → 2.6.1105.0, 2.6.1105+3 → 2.6.1105.3.
//   그래서 네 칸 값도 옛 판 → 새 판 순서대로 커진다 (2.6.1105.3 < 2.6.1105.4).
function versionParts(version) {
  const [core, sameDay] = String(version).split('+')
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(core)
  if (!match) throw new Error(`버전 모양이 맞지 않습니다: ${version}`)
  const [major, minor, patch] = match.slice(1).map(Number)
  if (sameDay) return { shown: `${core}.${sameDay}`, file: `${core}.${sameDay}` }
  // 날짜 + 그날 번호(MMDDNN, 1월 1일 첫 판이 10101)면 나눈다. 옛 규칙 MMDD(1231 까지)는 그대로 두고 .0 을 붙인다.
  if (patch >= 10101) {
    return { shown: core, file: `${major}.${minor}.${Math.floor(patch / 100)}.${patch % 100}` }
  }
  return { shown: core, file: `${core}.0` }
}

module.exports = { versionParts }
