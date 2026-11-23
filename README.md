<p align="center">
  <img src="https://runners.im/images/apps/monitor/icon.webp" width="96" alt="Monitor">
</p>
<h1 align="center">Monitor</h1>
<p align="center"><b>Why it's slow, right in the menu bar.</b><br>See who is using your CPU, memory and disk, then quit or clean up right there.</p>
<p align="center">
  <a href="https://runners.im/en/monitor"><b>Download for Mac</b></a> ·
  <a href="https://runners.im/en/monitor">runners.im/en/monitor</a> ·
  <a href="README.ko.md">한국어</a>
</p>
<p align="center"><sub>Free · macOS 12 or later · Apple silicon · Intel · Windows · Linux · 20 languages</sub></p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://runners.im/images/apps/monitor/stage-en-dark.webp">
  <img src="https://runners.im/images/apps/monitor/stage-en-light.webp" alt="The Monitor panel below the menu bar, with the memory row open: a colored bar and list of apps, claude sessions, system and cache">
</picture>

## What it does

<table>
<tr>
<td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="https://runners.im/images/apps/monitor/expand-en-dark.webp"><img src="https://runners.im/images/apps/monitor/expand-en-light.webp" alt="Two panels with the CPU and disk rows open"></picture><br><b>See what fills it, at a glance</b><br>Open the CPU, memory or disk row for a bar split by colour and a list: apps, claude sessions, system, cache, compression and swap.</td>
<td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="https://runners.im/images/apps/monitor/quit-en-dark.webp"><img src="https://runners.im/images/apps/monitor/quit-en-light.webp" alt="Quit buttons next to heavy apps"></picture><br><b>Quit a heavy app right there</b><br>Quit works like ⌘Q, so an app with unsaved work asks first. Dev servers left running stop right away.</td>
</tr>
<tr>
<td><picture><source media="(prefers-color-scheme: dark)" srcset="https://runners.im/images/apps/monitor/empty-en-dark.webp"><img src="https://runners.im/images/apps/monitor/empty-en-light.webp" alt="The disk row open with Empty buttons"></picture><br><b>A full disk, emptied with one button</b><br>Caches, build folders, node_modules, the Trash and unused Docker images, measured by kind. Projects used in the last 7 days are kept.</td>
<td><picture><source media="(prefers-color-scheme: dark)" srcset="https://runners.im/images/apps/monitor/popup-en-dark.webp"><img src="https://runners.im/images/apps/monitor/popup-en-light.webp" alt="The panel when memory is short"></picture><br><b>Colour and alerts when it slows down</b><br>Green when all is well, orange when slow, red when memory is very short, with one alert a day per reason.</td>
</tr>
<tr>
<td><picture><source media="(prefers-color-scheme: dark)" srcset="https://runners.im/images/apps/monitor/sessions-en-dark.webp"><img src="https://runners.im/images/apps/monitor/sessions-en-light.webp" alt="Status of claude sessions and GitHub runners"></picture><br><b>claude sessions and GitHub runners</b><br>How many claude sessions are running and for how long, and whether this computer's runner is building, waiting or paused.</td>
<td><picture><source media="(prefers-color-scheme: dark)" srcset="https://runners.im/images/apps/monitor/menubar-en-dark.webp"><img src="https://runners.im/images/apps/monitor/menubar-en-light.webp" alt="The Monitor icon and memory use in the menu bar"></picture><br><b>Always in the menu bar</b><br>Three bars and your memory use sit in the menu bar; click for the panel. Signed in with a RUNNERS account, Settings › Computers shows your other computers too.</td>
</tr>
</table>

## Install

```sh
brew install --cask runners-im/tap/monitor
```

Or download the latest `Monitor-<version>-mac-arm64.dmg` (Apple silicon) or `-mac-x64.dmg` (Intel) from [Releases](https://github.com/RUNNERS-IM/monitor/releases/latest). Windows (`-setup.exe`, not code-signed yet) and Linux (`.AppImage` · `.deb` · `.rpm`) builds are on the same page.

Monitor lives in the menu bar only, with no Dock icon. Open it once; after that it starts at login and checks for updates once a day. Both can be turned off in Settings › General.

## Shortcuts

| Shortcut | What it does                 |
| :------- | :--------------------------- |
| ⌘,       | Open Settings from the panel |

## Privacy

Monitor has no ads and no analytics. It sends error reports, with names and addresses hidden, so errors can be fixed. See [PRIVACY.md](PRIVACY.md).

## Development

See [docs/development.md](docs/development.md).

---

<p align="center"><a href="https://runners.im"><picture><source media="(prefers-color-scheme: dark)" srcset="https://runners.im/icons/logos/RUNNERS_H_W.svg"><img src="https://runners.im/icons/logos/RUNNERS_H.svg" height="20" alt="RUNNERS"></picture></a><br><sub>Made by RUNNERS · Source available, all rights reserved (<a href="LICENSE.md">LICENSE.md</a>)</sub></p>
