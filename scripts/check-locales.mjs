#!/usr/bin/env node
// locales/ 의 모든 파일을 ko.json 과 견준다. ko.json 이 기준이다.
// 모든 언어가 ko 의 열쇠를 빠짐없이 가지고, 값마다 같은 {{자리표시}} 를 가져야 한다. 복수형 열쇠(_one · _few …)는 언어마다 달라 묶어서 본다.
// 사용법: node scripts/check-locales.mjs [폴더]    폴더를 안 주면 ./locales 를 본다. 어긋나면 1 로 끝난다.
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const LANGUAGE_COUNT = 20
const PLURAL = /_(zero|one|two|few|many|other)$/
const dir = resolve(process.argv[2] ?? 'locales')

function flatten(table, prefix = '') {
  const out = {}
  for (const [key, value] of Object.entries(table)) {
    if (value && typeof value === 'object') {
      Object.assign(out, flatten(value, `${prefix}${key}.`))
    } else {
      out[`${prefix}${key}`] = value
    }
  }
  return out
}

const load = (file) => flatten(JSON.parse(readFileSync(join(dir, file), 'utf8')))
const slots = (text) =>
  [...new Set(String(text).match(/\{\{\s*\w+\s*\}\}/g) ?? [])].toSorted().join(' ')

/** 복수형 열쇠를 하나로 묶는다: sessions_one · sessions_other → sessions */
function grouped(table) {
  const out = new Map()
  for (const [key, value] of Object.entries(table)) {
    const name = key.replace(PLURAL, '')
    out.set(name, [...(out.get(name) ?? []), value])
  }
  return out
}

const source = grouped(load('ko.json'))
const files = readdirSync(dir)
  .filter((file) => file.endsWith('.json') && file !== 'ko.json')
  .toSorted()
let problems = 0

for (const file of files) {
  const table = grouped(load(file))
  const issues = []
  for (const [key, values] of source) {
    if (!table.has(key)) {
      issues.push(`missing key: ${key}`)
      continue
    }
    const expected = slots(values.join(' '))
    const found = slots(table.get(key).join(' '))
    // 복수형은 한국어처럼 한 꼴만 있는 언어와 숫자를 문구에 안 쓰는 꼴(_one)이 있어 자리표시가 달라도 된다.
    if (found !== expected && values.length === 1 && table.get(key).length === 1) {
      issues.push(`placeholders differ: ${key} (ko: "${expected}", ${file}: "${found}")`)
    }
    if (table.get(key).some((value) => typeof value !== 'string')) {
      issues.push(`not a string: ${key}`)
    }
  }
  for (const key of table.keys()) {
    if (!source.has(key)) {
      issues.push(`extra key: ${key}`)
    }
  }
  if (issues.length > 0) {
    problems += issues.length
    console.log(`FAIL ${file}`)
    for (const issue of issues) {
      console.log(`  - ${issue}`)
    }
  } else {
    console.log(`ok   ${file}`)
  }
}

const count = files.length + 1
if (count !== LANGUAGE_COUNT) {
  problems += 1
  console.log(`FAIL ${count} locales, expected ${LANGUAGE_COUNT}`)
}
console.log(`\n${count} locales, ${source.size} keys each, ${problems} problem(s)`)
process.exit(problems > 0 ? 1 : 0)
