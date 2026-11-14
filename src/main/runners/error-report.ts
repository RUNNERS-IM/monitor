// 오류 자동 수집(Sentry). 다섯 앱 컴퓨터판(main · 화면 쪽)과 휴대폰판이 같은 규칙으로 켠다(사용자 결정
// `[PROGRAM] 관리 - 프로그램 오류 자동 수집` 1A 2A 3B, 2026-11-15).
// kit 은 Sentry 를 불러오지 않는다. 앱이 `@sentry/electron/main` · `@sentry/electron/renderer` · `@sentry/react-native` 를 넘겨준다.
// 보내는 것은 오류 종류 · 코드 줄 · 앱 판 · OS 판뿐이다. 사람을 알아볼 수 있는 것은 보내기 전에 [가림] 으로 바꾼다.
// 가리기 규칙은 Prompt 의 crash-report-redaction.ts 를 옮겨 왔다.

export const HIDDEN = '[가림]'

const SECRET_PATTERNS = [
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/gi,
  // 로그인 토큰(JWT): 점으로 나뉜 세 덩어리
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g
]
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g
const CREDENTIAL_URL_PATTERN = /\b[A-Za-z0-9._%+-]+:[A-Za-z0-9._%+-]+@(?=[^/\s]+)/g
const SECRET_ASSIGNMENT_PATTERN =
  /\b(token|access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret|secret|password|account[_-]?key)\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^&\s,;]+)/gi
// 홈 폴더 아래 경로는 사용자 이름만 가린다. 앱 안 파일 경로는 남아야 어느 줄인지 안다.
const HOME_PATTERNS = [
  /(\/Users\/)[^/\s"'`<>)]+/g,
  /(\/home\/)[^/\s"'`<>)]+/g,
  /([A-Za-z]:\\Users\\)[^\\\s"'`<>)]+/gi
]
// 이 이름의 칸은 값이 무엇이든 통째로 가린다: 창 제목 · 세션 이름 · 입력 글 · 붙여 보낸 글 · 요청 본문 · 계정.
// `value` 는 넣지 않는다. 오류 문구(exception.values[].value)가 그 이름이라, 넣으면 무슨 오류인지 알 수 없다.
const HIDDEN_KEY =
  /(?:^|_)(?:title|text|input|clipboard|paste|keys?|body|password|passwd|email|e_?mail|token|secret|cookie|authorization|username|user_?name|host_?name|computer_?name|session_?name|session_?title)$/i

/** 글 하나에서 이메일 · 토큰 · 홈 폴더 이름 · 앱이 넘긴 값을 가린다. */
export function redactText(value: string, hide: readonly string[] = []): string {
  let out = value
  for (const word of hide) {
    if (word.length >= 3) {
      out = out.split(word).join(HIDDEN)
    }
  }
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, HIDDEN)
  }
  out = out.replace(CREDENTIAL_URL_PATTERN, `${HIDDEN}@`)
  out = out.replace(SECRET_ASSIGNMENT_PATTERN, (_match, key: string) => `${key}=${HIDDEN}`)
  out = out.replace(EMAIL_PATTERN, HIDDEN)
  for (const pattern of HOME_PATTERNS) {
    out = out.replace(pattern, `$1${HIDDEN}`)
  }
  return out
}

function keyHidden(key: string): boolean {
  return HIDDEN_KEY.test(key.replace(/([a-z0-9])([A-Z])/g, '$1_$2'))
}

/** 값 안의 글을 모두 가린다. 이름이 가릴 칸이면 값째 [가림] 으로 바꾼다. */
export function redactValue(value: unknown, hide: readonly string[] = [], depth = 0): unknown {
  if (typeof value === 'string') {
    return redactText(value, hide)
  }
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (depth > 8) {
    return HIDDEN
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, hide, depth + 1))
  }
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    out[key] =
      keyHidden(key) && item !== null && item !== undefined && typeof item !== 'boolean'
        ? HIDDEN
        : redactValue(item, hide, depth + 1)
  }
  return out
}

type AnyRecord = Record<string, unknown>

