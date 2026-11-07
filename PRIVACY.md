# Monitor Privacy Policy

Last updated: November 7, 2026

Monitor is a Mac app made by Runners Co., Ltd that shows how busy a computer is. This policy covers every version of Monitor.

## What Monitor collects

Nothing, unless you sign in with a RUNNERS account (below). Monitor has no ads and no analytics. Without signing in it does not send anything about you or your computer to Runners or anyone else.

## What Monitor reads on your computer

Every few seconds Monitor reads CPU use, memory use and the free space on the system disk. It also reads the names of running processes, only to count `claude` processes, to see whether a GitHub Actions runner is waiting or working (and, from launchd, whether one is turned off), and to name the apps using the most. It notes which app is in front, only to avoid suggesting you quit an app you are using. It never reads what is inside a window, a file or a process. This happens only on your computer and is not stored or sent anywhere.

## Network

Monitor connects to the network for updates and, only when you sign in, for **Your other computers** and **Phone app** below. A minute after it starts, and once a day after that (checked again when the Mac wakes, so a day spent asleep is not skipped), it reads
the list of releases and the update file (`latest-mac.yml`) from Monitor's GitHub
release page to see whether there is a newer version; if there is, it downloads it, then asks you, and only installs it
when you choose Install Now. Choosing Later means it does not ask again that day. The requests carry nothing about you or your computer; like any download, GitHub sees the
computer's IP address. Turning off **Check for Updates Automatically** stops the daily check. Choosing
**Check for Updates…** does the same check right away. Choosing **Help & Feedback**
opens the issue page below in your web browser.

### Signing in

You sign in from the first line of Monitor's panel or from the All Computers window. Signed out, Monitor does none of what follows under **Your other computers** and **Phone app**.

Signing in, or making an account there, sends your email and your password, as typed, over an encrypted (HTTPS) connection to the RUNNERS system server (`server.system.runners.im`). To make an account, or to choose a new password after forgetting it, Monitor first sends your email and the window's language to the same server, which mails a six-digit code to that email; the code you type is then sent along with your email and password. The tokens it returns are kept on the computer, encrypted with the system keychain. The same account works in Remote, Prompt and Split. Choosing **Sign Out** from the account badge stops all of it.

### Your other computers

