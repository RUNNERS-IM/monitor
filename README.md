# Monitor

**English** · [한국어](README.ko.md)

See how busy your computers are from the menu bar or system tray: CPU, memory, disk, running claude sessions and GitHub Actions runners.

Monitor is made by RUNNERS-IM for the computers in our office. It is built with [Electron](https://www.electronjs.org) and one small native module in Rust (`native/`), the same toolchain as RUNNERS' other desktop apps, so one code base builds for macOS (Apple silicon and Intel), Windows and Linux.

## What it shows

Click the number in the menu bar (macOS) or the tray icon (Windows, Linux) to open the panel.

| Item | What it means |
|:---|:---|
| CPU | Average use of all cores |
| Memory | Memory in use and the total. The menu bar number is this value |
| Disk | Space used on the disk the system starts from (`/` on macOS and Linux, the system drive on Windows) |
| claude sessions | Number of running `claude` processes |
| GitHub runner | **Building** when a job is running, **Idle** when a runner is waiting, **None** when no runner is installed |

The panel is also Monitor's menu: under the readings are Open at login, Check for Updates Automatically, About Monitor, Check for Updates, Help & Feedback and Quit Monitor. Right-clicking the icon opens the same commands as a native menu, with a status line on top.

The panel and menu follow the language set for your computer. Monitor speaks 20 languages: Arabic, Chinese (Simplified), Chinese (Traditional), Dutch, English, Finnish, French, German, Hindi, Indonesian, Italian, Japanese, Korean, Polish, Portuguese, Russian, Spanish, Thai, Turkish and Vietnamese.

## Install

macOS (Apple silicon and Intel), with Homebrew:

```sh
brew install --cask runners-im/tap/monitor
```

Or download from [GitHub Releases](https://github.com/RUNNERS-IM/monitor/releases/latest): `Monitor-<version>-mac-arm64.dmg` (Apple silicon) or `-mac-x64.dmg` (Intel) for macOS, `-setup.exe` for Windows, `.AppImage`, `.deb` or `.rpm` for Linux. The Windows installer is not code signed yet, so Windows shows a SmartScreen warning the first time.

Monitor lives only in the menu bar (no Dock icon). Open it once after installing; from then on it opens at login and checks for a new version once a day, asking before it installs one. Both can be turned off in the menu.

## Roadmap

Done:

- Tray app for this computer: CPU, memory, disk, claude sessions and runner state
- Panel with the macOS blur (Acrylic on Windows), light and dark mode
- Shared menu order with Split and Prompt
- 20 languages (the same set as Split)

Next:

- A list of the other computers in the office in the same panel
- Signed releases, automatic updates and installers for macOS, Windows and Linux
- AWS EC2 servers

Issues and pull requests are welcome in this repository.

## Building from source

Requires [Rust](https://rustup.rs), Node.js 20 or later and pnpm.

```sh
pnpm install
pnpm native         # build the native module (native/) for this computer
pnpm dev            # run with live reload
pnpm dist           # build an installer for this OS into dist.noindex/
```

For an Intel Mac build on Apple silicon, also run `pnpm native --target x86_64-apple-darwin` (after `rustup target add x86_64-apple-darwin`).

- `electron/main/` is the main process (tray, panel window, sampling loop, updates), `electron/preload/` the bridge the page talks through, `src/` the panel and About window.
- `native/` is the one native module (napi-rs): system readings, the cleanup scan, quitting an app, pausing a runner and the tray picture.
- Screen text lives in `locales/`; the page and the main process read the same files. Check them with `pnpm check:locales`.
- Debug runs take `MONITOR_OPEN=panel|about|update|update-progress` (the last two show the update window with made-up notes), `MONITOR_THEME=dark|light`, `MONITOR_DEMO=1` (made-up names for screenshots) and `VITE_MONITOR_EXPAND=cpu|memory|disk|work|cleanup`.

So far Monitor has been built and checked on macOS (Apple silicon) only. Windows and Linux builds have not been tried yet.

## Releasing

Merging into the `release` branch builds and publishes a release (`.github/workflows/release.yml`). Before that, write
this release's changes in `RELEASE_NOTES.md`. It becomes the GitHub release text, and the update window shows its list
under "What's new":

```md
## 한국어

- 한 줄에 바뀐 점 하나씩, 합니다체로 씁니다.

## English

- One change per line.
```

Korean screens read the `## 한국어` list, every other language the `## English` one. The version bump
(`scripts/bump-release.sh`) stops when either list is empty or the file is the same as the last release's.

## Privacy

Monitor collects nothing and sends nothing. See [PRIVACY.md](PRIVACY.md).

## License

Copyright (c) 2026 Runners Co., Ltd. All rights reserved. The source is published for reading only; see [LICENSE.md](LICENSE.md).