/** 보내기 직전의 오류 하나(beforeSend). 사람 · 기기 정보는 빼고 나머지 글은 가린다. */
export function redactEvent<E extends object>(event: E, hide: readonly string[] = []): E {
  const copy = { ...(event as AnyRecord) }
  delete copy.user
  delete copy.server_name
  if (copy.request && typeof copy.request === 'object') {
    const { url, method } = copy.request as AnyRecord
    copy.request = { url, method }
  }
  if (copy.contexts && typeof copy.contexts === 'object') {
    const contexts = { ...(copy.contexts as AnyRecord) }
    if (contexts.device && typeof contexts.device === 'object') {
      const device = { ...(contexts.device as AnyRecord) }
      delete device.name
      contexts.device = device
    }
    copy.contexts = contexts
  }
  // 오류 종류 · 판 · 코드 줄 위치는 남긴다. 그 밖의 글(메시지 · 덧붙인 값 · 지나온 일)은 가린다.
  return redactValue(copy, hide) as E
}

type Breadcrumb = { category?: string } & AnyRecord
type Integration = { name: string }

export type ErrorReportSentry = {
  init: (options: AnyRecord) => unknown
}

export type ErrorReportOptions = {
  /** 보낼 곳(Sentry DSN). 비어 있으면 아무것도 하지 않는다. */
  dsn: string | undefined
  /** 앱 판. 예: monitor@2.6.111401 */
  release?: string
  /** production · development */
  environment?: string
  /** 글에서 더 가릴 값: 컴퓨터 이름 · OS 사용자 이름 등. 3글자 미만은 무시한다. */
  hide?: readonly string[]
}

// 화면 녹화 · 스크린샷 · 화면 구조 · 콘솔 기록은 켜지 않는다(2A). 휴대폰판(@sentry/react-native)의 MobileReplay · ViewHierarchy 도 같이 뺀다.
// 컴퓨터판의 SentryMinidump · ElectronMinidump 는 앱이 죽을 때 메모리 덤프를 가림 없이 올려서 뺀다(2026-11-15 [PROGRAM] 관리).
const DROPPED_INTEGRATIONS =
  /replay|screenshot|view.?hierarchy|console|feedback|browsertracing|reactnavigation|reactnativetracing|minidump/i

/** Sentry init 에 넘길 값. DSN 이 비면 null. */
export function errorReportConfig(options: ErrorReportOptions): AnyRecord | null {
  const dsn = options.dsn?.trim()
  if (!dsn) {
    return null
  }
  const hide = (options.hide ?? []).filter((word) => word.length >= 3)
  return {
    dsn,
    release: options.release,
    environment: options.environment,
    sendDefaultPii: false,
    attachScreenshot: false,
    // 휴대폰판에만 있는 값. 화면 구조(글자 · 이름이 든 칸 목록)를 붙이지 않는다.
    attachViewHierarchy: false,
    // 휴대폰판에만 있는 값. 네이티브 충돌은 앱 밖(iOS · Android SDK)에서 보내져 beforeSend 가림을 거치지 않는다.
    enableNativeCrashHandling: false,
    // 성능 추적은 0 이라 아무것도 보내지 않는다. beforeSendTransaction 은 새 판에서 무시되고 경고만 내서 넣지 않는다.
    tracesSampleRate: 0,
    maxBreadcrumbs: 30,
    integrations: (defaults: Integration[]) =>
      defaults.filter((integration) => !DROPPED_INTEGRATIONS.test(integration.name)),
    beforeSend: (event: object) => redactEvent(event, hide),
    beforeBreadcrumb: (breadcrumb: Breadcrumb) =>
      breadcrumb.category === 'console' ? null : redactValue(breadcrumb, hide)
  }
}

/** 오류 수집을 켠다. 켰으면 참. main 과 화면 쪽에서 각각 한 번 부른다. */
export function startErrorReport(sentry: ErrorReportSentry, options: ErrorReportOptions): boolean {
  const config = errorReportConfig(options)
  if (!config) {
    return false
  }
  sentry.init(config)
  return true
}
