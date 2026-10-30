# Monitor

**English** · [한국어](README.ko.md)

See how busy your computers are from the menu bar or system tray: CPU, memory, disk, running claude sessions and GitHub Actions runners.

Monitor is made by RUNNERS-IM for the computers in our office. It is written from scratch with [Tauri 2](https://tauri.app), so one code base builds for macOS (Apple silicon and Intel), Windows and Linux.

## What it shows

Click the number in the menu bar (macOS) or the tray icon (Windows, Linux) to open the panel.

| Item | What it means |
|:---|:---|
| CPU | Average use of all cores |
| Memory | Memory in use and the total. The menu bar number is this value |
| Disk | Space used on the disk the system starts from (`/` on macOS and Linux, the system drive on Windows) |
| claude sessions | Number of running `claude` processes |
| GitHub runner | **Building** when a job is running, **Idle** when a runner is waiting, **None** when no runner is installed |

Right-click the menu bar number or tray icon for the menu: a status line (computer name and state), Show Usage, About Monitor, Check for Updates, Settings, Help & Feedback and Quit Monitor.

The panel and menu follow the language set for your computer. Monitor speaks 18 languages: Arabic, Chinese (Simplified), Dutch, English, Finnish, French, German, Hindi, Indonesian, Italian, Japanese, Korean, Polish, Portuguese, Russian, Spanish, Thai and Vietnamese.

## Install

macOS (Apple silicon and Intel), with Homebrew:

```sh
brew install --cask runners-im/tap/monitor
```

Or download from [GitHub Releases](https://github.com/RUNNERS-IM/monitor/releases/latest): `Monitor-<version>.dmg` for macOS, `-setup.exe` or `.msi` for Windows, `.AppImage`, `.deb` or `.rpm` for Linux. The Windows installer is not code signed yet, so Windows shows a SmartScreen warning the first time.

Monitor lives only in the menu bar (no Dock icon). Open it once after installing; it does not start at login or update itself yet.

## Roadmap

Done:

- Tray app for this computer: CPU, memory, disk, claude sessions and runner state
- Panel with the macOS blur (Acrylic on Windows), light and dark mode
- Shared menu order with Split and Prompt
- 18 languages (the same set as Split)

Next:

- A list of the other computers in the office in the same panel
- Signed releases, automatic updates and installers for macOS, Windows and Linux
- AWS EC2 servers

Issues and pull requests are welcome in this repository.

## Building from source

Requires [Rust](https://rustup.rs), Node.js 20 or later and pnpm. On Linux, install the [Tauri system packages](https://tauri.app/start/prerequisites/) first.

```sh
pnpm install
pnpm tauri dev      # run with live reload
pnpm tauri build    # build an installer for this OS
```

Screen text lives in `locales/` (`en.json`, `ko.json`). The panel (`src/`) and the tray menu (`src-tauri/`) read the same files.

So far Monitor has been built and checked on macOS (Apple silicon) only. Windows and Linux builds have not been tried yet.

## Privacy

Monitor collects nothing and sends nothing. See [PRIVACY.md](PRIVACY.md).

## License

Copyright (c) 2026 Runners Co., Ltd. All rights reserved. The source is published for reading only; see [LICENSE.md](LICENSE.md).
