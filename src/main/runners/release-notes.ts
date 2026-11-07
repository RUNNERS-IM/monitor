// 업데이트 창의 「새 소식」 줄을 권하는 판의 GitHub 출시 글에서 읽는다.
//
// 출시 글 모양(저장소의 RELEASE_NOTES.md 가 출시 글이 된다):
//
//   ## 한국어
//   - 한 줄에 바뀐 점 하나, 합니다체로 씁니다.
//   ## English
//   - One change per line.
//
// electron-updater 는 GitHub 글을 HTML(`<h2>한국어</h2><ul><li>…</li></ul>`)로 넘긴다. 마크다운 글도 읽는다.
// 글자만 꺼낸다. 태그를 버리고 엔티티를 풀며 화면은 글자로만 그리므로, 출시 글의 어떤 내용도 HTML 로 실행되지 않는다.

/** 남기는 줄 수. 다섯 줄이 넘으면 칸이 스크롤되고, 이보다 많으면 글 모양이 틀린 것이다. */
const MAX_LINES = 12
const MAX_LINE_LENGTH = 300

export type NotesLanguage = 'ko' | 'en'

/** `## 한국어`(한국어) 또는 `## English`(그 밖의 언어) 아래 목록. 없으면 null. */
export function releaseNoteLines(notes: unknown, language: NotesLanguage): string[] | null {
  const body = noteText(notes)
  if (!body) {
    return null
  }
  const heading = language === 'ko' ? '한국어' : 'English'
  const lines = /<\s*h[1-6][\s>]/i.test(body)
    ? fromHtml(body, heading)
    : fromMarkdown(body, heading)
  const clean = lines
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .map((line) =>
      line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH - 1)}…` : line
    )
    .slice(0, MAX_LINES)
  return clean.length > 0 ? clean : null
}

/** electron-updater 는 글자를 주거나, 여러 출시를 모으면 `{ version, note }` 목록을 준다. */
function noteText(notes: unknown): string | null {
  if (typeof notes === 'string') {
    return notes
  }
  // 권하는 판의 내용만 필요하고, 그것이 목록의 첫 칸이다.
  if (Array.isArray(notes) && notes.length > 0 && typeof notes[0]?.note === 'string') {
    return notes[0].note
  }
  return null
}

function fromHtml(html: string, heading: string): string[] {
  const parts = html.split(/<\s*h[1-6][^>]*>/i).slice(1)
  for (const part of parts) {
    const end = part.search(/<\s*\/\s*h[1-6]\s*>/i)
    if (end < 0) {
      continue
    }
    if (plain(part.slice(0, end)) !== heading) {
      continue
    }
    const items = part.slice(end).match(/<\s*li[^>]*>[\s\S]*?<\s*\/\s*li\s*>/gi) ?? []
    return items.map(plain)
  }
  return []
}

function fromMarkdown(text: string, heading: string): string[] {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex(
    (line) => /^#{1,6}\s/.test(line) && line.replace(/^#+\s*/, '').trim() === heading
  )
  if (start === -1) {
    return []
  }
  const out: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line)) {
      break
    }
    const item = line.match(/^\s*[-*]\s+(.*)$/)
    if (item) {
      out.push(item[1])
    }
  }
  return out
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
}

/** HTML 조각의 글자: 태그를 지우고 흔한 엔티티와 숫자 엔티티를 푼다. */
function plain(fragment: string): string {
  return fragment
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
      if (name[0] === '#') {
        const code =
          name[1] === 'x' || name[1] === 'X'
            ? Number.parseInt(name.slice(2), 16)
            : Number.parseInt(name.slice(1), 10)
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : ''
      }
      return ENTITIES[name.toLowerCase()] ?? whole
    })
    .trim()
}
