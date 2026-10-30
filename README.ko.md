# Monitor

[English](README.md) · **한국어**

메뉴 막대나 트레이에서 컴퓨터가 얼마나 바쁜지 봅니다. CPU, 메모리, 디스크, 돌고 있는 claude 세션, GitHub Actions 러너 상태가 나옵니다.

Monitor 는 RUNNERS-IM 이 사무실 컴퓨터를 보려고 만드는 앱입니다. [Tauri 2](https://tauri.app) 로 처음부터 새로 짜서, 코드 하나로 macOS(애플 실리콘·인텔), 윈도우, 리눅스 판을 만듭니다.

## 보여 주는 것

메뉴 막대의 숫자(macOS)나 트레이 아이콘(윈도우·리눅스)을 누르면 패널이 열립니다.

| 항목 | 뜻 |
|:---|:---|
| CPU | 모든 코어의 평균 사용률 |
| 메모리 | 쓰고 있는 메모리와 전체 메모리. 메뉴 막대 숫자가 이 값입니다 |
| 디스크 | 시스템이 켜지는 디스크의 사용량(macOS·리눅스는 `/`, 윈도우는 시스템 드라이브) |
| claude 세션 | 돌고 있는 `claude` 프로세스 수 |
| GitHub 러너 | 작업이 돌고 있으면 **빌드 중**, 러너가 기다리고 있으면 **대기**, 러너가 없으면 **없음** |

메뉴 막대 숫자나 트레이 아이콘을 오른쪽 클릭하면 메뉴가 나옵니다. Monitor 정보, 업데이트 확인, 사용량 보기, 설정, 도움말·피드백, 끝내기 순서입니다.

패널과 메뉴는 컴퓨터에 설정된 언어를 따릅니다. 영어와 한국어를 지원합니다.

## 설치

아직 배포하지 않았습니다. 첫 배포 전까지는 아래 "소스에서 빌드하기"로 직접 빌드합니다.

배포는 Split·Prompt 와 같은 규칙을 따릅니다. 버전은 `2.6.1030` 같은 모양이고, 파일은 [GitHub Releases](https://github.com/RUNNERS-IM/monitor/releases) 에 올리며, macOS 는 `runners-im/tap` 의 Homebrew cask 로도 설치할 수 있게 할 예정입니다.

## 계획

끝난 것:

- 이 컴퓨터 한 대를 보는 트레이 앱: CPU, 메모리, 디스크, claude 세션, 러너 상태
- macOS 흐림 효과(윈도우는 Acrylic)를 쓴 패널, 라이트·다크 모드
- Split·Prompt 와 같은 메뉴 순서
- 영어, 한국어

다음:

- 같은 패널에서 사무실의 다른 컴퓨터 목록 보기
- 서명된 배포, 자동 업데이트, macOS·윈도우·리눅스 설치 파일
- AWS EC2 서버

이슈와 풀 리퀘스트는 이 저장소에 남겨 주세요.

## 소스에서 빌드하기

[Rust](https://rustup.rs), Node.js 20 이상, pnpm 이 필요합니다. 리눅스는 먼저 [Tauri 시스템 패키지](https://tauri.app/start/prerequisites/)를 설치합니다.

```sh
pnpm install
pnpm tauri dev      # 고치면 바로 다시 켜지는 개발 실행
pnpm tauri build    # 지금 운영체제용 설치 파일 만들기
```

화면 글자는 `locales/`(`en.json`, `ko.json`)에 모여 있습니다. 패널(`src/`)과 트레이 메뉴(`src-tauri/`)가 같은 파일을 읽습니다.

지금까지는 macOS(애플 실리콘)에서만 빌드해서 확인했습니다. 윈도우·리눅스 빌드는 아직 해 보지 않았습니다.

## 개인정보

Monitor 는 아무것도 모으거나 보내지 않습니다. [PRIVACY.md](PRIVACY.md) 를 보세요.

## 라이선스

아직 정하지 않았습니다.
