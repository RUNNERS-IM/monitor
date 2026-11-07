// Monitor 의 Rust 모듈(native/, napi-rs): 숫자 읽기, 정리할 거리 재기, 끄기 · 멈추기, 트레이 그림.
// 타입은 빌드가 만드는 native/index.d.ts 를 쓴다. 개발 실행은 native/ 에서, 출시판은 Resources/native/ 에서 읽는다.
import { app } from 'electron'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type * as NativeModule from '../../native/index'
import { loadNative } from './runners/native-loader'

export type Sampler = NativeModule.Sampler

export const native = loadNative<typeof NativeModule>({
  dir: app.isPackaged ? join(process.resourcesPath, 'native') : join(app.getAppPath(), 'native'),
  prefix: 'monitor-native',
  require: createRequire(__filename)
})
