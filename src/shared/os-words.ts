// 메뉴 막대 · macOS 처럼 Mac 에만 맞는 말을 Windows · Linux 에서는 그 운영체제 말로 바꾼다.
// 같은 뜻의 열쇠 끝에 Win · Linux 를 붙여 둔다(Draw 와 같은 방식): 메뉴 막대는 Windows 알림 영역, Linux 시스템 트레이.

/** process.platform 값(darwin · win32 · linux …)에 맞는 열쇠 끝. Mac 은 끝을 붙이지 않는다. */
export function osSuffix(platform: string): '' | 'Win' | 'Linux' {
  return platform === 'darwin' ? '' : platform === 'win32' ? 'Win' : 'Linux'
}
