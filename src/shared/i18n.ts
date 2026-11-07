// 화면 글 번역. 메인 프로세스와 창이 같은 locales/<언어>.json 을 쓴다. 번역 동작은 i18next 가 한다.
import i18next from 'i18next'
import { pickLocale } from '../main/runners/locale'

const files = import.meta.glob<Record<string, string>>('../../locales/*.json', {
  eager: true,
  import: 'default'
})
const resources = Object.fromEntries(
  Object.entries(files).map(([path, translation]) => [
    path.replace(/^.*\/(.+)\.json$/, '$1'),
    { translation }
  ])
)
const codes = Object.keys(resources)

/** 사람의 언어 목록에서 표가 있는 첫 언어를 고른다. 없으면 영어.
 *  Why: 표에 없는 언어가 맨 위이고 한국어가 두 번째인 사람은 영어가 아니라 한국어를 읽어야 한다. */
export function firstLocale(tags: readonly string[]): string {
  for (const tag of tags) {
    const code = pickLocale(tag, codes)
    // pickLocale 은 모르는 말도 영어로 돌려주므로, 정말 영어를 고른 것인지 가른다.
    if (code !== 'en' || /^en\b/i.test(tag)) {
      return code
    }
  }
  return 'en'
}

/** 언어를 정한다. 메인은 앱이 준비된 뒤에야 언어 목록을 알아서 불러올 때 시작하지 않는다. */
export function startI18n(tags: readonly string[]): void {
  void i18next.init({
    resources,
    lng: firstLocale(tags),
    // 이 언어에 없는 열쇠는 영어로 읽는다.
    fallbackLng: 'en',
    // Why: 열쇠가 'about.title' 처럼 점이 든 납작한 이름이고, 글 안의 쌍점으로 나뉘면 안 된다.
    keySeparator: false,
    nsSeparator: false,
    // Why: 표가 묶여 있어 기다릴 일이 없다. 창이 그려지기 전에 글이 준비되어 있어야 한다.
    initAsync: false,
    // Why: 글은 React 가 이스케이프하고, 메인은 HTML 로 내보내지 않는다.
    interpolation: { escapeValue: false }
  })
}

export function currentLocale(): string {
  return i18next.language
}

export function t(key: string, args: Record<string, string | number> = {}): string {
  return i18next.t(key, args)
}

export default i18next
