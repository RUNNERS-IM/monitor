// 복사한 파일이 runners-app-kit 에서 복사해 온 그대로인지 본다. 앱끼리 어긋나지 않게 하려는 것이다.
// 같은 폴더의 *.sum 을 모두 읽는다. 사용법: node <복사한 폴더>/check.mjs [--kit 0.1.8]
// --kit 을 주면 복사해 온 kit 판이 그 판인지도 본다.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const here = import.meta.dirname
const flag = process.argv.indexOf('--kit')
const wanted = flag !== -1 ? process.argv[flag + 1]?.replace(/^v/, '') : null
const changed = []
const versions = new Set()

for (const sum of readdirSync(here).filter((name) => name.endsWith('.sum'))) {
  for (const line of readFileSync(join(here, sum), 'utf8').split('\n')) {
    const version = line.match(/^# runners-app-kit v(\S+)/)?.[1]
    if (version) {
      versions.add(version)
    }
    const match = line.match(/^([0-9a-f]{64}) {2}(.+)$/)
    if (!match) {
      continue
    }
    let hash = 'missing'
    try {
      hash = createHash('sha256')
        .update(readFileSync(join(here, match[2])))
        .digest('hex')
    } catch {
      // 없는 파일도 다른 파일로 친다.
    }
    if (hash !== match[1]) {
      changed.push(match[2])
    }
  }
}

if (changed.length > 0) {
  console.error(
    `runners-app-kit: ${changed.join(', ')} differ from the copy. Change them in runners-app-kit and copy again.`
  )
  process.exit(1)
}
const seen = [...versions].join(', ') || 'unknown'
if (wanted && !(versions.size === 1 && versions.has(wanted))) {
  console.error(`runners-app-kit: copied from v${seen}, expected v${wanted}. Copy again.`)
  process.exit(1)
}
console.log(`runners-app-kit: same as the copy of v${seen}`)
