import { expect, test } from 'vitest'
import { firstLocale, startI18n, t } from '../src/shared/i18n'

test('언어 목록에서 표가 있는 첫 언어를 고른다', () => {
  expect(firstLocale(['ko-KR', 'en-US'])).toBe('ko')
  expect(firstLocale(['xx-XX', 'ja-JP'])).toBe('ja')
  expect(firstLocale(['en-GB', 'ko-KR'])).toBe('en')
  expect(firstLocale(['xx-XX'])).toBe('en')
  expect(firstLocale([])).toBe('en')
})

test('중국어는 지역에 따라 간체와 번체로 나눈다', () => {
  expect(firstLocale(['zh-CN'])).toBe('zh-Hans')
  expect(firstLocale(['zh-TW'])).toBe('zh-Hant')
  expect(firstLocale(['zh_HK'])).toBe('zh-Hant')
})

test('자리표시를 채우고, 값 속 기호를 바꾸지 않으며, 없는 열쇠는 그대로 돌려준다', () => {
  startI18n(['ko'])
  expect(t('update.downloading', { percent: 42 })).toBe('받는 중… 42%')
  expect(t('tray.title', { value: '<b>&1' })).toBe('<b>&1')
  expect(t('없는.열쇠')).toBe('없는.열쇠')
})

test('count 를 넘겨도 복수형 열쇠 없이 그 글을 읽는다', () => {
  startI18n(['ko'])
  expect(t('summary.claude', { count: 3 })).toBe('Claude 세션 3')
  startI18n(['en'])
  expect(t('summary.claude', { count: 1 })).toContain('1')
})
