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

메뉴 막대 숫자나 트레이 아이콘을 오른쪽 클릭하면 메뉴가 나옵니다. 상태 줄(컴퓨터 이름 · 상태), 사용량 보기, Monitor 정보, 업데이트 확인, 설정, 도움말 · 피드백, Monitor 종료 순서입니다.

패널과 메뉴는 컴퓨터에 설정된 언어를 따릅니다. 18개 언어를 지원합니다: 한국어, 영어, 일본어, 중국어(간체), 독일어, 프랑스어, 스페인어, 포르투갈어, 이탈리아어, 네덜란드어, 핀란드어, 폴란드어, 러시아어, 아랍어, 힌디어, 태국어, 베트남어, 인도네시아어.

## 설치

macOS(애플 실리콘·인텔)는 Homebrew 로 설치합니다:

```sh
brew install --cask runners-im/tap/monitor
```

또는 [GitHub Releases](https://github.com/RUNNERS-IM/monitor/releases/latest) 에서 받습니다. macOS 는 `Monitor-<버전>.dmg`, 윈도우는 `-setup.exe` 나 `.msi`, 리눅스는 `.AppImage`·`.deb`·`.rpm` 입니다. 윈도우 설치 파일은 아직 코드 서명이 없어서 처음 열 때 SmartScreen 경고가 뜹니다.

Monitor 는 메뉴 막대에만 있고 Dock 아이콘이 없습니다. 설치한 뒤 한 번 열어 주세요. 아직 로그인할 때 저절로 켜지거나 스스로 업데이트하지 않습니다.

## 계획

끝난 것:

- 이 컴퓨터 한 대를 보는 트레이 앱: CPU, 메모리, 디스크, claude 세션, 러너 상태
- macOS 흐림 효과(윈도우는 Acrylic)를 쓴 패널, 라이트·다크 모드
- Split·Prompt 와 같은 메뉴 순서
- 18개 언어 (Split 과 같은 목록)

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

Monitor 는 MIT 라이선스로 배포합니다. [LICENSE.md](LICENSE.md) 를 보세요.
