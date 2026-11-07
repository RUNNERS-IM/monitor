// 앱의 Rust 모듈(native/, napi-rs)을 불러온다. 빌드는 운영체제 · CPU 마다 파일 하나를 남기고(monitor-native.darwin-arm64.node …),
// 맥은 두 CPU 를 합친 파일 하나를 쓰기도 한다(split-native.darwin-universal.node).
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

export type NativeLoaderOptions = {
  /** 개발 실행은 native/, 출시판은 Resources/native/ */
  dir: string
  /** 파일 이름 앞부분. 예: monitor-native */
  prefix: string
  /** createRequire(import.meta.url) 또는 createRequire(__filename) */
  require: (path: string) => unknown
  platform?: string
  arch?: string
}

export function loadNative<T>(options: NativeLoaderOptions): T {
  const { dir, prefix } = options
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const names = readdirSync(dir).filter((name) => name.endsWith('.node'))
  const exact = `${prefix}.${platform}-${arch}`
  const file =
    names.find((name) => name.startsWith(exact)) ??
    names.find((name) => name === `${prefix}.${platform}-universal.node`)
  if (!file) {
    throw new Error(`no ${exact}*.node in ${dir}; run pnpm native`)
  }
  return options.require(join(dir, file)) as T
}
