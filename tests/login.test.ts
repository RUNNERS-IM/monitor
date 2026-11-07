import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  app: {
    isPackaged: false,
    getPath: (_name: string): string => '',
    getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
    setLoginItemSettings: vi.fn()
  }
}))
vi.mock('electron', () => electron)

let folder: string

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'monitor-login-'))
  electron.app.getPath = () => folder
  electron.app.setLoginItemSettings.mockClear()
  vi.resetModules()
})

afterEach(() => rmSync(folder, { recursive: true, force: true }))

test('개발 실행은 메뉴 토글과 기본값 모두 로그인 항목을 쓰지 않는다', async () => {
  electron.app.isPackaged = false
  const login = await import('../src/main/login')
  login.toggle()
  login.setOn(true)
  login.applyDefault()
  expect(electron.app.setLoginItemSettings).not.toHaveBeenCalled()
})

test('출시판은 토글이 로그인 항목을 쓴다', async () => {
  electron.app.isPackaged = true
  const login = await import('../src/main/login')
  login.toggle()
  expect(electron.app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true })
})

test('출시판은 처음 한 번만 켜고, 그 뒤에는 끈 선택을 지킨다', async () => {
  electron.app.isPackaged = true
  const login = await import('../src/main/login')
  login.applyDefault()
  login.applyDefault()
  expect(electron.app.setLoginItemSettings).toHaveBeenCalledTimes(1)
})
