# Monitor Privacy Policy

Last updated: November 5, 2026

Monitor is a Mac app made by Runners Co., Ltd that shows how busy a computer is. This policy covers every version of Monitor.

## What Monitor collects

Nothing. Monitor has no account, no ads and no analytics, and it does not send anything about you or your computer to Runners or anyone else.

## What Monitor reads on your computer

Every few seconds Monitor reads CPU use, memory use and the free space on the system disk. It also reads the names of running processes, only to count `claude` processes, to see whether a GitHub Actions runner is waiting or working (and, from launchd, whether one is turned off), and to name the apps using the most. It notes which app is in front, only to avoid suggesting you quit an app you are using. It never reads what is inside a window, a file or a process. This happens only on your computer and is not stored or sent anywhere.

## Network

Monitor connects to the network for two things: updates, and **Other computers on your Tailscale network** below. A minute after it starts, and once a day after that (checked again when the Mac wakes, so a day spent asleep is not skipped), it reads
the list of releases and the update file (`latest-mac.yml`) from Monitor's GitHub
release page to see whether there is a newer version; if there is, it downloads it, then asks you, and only installs it
when you choose Install Now. Choosing Later means it does not ask again that day. The requests carry nothing about you or your computer; like any download, GitHub sees the
computer's IP address. Turning off **Check for Updates Automatically** stops the daily check. Choosing
**Check for Updates…** does the same check right away. Choosing **Help & Feedback**
opens the issue page below in your web browser.

### Other computers on your Tailscale network

This only happens when the computer runs [Tailscale](https://tailscale.com) and is connected to a tailnet. Without Tailscale Monitor does none of it.

Monitor answers on the computer's Tailscale address (port 7788) and asks the other computers of the same tailnet, every 30 seconds (every 5 seconds while the All Computers window is open), for their numbers. It answers only devices of the same tailnet, never devices shared in from another tailnet, and it reads the tailnet's device list with the `tailscale status` command to tell them apart. The answer holds the computer's name, system and Monitor version, CPU, memory and disk use, whether it is slow, the names and memory of the five apps using the most memory, how many `claude` processes and GitHub Actions runners are running, and how much could be emptied. It never holds file paths, window contents, or what a `claude` session is called or doing. Nothing goes to Runners or any server: the numbers travel only between your own computers, inside Tailscale's encrypted network, and are kept only in memory. Another computer can only read these numbers; it cannot quit apps or delete anything.

## Contact

Questions: open an issue at https://github.com/RUNNERS-IM/monitor/issues.

---

# Monitor 개인정보 처리방침

최종 수정: 2026년 11월 5일

Monitor는 Runners Co., Ltd가 만드는, 컴퓨터가 얼마나 바쁜지 보여 주는 맥 앱입니다. 이 방침은 모든 Monitor에 적용됩니다.

## 모으는 정보

없습니다. Monitor 에는 계정, 광고, 사용 통계 수집이 없고, 사용자나 컴퓨터에 관한 어떤 정보도 Runners 나 다른 곳으로 보내지 않습니다.

## 컴퓨터 안에서 읽는 정보

몇 초마다 CPU 사용률, 메모리 사용량, 시스템 디스크의 남은 공간을 읽습니다. 돌고 있는 프로세스의 이름도 읽는데, `claude` 프로세스 수를 세고, GitHub Actions 러너가 기다리는지 일하는지(그리고 launchd 에서 꺼 두었는지) 보고, 많이 쓰는 앱 이름을 보여 주려는 것뿐입니다. 맨 앞에 있는 앱이 무엇인지도 보는데, 지금 쓰는 앱을 끄라고 권하지 않으려는 것뿐입니다. 창·파일·프로세스 안의 내용은 읽지 않습니다. 이 일은 컴퓨터 안에서만 일어나고 저장하거나 보내지 않습니다.

## 인터넷 연결

Monitor가 인터넷에 접속하는 일은 업데이트, 그리고 아래 **같은 Tailscale 망의 다른 컴퓨터** 두 가지입니다. 켜진 지 1분 뒤와 그 뒤 하루에 한 번(맥이 잠자기에서 깨어날 때도 다시 따져, 잠든 날을 건너뛰지 않음) Monitor의 GitHub
릴리스 페이지에서 릴리스 목록과 업데이트 파일(`latest-mac.yml`)을 받아 새 버전이
있는지 보고, 있으면 먼저 받아 둔 뒤 물어보고 **지금 설치** 를 고를 때만 설치합니다. **나중에** 를 고르면 그날은 다시
묻지 않습니다. 이 요청에는 사용자나 컴퓨터에 관한 정보가
들어가지 않습니다. 다만 다른 내려받기와 마찬가지로 GitHub 는 컴퓨터의 IP 주소를 봅니다. **업데이트 자동 확인** 을 끄면
하루 한 번 확인을 멈춥니다. **업데이트 확인…** 을 고르면 같은 확인을 바로 합니다. **도움말·피드백** 을 고르면 아래 이슈 페이지가 웹 브라우저에서 열립니다.

### 같은 Tailscale 망의 다른 컴퓨터

컴퓨터에 [Tailscale](https://tailscale.com)이 깔려 있고 tailnet 에 연결돼 있을 때만 일어납니다. Tailscale 이 없으면 아래 일은 전혀 하지 않습니다.

Monitor 는 컴퓨터의 Tailscale 주소(포트 7788)에서 물음을 받고, 같은 tailnet 의 다른 컴퓨터에 30초마다(모든 컴퓨터 창을 열어 둔 동안은 5초마다) 숫자를 묻습니다. 같은 tailnet 기기에만 답하고, 다른 tailnet 에서 공유받은 기기에는 답하지 않습니다. 이를 가리려고 `tailscale status` 명령으로 tailnet 기기 목록을 읽습니다. 답에 들어가는 것은 컴퓨터 이름 · 운영체제 · Monitor 버전, CPU · 메모리 · 디스크 사용량, 느린지 여부, 메모리를 가장 많이 쓰는 앱 다섯 개의 이름과 크기, 돌고 있는 `claude` 프로세스와 GitHub Actions 러너 수, 비울 수 있는 크기입니다. 파일 경로 · 창 내용 · `claude` 세션의 이름이나 하는 일은 넣지 않습니다. Runners 나 어떤 서버로도 가지 않고, 사용자 자신의 컴퓨터끼리 Tailscale 의 암호화된 망 안에서만 오가며 메모리에만 둡니다. 다른 컴퓨터는 이 숫자를 읽기만 할 수 있고, 앱을 끄거나 무엇을 지울 수 없습니다.

## 문의

https://github.com/RUNNERS-IM/monitor/issues 에 글을 남겨 주세요.
