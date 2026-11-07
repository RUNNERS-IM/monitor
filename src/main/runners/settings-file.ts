// 앱 설정 파일(userData 안의 settings.json) 읽기 · 쓰기. 임시 파일에 먼저 쓰고 바꿔서, 쓰다가 앱이 꺼져도 설정이 깨지지 않는다.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type SettingsFile<T> = {
  read: () => T
  write: (change: Partial<T>) => T
}

export function createSettingsFile<T extends object>(file: string, defaults: T): SettingsFile<T> {
  const read = (): T => {
    try {
      return { ...defaults, ...(JSON.parse(readFileSync(file, 'utf8')) as Partial<T>) }
    } catch {
      return { ...defaults }
    }
  }
  return {
    read,
    write(change) {
      const next = { ...read(), ...change }
      const temp = `${file}.tmp`
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(temp, JSON.stringify(next, null, 2))
      renameSync(temp, file)
      return next
    }
  }
}
