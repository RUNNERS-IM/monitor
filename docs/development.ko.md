# Monitor 개발

[README](../README.ko.md) · [English](development.md)

## 보여 주는 것

메뉴 막대의 숫자(macOS)나 트레이 아이콘(윈도우·리눅스)을 누르면 패널이 열립니다.

| 항목        | 뜻                                                                                      |
| :---------- | :-------------------------------------------------------------------------------------- |
| CPU         | 모든 코어의 평균 사용률                                                                 |
| 메모리      | 쓰고 있는 메모리와 전체 메모리. 메뉴 막대 숫자가 이 값입니다                            |
| 디스크      | 시스템이 켜지는 디스크의 사용량(macOS·리눅스는 `/`, 윈도우는 시스템 드라이브)           |
| claude 세션 | 돌고 있는 `claude` 프로세스 수                                                          |
| GitHub 러너 | 작업이 돌고 있으면 **빌드 중**, 러너가 기다리고 있으면 **대기**, 러너가 없으면 **없음** |

패널이 곧 Monitor의 메뉴입니다. 아이콘을 왼쪽 · 오른쪽 어느 쪽으로 눌러도 패널이 열리고, 사용량 아래에 설정… (⌘,), 도움말 · 피드백, Monitor 종료가 있습니다. 설정 창은 탭 네 개입니다: 컴퓨터(같은 계정의 모든 컴퓨터), 일반(로그인할 때 열기 · 업데이트 자동 확인 · 메뉴 막대에 아이콘 표시 · 업데이트 확인), 계정, 정보. 리눅스는 트레이가 미리 정한 메뉴만 열 수 있어 같은 명령이 메뉴로 나옵니다.

패널과 메뉴는 컴퓨터에 설정된 언어를 따릅니다. 20개 언어를 지원합니다: 한국어, 영어, 일본어, 중국어(간체), 중국어(번체), 독일어, 프랑스어, 스페인어, 포르투갈어, 이탈리아어, 네덜란드어, 핀란드어, 폴란드어, 러시아어, 터키어, 아랍어, 힌디어, 태국어, 베트남어, 인도네시아어.

## 계획

끝난 것:

- 이 컴퓨터 한 대를 보는 트레이 앱: CPU, 메모리, 디스크, claude 세션, 러너 상태
- macOS 흐림 효과(윈도우는 Acrylic)를 쓴 패널, 라이트·다크 모드
- Split·Prompt 와 같은 메뉴 순서
- 20개 언어 (Split 과 같은 목록)
- 같은 RUNNERS 계정의 다른 컴퓨터 보기(설정 › 컴퓨터), 거기서 앱 끄기 · 비우기
- 서명된 macOS 배포와 자동 업데이트, macOS·윈도우·리눅스 설치 파일

다음:

- AWS EC2 서버

이슈와 풀 리퀘스트는 이 저장소에 남겨 주세요.

## 소스에서 빌드

[Rust](https://rustup.rs), Node.js 24, pnpm 이 필요합니다.

```sh
pnpm install
pnpm native         # 네이티브 모듈(native/)을 이 컴퓨터용으로 빌드
pnpm dev            # 고치면 바로 다시 켜지는 개발 실행
pnpm dist           # 지금 운영체제용 설치 파일을 dist.noindex/ 에 만들기
```

애플 실리콘 맥에서 인텔 맥용을 만들려면 `rustup target add x86_64-apple-darwin` 뒤에 `pnpm native --target x86_64-apple-darwin` 도 돌립니다.

- `src/main/` 은 메인 프로세스(트레이, 패널 창, 3초마다 재기, 업데이트), `src/preload/` 는 화면이 메인 프로세스와 말하는 통로, `src/renderer/` 는 패널과 설정 창입니다. RUNNERS 앱 공통 부품은 runners-app-kit 에서 복사한 것입니다(`src/main/runners/`, `src/renderer/runners-account/`, 뿌리의 설정 파일). 복사본을 고치면 `pnpm check:account` 가 실패하므로 kit 에서 고칩니다.
- `native/` 는 하나뿐인 네이티브 모듈(napi-rs)입니다. 컴퓨터 사용량 읽기, 정리할 거리 재기, 앱 끄기, 러너 멈추기, 트레이 그림 그리기를 합니다.
- 화면 글자는 `locales/` 에 모여 있고 화면과 메인 프로세스가 같은 파일을 읽습니다. `pnpm check:locales` 로 빠진 키를 확인합니다.
- 개발 실행은 `MONITOR_OPEN=panel|settings|settings:<탭>|update|update-progress`(`settings:general` 처럼 설정 창의 탭을 고르고, 뒤의 둘은 가짜 바뀐 점으로 업데이트 창을 띄움), `MONITOR_THEME=dark|light`, `MONITOR_DEMO=1`(스크린샷용 가짜 이름), `VITE_MONITOR_EXPAND=cpu|memory|disk|work|cleanup` 를 받습니다.
- 시험 촬영 모드: 개발 빌드를 `RUNNERS_TEST_SHOTS=<폴더>` 로 켜면 창을 띄우지 않고 메뉴 막대 창 · 모든 컴퓨터 창 · 설정 탭 · 업데이트 창 · 로그인 시트를 데모 숫자로 찍어 `<언어>-<light|dark>-<번호>-<범위>-<화면>.png` 와 `shots.json` 을 쓰고 꺼집니다. `RUNNERS_TEST_LANG=ko,en`(기본), `RUNNERS_TEST_SCOPE=menu,main,settings,popups,account` 로 고릅니다. 규칙은 RUNNERS 다섯 앱 공통입니다(runners-app-kit `desktop/README.md` 「시험 촬영 모드」). 화면은 `ELECTRON_RENDERER_URL` 로 띄운 개발 빌드에서 읽습니다.

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
