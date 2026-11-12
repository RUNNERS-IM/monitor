import { expect, test } from 'vitest'
import { startI18n, t } from '../src/shared/i18n'
import { osSuffix } from '../src/shared/os-words'

test('Mac 은 원래 열쇠, Windows 는 Win, 그 밖은 Linux 열쇠를 쓴다', () => {
  expect(osSuffix('darwin')).toBe('')
  expect(osSuffix('win32')).toBe('Win')
  expect(osSuffix('linux')).toBe('Linux')
})

test('알림 글은 운영체제마다 아이콘이 있는 곳을 그 운영체제 말로 적는다', () => {
  startI18n(['ko'])
  const body = (platform: string) =>
    t(`notice.body${osSuffix(platform)}`, { apps: 'Chrome 3.2 GB' })
  expect(body('darwin')).toContain('메뉴 막대')
  expect(body('win32')).toContain('알림 영역')
  expect(body('linux')).toContain('시스템 트레이')
  startI18n(['en'])
  expect(body('win32')).toContain('notification area')
  expect(body('linux')).toContain('system tray')
  expect(body('linux')).not.toContain('menu bar')
})
