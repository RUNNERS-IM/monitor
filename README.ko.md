<p align="center">
  <img src="https://runners.im/images/apps/monitor/icon.webp" width="96" alt="Monitor">
</p>
<h1 align="center">Monitor</h1>
<p align="center"><b>왜 느려졌는지 메뉴 막대에서.</b><br>CPU · 메모리 · 디스크를 누가 얼마나 쓰는지 보고, 그 자리에서 끄고 비웁니다.</p>
<p align="center">
  <a href="https://runners.im/monitor"><b>Mac 용 받기</b></a> ·
  <a href="https://runners.im/monitor">runners.im/monitor</a> ·
  <a href="README.md">English</a>
</p>
<p align="center"><sub>무료 · macOS 12 이상 · Apple silicon · Intel · Windows · Linux · 20개 언어</sub></p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://runners.im/images/apps/monitor/stage-ko-dark.webp">
  <img src="https://runners.im/images/apps/monitor/stage-ko-light.webp" alt="메뉴 막대 아래 열린 Monitor 패널: 메모리 줄을 펼쳐 앱 · claude 세션 · 시스템 · 캐시로 나눈 색 막대와 목록">
</picture>

## 하는 일

<table>
<tr>
<td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="https://runners.im/images/apps/monitor/expand-ko-dark.webp"><img src="https://runners.im/images/apps/monitor/expand-ko-light.webp" alt="CPU 줄과 디스크 줄을 펼친 패널 두 개"></picture><br><b>누르면 무엇이 얼마나 차 있는지</b><br>CPU · 메모리 · 디스크 줄을 펼치면 색을 나눈 막대와 목록이 나옵니다. 앱 · claude 세션 · 시스템 · 캐시 · 압축 · 스왑까지 나눠 봅니다.</td>
<td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="https://runners.im/images/apps/monitor/quit-ko-dark.webp"><img src="https://runners.im/images/apps/monitor/quit-ko-light.webp" alt="무거운 앱 옆의 끄기 단추"></picture><br><b>무거운 앱은 그 자리에서 끄기</b><br>‘끄기’는 ⌘Q 와 같아서 저장하지 않은 작업이 있으면 앱이 먼저 묻습니다. 오래 켜 둔 개발 서버는 바로 끕니다.</td>
</tr>
<tr>
<td><picture><source media="(prefers-color-scheme: dark)" srcset="https://runners.im/images/apps/monitor/empty-ko-dark.webp"><img src="https://runners.im/images/apps/monitor/empty-ko-light.webp" alt="디스크 줄을 펼친 모습과 비우기 단추"></picture><br><b>꽉 찬 디스크, 단추 하나로 비우기</b><br>캐시 · 빌드 폴더 · node_modules · 휴지통 · 안 쓰는 Docker 이미지를 종류별로 잽니다. 최근 7일 안에 쓴 프로젝트는 남깁니다.</td>
<td><picture><source media="(prefers-color-scheme: dark)" srcset="https://runners.im/images/apps/monitor/popup-ko-dark.webp"><img src="https://runners.im/images/apps/monitor/popup-ko-light.webp" alt="메모리가 모자랄 때의 패널"></picture><br><b>느려지면 색과 알림으로</b><br>괜찮으면 초록, 느리면 주황, 메모리가 아주 모자라면 빨강이 되고, 이유마다 하루 한 번 알림을 보냅니다.</td>
</tr>
<tr>
<td><picture><source media="(prefers-color-scheme: dark)" srcset="https://runners.im/images/apps/monitor/sessions-ko-dark.webp"><img src="https://runners.im/images/apps/monitor/sessions-ko-light.webp" alt="claude 세션과 GitHub 러너의 상태"></picture><br><b>claude 세션과 GitHub 러너도 한눈에</b><br>돌고 있는 claude 세션이 몇 개인지 얼마나 돌았는지, 이 컴퓨터의 러너가 빌드 중 · 대기 · 멈춤인지 보여 줍니다.</td>
<td><picture><source media="(prefers-color-scheme: dark)" srcset="https://runners.im/images/apps/monitor/menubar-ko-dark.webp"><img src="https://runners.im/images/apps/monitor/menubar-ko-light.webp" alt="메뉴 막대의 Monitor 아이콘과 메모리 사용률"></picture><br><b>늘 메뉴 막대에</b><br>막대 셋과 메모리 사용률이 메뉴 막대에 있고, 누르면 패널이 열립니다. RUNNERS 계정으로 로그인하면 설정 › 컴퓨터에서 다른 컴퓨터도 봅니다.</td>
</tr>
</table>

## 설치

```sh
brew install --cask runners-im/tap/monitor
```

또는 [Releases](https://github.com/RUNNERS-IM/monitor/releases/latest) 에서 `Monitor-<버전>-mac-arm64.dmg`(Apple silicon) 나 `-mac-x64.dmg`(Intel) 를 받습니다. 윈도우(`-setup.exe`, 아직 코드 서명 없음)와 리눅스(`.AppImage` · `.deb` · `.rpm`) 판도 같은 곳에 있습니다.

Monitor 는 Dock 아이콘 없이 메뉴 막대에만 있습니다. 한 번 열어 두면 그다음부터 로그인할 때 저절로 켜지고, 하루에 한 번 새 버전을 확인합니다. 둘 다 설정 › 일반에서 끌 수 있습니다.

## 단축키

| 단축키 | 하는 일            |
| :----- | :----------------- |
| ⌘,     | 패널에서 설정 열기 |

## 개인정보

Monitor 에는 광고와 사용 통계 수집이 없습니다. 오류를 고치려고 이름 · 주소를 가린 오류 보고를 보냅니다. [PRIVACY.md](PRIVACY.md) 를 보세요.

## 개발

[docs/development.ko.md](docs/development.ko.md) 를 보세요.

---

<p align="center"><a href="https://runners.im"><picture><source media="(prefers-color-scheme: dark)" srcset="https://runners.im/icons/logos/RUNNERS_H_W.svg"><img src="https://runners.im/icons/logos/RUNNERS_H.svg" height="20" alt="RUNNERS"></picture></a><br><sub>RUNNERS 가 만듭니다 · 코드는 읽기용 공개, 모든 권리 보유(<a href="LICENSE.md">LICENSE.md</a>)</sub></p>
