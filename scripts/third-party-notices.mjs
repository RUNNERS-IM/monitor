// THIRD_PARTY_NOTICES.md 를 쓴다. 앱 안에 들어가는 Rust 크레이트(native/)와 npm 꾸러미(Electron, 운영 의존성)의 라이선스 고지다.
// 오픈소스 부품은 고지가 앱과 함께 가기를 요구한다. About 창의 「오픈소스 고지」가 이 파일을 보여 준다.
// 의존성을 바꾼 뒤 저장소 뿌리에서 실행한다: node scripts/third-party-notices.mjs <앱 이름> (cargo 와 pnpm 이 있어야 한다)
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const root = process.cwd()
const appName = process.argv[2]
if (!appName) {
  console.error('usage: node scripts/third-party-notices.mjs <app name>')
  process.exit(2)
}
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 })

/** 표현식에서 고른 라이선스에 맞는 파일. 없으면 아무 라이선스 파일. */
function licenseText(dir, expression) {
  if (!existsSync(dir)) {
    return null
  }
  const files = readdirSync(dir).filter((f) => /^(licen[cs]e|copying|notice)/i.test(f))
  const want = /\bMIT\b/.test(expression) ? /mit/i : /\bISC\b/.test(expression) ? /isc/i : /bsd/i
  const pick = files.find((f) => want.test(f)) ?? files.find((f) => !/apache/i.test(f)) ?? files[0]
  return pick ? readFileSync(join(dir, pick), 'utf8').trim() : null
}

const APACHE = /^\s*Apache License\s+Version 2\.0/

// 라이선스 파일이 없는 크레이트(objc2, webview2-com 등)는 꾸러미의 저자 목록과 표준 MIT 글로 고지를 쓴다.
const mitText = (holders) => `Copyright (c) ${holders}

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`
const entries = []

// Rust: 네이티브 모듈이 링크하는 전부. 일반 의존성만 따라간다(빌드 도구는 앱에 안 들어간다). native/ 가 없는 앱은 건너뛴다.
const hasNative = existsSync(join(root, 'native', 'Cargo.toml'))
const meta = hasNative
  ? JSON.parse(run('cargo', ['metadata', '--format-version', '1'], join(root, 'native')))
  : { packages: [], resolve: { nodes: [], root: null } }
const byId = new Map(meta.packages.map((p) => [p.id, p]))
const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]))
const seen = new Set()
const queue = hasNative ? [meta.resolve.root] : []
while (queue.length) {
  const id = queue.pop()
  for (const dep of nodes.get(id)?.deps ?? []) {
    if (!dep.dep_kinds.some((k) => k.kind === null) || seen.has(dep.pkg)) {
      continue
    }
    seen.add(dep.pkg)
    queue.push(dep.pkg)
  }
}
for (const id of seen) {
  const p = byId.get(id)
  let text = licenseText(dirname(p.manifest_path), p.license ?? '')
  if (!text && /\bMIT\b/.test(p.license ?? '')) {
    text = mitText(
      p.authors.length
        ? p.authors.map((a) => a.replace(/\s*<[^>]*>/, '')).join(', ')
        : `the ${p.name} authors`
    )
  }
  const source = `https://crates.io/crates/${p.name}/${p.version}`
  entries.push({ name: p.name, version: p.version, license: p.license ?? 'see file', text, source })
}

// npm: 화면과 메인 프로세스에 묶이는 꾸러미와 실행 중 불러오는 꾸러미.
const npm = JSON.parse(run('pnpm', ['licenses', 'list', '--prod', '--json'], root))
for (const [license, packages] of Object.entries(npm)) {
  for (const p of packages) {
    entries.push({
      name: p.name,
      version: p.versions.join(', '),
      license,
      text: licenseText(p.paths[0], license)
    })
  }
}

// Electron 은 앱이 돌아가는 바탕이다. package.json 에서는 빌드 도구라(electron-builder 가 넣는다) 위 --prod 목록에 안 나온다.
const electronDir = join(root, 'node_modules', 'electron')
const electronPkg = JSON.parse(readFileSync(join(electronDir, 'package.json'), 'utf8'))
entries.push({
  name: 'electron',
  version: electronPkg.version,
  license: electronPkg.license,
  text:
    `${licenseText(
      electronDir,
      electronPkg.license
    )}\n\nElectron includes Chromium and other open source software; their notices are in LICENSES.chromium.html, ` +
    `published with Electron ${electronPkg.version} at https://github.com/electron/electron/releases/tag/v${electronPkg.version}.`
})

// Pretendard 는 kit 의 글꼴 파일로 들어와 위 목록에 안 나온다.
entries.push({
  name: 'Pretendard',
  version: '1.3.9',
  license: 'OFL-1.1',
  text: readFileSync(join(import.meta.dirname, 'pretendard-license.txt'), 'utf8')
})

entries.sort((a, b) => a.name.localeCompare(b.name))
let apacheUsed = false
const parts = [
  '# Third-Party Notices',
  '',
  `${appName} includes software from the projects below. Their copyright and license notices follow.`,
  'The menu icons are drawn from Lucide (ISC License), listed under lucide-react.'
]
for (const e of entries) {
  parts.push('', `# ${e.name} ${e.version}`, '', `License: ${e.license}`)
  // Apache-2.0 글은 모두 같으니 수백 번 쓰지 않고 끝에 한 번 쓴다.
  if (e.text && APACHE.test(e.text)) {
    apacheUsed = true
    parts.push('', 'The Apache License 2.0 text is at the end of this file.')
  } else if (e.text) {
    parts.push('', e.text)
  } else if (/apache/i.test(e.license)) {
    apacheUsed = true
    parts.push('', 'The Apache License 2.0 text is at the end of this file.')
  } else if (e.source) {
    // 꾸러미에 라이선스 파일이 없다. 라이선스와 원본은 올린 곳에 있다.
    parts.push(
      '',
      `The package ships no license file. Its license text and source are at ${e.source}.`
    )
  }
}
if (apacheUsed) {
  const apache = entries.map((e) => e.text).find((t) => t && APACHE.test(t))
  if (apache) {
    parts.push('', '# Apache License 2.0', '', apache)
  }
}
writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), `${parts.join('\n')}\n`)
console.log(`${entries.length} packages written to THIRD_PARTY_NOTICES.md`)
