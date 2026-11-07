// 패널과 창의 글. 언어는 시작할 때 한 번 정하고 바꾸지 않는다.
import type ko from '../../locales/ko.json'
import { setI18n } from 'react-i18next'
import i18next, { currentLocale, startI18n, t as translate } from '../shared/i18n'

type Key = keyof typeof ko

// Why: 개발 실행은 창마다 언어를 고를 수 있어(`?lang=ja`), 한 번 실행으로 모든 언어를 찍을 수 있다.
const debugLang = import.meta.env.DEV ? new URLSearchParams(location.search).get('lang') : null
startI18n(debugLang ? [debugLang] : navigator.languages)
setI18n(i18next)

export const locale = currentLocale()

document.documentElement.lang = locale
document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr'

/** 없는 열쇠를 빌드 때 잡으려고 ko.json 의 열쇠로 좁힌다. */
export const t = translate as (key: Key, args?: Record<string, string | number>) => string
