# Monitor

[English](README.md) · **한국어**

메뉴 막대나 트레이에서 컴퓨터가 얼마나 바쁜지 봅니다. CPU, 메모리, 디스크, 돌고 있는 claude 세션, GitHub Actions 러너 상태가 나옵니다.

Monitor는 RUNNERS-IM이 사무실 컴퓨터를 보려고 만드는 앱입니다. [Electron](https://www.electronjs.org) 과 Rust 로 짠 작은 네이티브 모듈 하나(`native/`)로 만들어서(RUNNERS의 다른 데스크톱 앱과 같은 도구), 코드 하나로 macOS(애플 실리콘·인텔), 윈도우, 리눅스 판을 만듭니다.

## 보여 주는 것

메뉴 막대의 숫자(macOS)나 트레이 아이콘(윈도우·리눅스)을 누르면 패널이 열립니다.

| 항목 | 뜻 |
|:---|:---|
| CPU | 모든 코어의 평균 사용률 |
| 메모리 | 쓰고 있는 메모리와 전체 메모리. 메뉴 막대 숫자가 이 값입니다 |
| 디스크 | 시스템이 켜지는 디스크의 사용량(macOS·리눅스는 `/`, 윈도우는 시스템 드라이브) |
| claude 세션 | 돌고 있는 `claude` 프로세스 수 |
| GitHub 러너 | 작업이 돌고 있으면 **빌드 중**, 러너가 기다리고 있으면 **대기**, 러너가 없으면 **없음** |

패널이 곧 Monitor의 메뉴입니다. 사용량 아래에 로그인할 때 열기, 업데이트 자동 확인, Monitor 정보, 업데이트 확인, 도움말 · 피드백, Monitor 종료가 있습니다. 아이콘을 오른쪽 클릭하면 같은 명령이 시스템 메뉴로 나오고, 맨 위에 상태 줄이 붙습니다.

패널과 메뉴는 컴퓨터에 설정된 언어를 따릅니다. 20개 언어를 지원합니다: 한국어, 영어, 일본어, 중국어(간체), 중국어(번체), 독일어, 프랑스어, 스페인어, 포르투갈어, 이탈리아어, 네덜란드어, 핀란드어, 폴란드어, 러시아어, 터키어, 아랍어, 힌디어, 태국어, 베트남어, 인도네시아어.

## 설치

macOS(애플 실리콘·인텔)는 Homebrew 로 설치합니다:

```sh
brew install --cask runners-im/tap/monitor
```

또는 [GitHub Releases](https://github.com/RUNNERS-IM/monitor/releases/latest) 에서 받습니다. macOS 는 `Monitor-<버전>-mac-arm64.dmg`(애플 실리콘) 나 `-mac-x64.dmg`(인텔), 윈도우는 `-setup.exe`, 리눅스는 `.AppImage`·`.deb`·`.rpm` 입니다. 윈도우 설치 파일은 아직 코드 서명이 없어서 처음 열 때 SmartScreen 경고가 뜹니다.

Monitor는 메뉴 막대에만 있고 Dock 아이콘이 없습니다. 설치한 뒤 한 번 열어 주세요. 그다음부터는 로그인할 때 저절로 켜지고, 하루에 한 번 새 버전을 확인해서 설치하기 전에 물어봅니다. 둘 다 메뉴에서 끌 수 있습니다.

## 계획

끝난 것:

- 이 컴퓨터 한 대를 보는 트레이 앱: CPU, 메모리, 디스크, claude 세션, 러너 상태
- macOS 흐림 효과(윈도우는 Acrylic)를 쓴 패널, 라이트·다크 모드
- Split·Prompt 와 같은 메뉴 순서
- 20개 언어 (Split 과 같은 목록)

다음:

- 같은 패널에서 사무실의 다른 컴퓨터 목록 보기
- 서명된 배포, 자동 업데이트, macOS·윈도우·리눅스 설치 파일
- AWS EC2 서버

이슈와 풀 리퀘스트는 이 저장소에 남겨 주세요.

## 소스에서 빌드

[Rust](https://rustup.rs), Node.js 20 이상, pnpm 이 필요합니다.

```sh
pnpm install
pnpm native         # 네이티브 모듈(native/)을 이 컴퓨터용으로 빌드
pnpm dev            # 고치면 바로 다시 켜지는 개발 실행
pnpm dist           # 지금 운영체제용 설치 파일을 dist.noindex/ 에 만들기
```

애플 실리콘 맥에서 인텔 맥용을 만들려면 `rustup target add x86_64-apple-darwin` 뒤에 `pnpm native --target x86_64-apple-darwin` 도 돌립니다.

- `electron/main/` 은 메인 프로세스(트레이, 패널 창, 3초마다 재기, 업데이트), `electron/preload/` 는 화면이 메인 프로세스와 말하는 통로, `src/` 는 패널과 정보 창입니다.
- `native/` 는 하나뿐인 네이티브 모듈(napi-rs)입니다. 컴퓨터 사용량 읽기, 정리할 거리 재기, 앱 끄기, 러너 멈추기, 트레이 그림 그리기를 합니다.
- 화면 글자는 `locales/` 에 모여 있고 화면과 메인 프로세스가 같은 파일을 읽습니다. `pnpm check:locales` 로 빠진 키를 확인합니다.
- 개발 실행은 `MONITOR_OPEN=panel|about|update|update-progress`(뒤의 둘은 가짜 바뀐 점으로 업데이트 창을 띄움), `MONITOR_THEME=dark|light`, `MONITOR_DEMO=1`(스크린샷용 가짜 이름), `VITE_MONITOR_EXPAND=cpu|memory|disk|work|cleanup` 를 받습니다.

아직 macOS(애플 실리콘)에서만 빌드하고 확인했습니다. 윈도우·리눅스 판은 아직 시험해 보지 않았습니다.

## 배포

`release` 브랜치에 합치면 배포 판을 빌드해 올립니다(`.github/workflows/release.yml`). 그 전에 이번 판의 바뀐 점을
`RELEASE_NOTES.md` 에 적습니다. 이 파일이 GitHub 릴리스 본문이 되고, 업데이트 창의 "바뀐 점" 칸이 그 목록을 보여 줍니다.

```md
## 한국어

- 한 줄에 바뀐 점 하나씩, 합니다체로 씁니다.

## English

- One change per line.
```

한국어 화면은 `## 한국어` 목록을, 다른 언어는 모두 `## English` 목록을 읽습니다. 버전 올리기(`scripts/bump-release.sh`)는
두 목록 중 하나가 비었거나 지난 판의 파일과 같으면 멈춥니다.

## 개인정보

Monitor는 아무것도 모으거나 보내지 않습니다. [PRIVACY.md](PRIVACY.md) 를 보세요.

## 라이선스

Copyright (c) 2026 Runners Co., Ltd. All rights reserved. 코드는 읽어 볼 수 있게 공개했을 뿐이고, 허락 없이 복사 · 수정 · 재배포할 수 없습니다. [LICENSE.md](LICENSE.md) 를 보세요.
