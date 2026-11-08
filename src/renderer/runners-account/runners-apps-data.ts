// About 창의 「RUNNERS의 다른 앱」 · 「RUNNERS의 서비스」 목록. 인터넷 없이도 보이게 앱 안에 묶는다.
// runners-apps.json 과 assets/runners-apps/ 는 이 저장소가 원본이다. 앱 쪽 복사본을 고치지 않는다.
import monitor from './assets/runners-apps/monitor.png'
import prompt from './assets/runners-apps/prompt.png'
import pudding from './assets/runners-apps/pudding.png'
import sense from './assets/runners-apps/sense.png'
import split from './assets/runners-apps/split.png'
import source from './runners-apps.json'

/** 목록에는 한국어 · 영어 · 아랍어가 있다. 다른 화면 언어는 영어를 읽는다. */
export type RunnersText = { ko?: string; en?: string; ar?: string }

export type RunnersAppItem = {
  id: string
  name: string
  /** 아이콘 주소. 없으면 카드가 첫 글자를 대신 그린다. */
  iconUrl: string
  desc: RunnersText
  /** 받을 곳이 아직 없으면 빈 글자이고, 카드는 「받기」 단추를 숨긴다. */
  url: string
}

export type RunnersAppGroup = { id: string; title: RunnersText; items: RunnersAppItem[] }

const ICONS: Record<string, string> = {
  'monitor.png': monitor,
  'prompt.png': prompt,
  'pudding.png': pudding,
  'sense.png': sense,
  'split.png': split
}

/** https 만 연다. 오타나 로컬 경로가 다른 프로그램을 띄우지 못하게 하려는 것이다. */
export function isSafeUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

/** 보여 주는 앱 자신을 뺀 묶음들. 비는 묶음은 뺀다. */
export function loadRunnersAppGroups(selfId: string): RunnersAppGroup[] {
  return source.groups
    .map((group) => ({
      id: group.id,
      title: group.title,
      items: group.items
        .filter((item) => item.id !== selfId)
        .map((item) => ({
          id: item.id,
          name: item.name,
          iconUrl: ICONS[item.icon] ?? '',
          desc: item.desc,
          url: isSafeUrl(item.url.trim()) ? item.url.trim() : ''
        }))
    }))
    .filter((group) => group.items.length > 0)
}

/** 한국어 · 아랍어 화면은 그 말, 나머지는 영어. */
export function pickText(text: RunnersText, locale: string): string {
  const own = locale === 'ko' ? text.ko : locale === 'ar' ? text.ar : text.en
  return own || text.en || text.ko || ''
}
