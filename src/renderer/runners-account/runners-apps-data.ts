// About 창의 「RUNNERS의 다른 앱」 · 「RUNNERS의 서비스」 목록. 인터넷 없이도 보이게 앱 안에 묶는다.
// runners-apps.json 과 assets/runners-apps/ 는 이 저장소가 원본이다. 앱 쪽 복사본을 고치지 않는다.
import draw from './assets/runners-apps/draw.png'
import drawDark from './assets/runners-apps/draw-dark.png'
import monitor from './assets/runners-apps/monitor.png'
import monitorDark from './assets/runners-apps/monitor-dark.png'
import prompt from './assets/runners-apps/prompt.png'
import promptDark from './assets/runners-apps/prompt-dark.png'
import pudding from './assets/runners-apps/pudding.png'
import remote from './assets/runners-apps/remote.png'
import remoteDark from './assets/runners-apps/remote-dark.png'
import sense from './assets/runners-apps/sense.png'
import split from './assets/runners-apps/split.png'
import splitDark from './assets/runners-apps/split-dark.png'
import source from './runners-apps.json'

/** 화면 언어 코드별 글. 그 언어 글이 없으면 영어를 읽는다. */
export type RunnersText = Record<string, string | undefined>

export type RunnersAppItem = {
  id: string
  name: string
  /** 한국어 이름을 쓰는 서비스의 영문 이름. 한국어가 아닌 화면에서 쓴다. */
  nameEn?: string
  /** 아이콘 주소. 없으면 카드가 첫 글자를 대신 그린다. */
  iconUrl: string
  /** 어두운 화면에서 쓰는 블랙 판 아이콘 주소. 없으면 어두운 화면에서도 iconUrl 을 쓴다. */
  iconDarkUrl?: string
  desc: RunnersText
  /** 받을 곳이 아직 없으면 빈 글자이고, 카드는 「받기」 단추를 숨긴다. */
  url: string
}

export type RunnersAppGroup = { id: string; title: RunnersText; items: RunnersAppItem[] }

const ICONS: Record<string, string> = {
  'draw.png': draw,
  'monitor.png': monitor,
  'prompt.png': prompt,
  'pudding.png': pudding,
  'remote.png': remote,
  'sense.png': sense,
  'split.png': split
}

/** 앱 아이콘의 블랙 판. 밝은 화면은 화이트 판, 어두운 화면은 블랙 판을 쓴다(2026-11-11 앱 아이콘 1A 2B). 서비스(센스 · 푸딩)는 한 판뿐이다. */
const DARK_ICONS: Record<string, string> = {
  'draw.png': drawDark,
  'monitor.png': monitorDark,
  'prompt.png': promptDark,
  'remote.png': remoteDark,
  'split.png': splitDark
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
          nameEn: (item as { nameEn?: string }).nameEn,
          iconUrl: ICONS[item.icon] ?? '',
          iconDarkUrl: DARK_ICONS[item.icon],
          desc: item.desc,
          url: isSafeUrl(item.url.trim()) ? item.url.trim() : ''
        }))
    }))
    .filter((group) => group.items.length > 0)
}

/** 한국어 화면은 name, 다른 화면은 영문 이름이 있으면 그것을 쓴다. */
export function pickName(item: RunnersAppItem, locale: string): string {
  return locale === 'ko' ? item.name : (item.nameEn ?? item.name)
}

/** 화면 언어의 글이 있으면 그 글, 없으면 영어. */
export function pickText(text: RunnersText, locale: string): string {
  return text[locale] || text.en || text.ko || ''
}