While signed in, Monitor stays connected to the RUNNERS system server and asks the other computers signed in with the same account, every 30 seconds (every 5 seconds while the All Computers window is open), for their numbers, and answers when they ask this one. The answer holds the computer's name, system and Monitor version, CPU, memory and disk use, whether it is slow, the names and memory of the five apps using the most memory, how many `claude` processes and GitHub Actions runners are running, how much could be emptied, the kinds of folders that could be emptied with their sizes, the GitHub Actions runners by name, and what Monitor's panel on that computer suggests doing now (an app's name, its memory and how long it has gone unused, or a kind of folder and its size). It never holds file paths, window contents, or what a `claude` session is called or doing. The server passes these between the account's computers without storing them, and Monitor keeps them only in memory. From the All Computers window, another computer signed in with the same account can also ask this one to quit one of the listed apps, empty one kind of cleanable folders, or pause a runner for an hour and start it again, exactly as the phone app can (below). It asks the person at that computer first, in its own window; this computer then does it without asking again and shows nothing about it. A computer running an older Monitor only answers the numbers. If the computer runs [Tailscale](https://tailscale.com), Monitor reads its name on the tailnet with the `tailscale status` command, only to name this computer for the others.

### Phone app

This only happens while signed in (above).

While signed in, Monitor sends, every 5 seconds, the same numbers as above plus the kinds of folders that could be emptied with their sizes and the names of GitHub Actions runners. The server passes them on only to the Monitor phone app signed in with the same account and keeps only the latest numbers, in memory, to show a phone that opens later. When the computer stays slow, Monitor also sends the slow-computer notice (its title and the names of the heaviest apps) so the server can push it to that phone.

The phone app can ask this computer to quit one of the listed apps, to empty one kind of cleanable folders, or to pause a runner for an hour and start it again. Quitting works as in Monitor's own panel: an app is asked to quit as ⌘Q would, so it can ask to save first; a development server is ended right away; terminals, editors and `claude` sessions are never offered. Only a phone or computer signed in with the same account can ask; the server marks who sent each request, and Monitor takes them only from the account's own phones and computers. If a newer Monitor connection takes over this computer's place, this one stops instead of retrying, and says so on the account line. The phone asks you before sending; the computer then does it without asking again. Choosing **Sign Out** stops all of it.

## Contact

Questions: open an issue at https://github.com/RUNNERS-IM/monitor/issues.

---

# Monitor 개인정보 처리방침

최종 수정: 2026년 11월 7일

Monitor는 Runners Co., Ltd가 만드는, 컴퓨터가 얼마나 바쁜지 보여 주는 맥 앱입니다. 이 방침은 모든 Monitor에 적용됩니다.

## 모으는 정보

RUNNERS 계정으로 로그인하지 않으면 없습니다(아래). Monitor 에는 광고와 사용 통계 수집이 없습니다. 로그인하지 않으면 사용자나 컴퓨터에 관한 어떤 정보도 Runners 나 다른 곳으로 보내지 않습니다.

## 컴퓨터 안에서 읽는 정보

몇 초마다 CPU 사용률, 메모리 사용량, 시스템 디스크의 남은 공간을 읽습니다. 돌고 있는 프로세스의 이름도 읽는데, `claude` 프로세스 수를 세고, GitHub Actions 러너가 기다리는지 일하는지(그리고 launchd 에서 꺼 두었는지) 보고, 많이 쓰는 앱 이름을 보여 주려는 것뿐입니다. 맨 앞에 있는 앱이 무엇인지도 보는데, 지금 쓰는 앱을 끄라고 권하지 않으려는 것뿐입니다. 창·파일·프로세스 안의 내용은 읽지 않습니다. 이 일은 컴퓨터 안에서만 일어나고 저장하거나 보내지 않습니다.

## 인터넷 연결

Monitor가 인터넷에 접속하는 일은 업데이트, 그리고 로그인했을 때만 아래 **내 다른 컴퓨터** 와 **휴대폰 앱** 입니다. 켜진 지 1분 뒤와 그 뒤 하루에 한 번(맥이 잠자기에서 깨어날 때도 다시 따져, 잠든 날을 건너뛰지 않음) Monitor의 GitHub
릴리스 페이지에서 릴리스 목록과 업데이트 파일(`latest-mac.yml`)을 받아 새 버전이
있는지 보고, 있으면 먼저 받아 둔 뒤 물어보고 **지금 설치** 를 고를 때만 설치합니다. **나중에** 를 고르면 그날은 다시
묻지 않습니다. 이 요청에는 사용자나 컴퓨터에 관한 정보가
들어가지 않습니다. 다만 다른 내려받기와 마찬가지로 GitHub 는 컴퓨터의 IP 주소를 봅니다. **업데이트 자동 확인** 을 끄면
하루 한 번 확인을 멈춥니다. **업데이트 확인…** 을 고르면 같은 확인을 바로 합니다. **도움말·피드백** 을 고르면 아래 이슈 페이지가 웹 브라우저에서 열립니다.

### 로그인

로그인은 Monitor 패널 맨 위 줄이나 모든 컴퓨터 창에서 합니다. 로그아웃 상태에서는 아래 **내 다른 컴퓨터** 와 **휴대폰 앱** 의 일을 전혀 하지 않습니다.

로그인하거나 그 자리에서 계정을 만들 때 이메일과 입력한 비밀번호를 암호화된 연결(HTTPS)로 RUNNERS 시스템 서버(`server.system.runners.im`)에 보냅니다. 계정을 만들거나 잊은 비밀번호를 새로 정할 때는 먼저 이메일과 창의 언어를 같은 서버에 보내고, 서버가 그 이메일로 6자리 숫자를 보냅니다. 받은 숫자는 이메일 · 비밀번호와 함께 보냅니다. 서버가 돌려준 토큰은 시스템 키체인으로 암호화해 컴퓨터에 둡니다. 같은 계정을 Remote · Prompt · Split 에서도 씁니다. 계정 동그라미에서 **로그아웃** 을 고르면 아래 일이 모두 멈춥니다.

### 내 다른 컴퓨터

로그인해 있는 동안 Monitor 는 RUNNERS 시스템 서버에 연결된 채, 같은 계정으로 로그인한 다른 컴퓨터에 30초마다(모든 컴퓨터 창을 열어 둔 동안은 5초마다) 숫자를 묻고, 그 컴퓨터들이 이 컴퓨터에 물으면 답합니다. 답에 들어가는 것은 컴퓨터 이름 · 운영체제 · Monitor 버전, CPU · 메모리 · 디스크 사용량, 느린지 여부, 메모리를 가장 많이 쓰는 앱 다섯 개의 이름과 크기, 돌고 있는 `claude` 프로세스와 GitHub Actions 러너 수, 비울 수 있는 크기, 비울 수 있는 폴더 종류와 크기, GitHub Actions 러너 이름, 그 컴퓨터의 Monitor 패널이 지금 권하는 것(앱 이름 · 메모리 · 안 쓴 시간, 또는 폴더 종류와 크기)입니다. 파일 경로 · 창 내용 · `claude` 세션의 이름이나 하는 일은 넣지 않습니다. 서버는 이것을 저장하지 않고 같은 계정의 컴퓨터 사이에 넘겨 주기만 하며, Monitor 는 메모리에만 둡니다. 같은 계정으로 로그인한 다른 컴퓨터도 모든 컴퓨터 창에서 휴대폰 앱(아래)과 똑같이, 목록의 앱 하나 끄기, 비울 수 있는 폴더 한 종류 비우기, 러너 1시간 멈추기와 다시 켜기를 이 컴퓨터에 요청할 수 있습니다. 그 컴퓨터 창에서 사용자에게 먼저 묻고, 이 컴퓨터는 다시 묻지 않고 실행하며 화면에 아무것도 띄우지 않습니다. 옛 판 Monitor 가 켜진 컴퓨터는 숫자에만 답합니다. 컴퓨터에 [Tailscale](https://tailscale.com)이 있으면 다른 컴퓨터에 보일 이 컴퓨터 이름을 정하려고 `tailscale status` 명령으로 tailnet 이름만 읽습니다.

### 휴대폰 앱

로그인해 있을 때만 일어납니다(위).

로그인해 있는 동안 Monitor 는 5초마다 위와 같은 숫자에 더해, 비울 수 있는 폴더 종류와 크기, GitHub Actions 러너 이름을 보냅니다. 서버는 이것을 같은 계정으로 로그인한 Monitor 휴대폰 앱에만 넘기고, 나중에 여는 휴대폰에 보여 주려고 마지막 숫자만 메모리에 둡니다. 컴퓨터가 계속 느리면 느려짐 알림(제목과 많이 쓰는 앱 이름)도 보내, 서버가 그 휴대폰에 푸시 알림으로 보내게 합니다.

휴대폰 앱은 이 컴퓨터에 목록의 앱 하나를 끄기, 비울 수 있는 폴더 한 종류 비우기, 러너 1시간 멈추기와 다시 켜기를 요청할 수 있습니다. 끄기는 Monitor 패널과 같습니다. 앱은 ⌘Q 처럼 끄라고 요청해 앱이 먼저 저장을 물을 수 있고, 개발 서버는 바로 끄며, 터미널 · 편집기 · `claude` 세션은 끄기 대상으로 내놓지 않습니다. 같은 계정으로 로그인한 휴대폰과 컴퓨터만 요청할 수 있습니다. 서버가 요청마다 보낸 쪽을 표시하고, Monitor 는 계정의 휴대폰과 컴퓨터가 보낸 것만 받습니다. 이 컴퓨터 자리를 더 새로운 Monitor 연결이 차지하면 이쪽은 다시 붙으려 하지 않고 멈추며, 계정 줄에 그렇다고 적습니다. 휴대폰이 보내기 전에 사용자에게 묻고, 컴퓨터는 다시 묻지 않고 실행합니다. **로그아웃** 을 고르면 이 모든 일이 멈춥니다.

## 문의

https://github.com/RUNNERS-IM/monitor/issues 에 글을 남겨 주세요.
