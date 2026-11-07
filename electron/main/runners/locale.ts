// 네 앱이 함께 내는 20개 언어와, 기기 언어를 그중 하나로 고르는 법. 컴퓨터판과 휴대폰판이 같이 쓴다.

export const LANGUAGES = [
  'ar',
  'de',
  'en',
  'es',
  'fi',
  'fr',
  'hi',
  'id',
  'it',
  'ja',
  'ko',
  'nl',
  'pl',
  'pt',
  'ru',
  'th',
  'tr',
  'vi',
  'zh-Hans',
  'zh-Hant'
] as const

export type Language = (typeof LANGUAGES)[number]

/** `de-AT` · `zh-Hant-TW` 같은 말을 정확히 같은 코드 → 언어 부분 순서로 찾고, 없으면 영어로 둔다. */
export function pickLocale(tag: string, codes: readonly string[] = LANGUAGES): string {
  const normalized = tag.replace(/_/g, '-')
  const exact = codes.find((code) => code.toLowerCase() === normalized.toLowerCase())
  if (exact) {
    return exact
  }
  const language = normalized.split('-')[0].toLowerCase()
  if (language === 'zh') {
    // 대만 · 홍콩 · 마카오는 번체를 쓴다. 나머지 중국어는 간체로 읽는다.
    const wanted = /-(hant|tw|hk|mo)\b/i.test(normalized) ? 'zh-Hant' : 'zh-Hans'
    if (codes.includes(wanted)) {
      return wanted
    }
  }
  return codes.includes(language) ? language : 'en'
}
