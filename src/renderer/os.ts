// 이 화면이 도는 운영체제. 글을 고를 때만 쓴다.
// Why: 개발 실행은 `?os=win32` · `?os=linux` 로 Mac 에서도 다른 운영체제의 글을 찍어 볼 수 있다(MONITOR_TEST_PLATFORM).
const debugOs = import.meta.env.DEV ? new URLSearchParams(location.search).get('os') : null
const agent = navigator.userAgent

export const platform =
  debugOs ??
  (agent.includes('Windows') ? 'win32' : agent.includes('Macintosh') ? 'darwin' : 'linux')
