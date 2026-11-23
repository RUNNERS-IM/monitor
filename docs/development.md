# Monitor development

[README](../README.md) · [한국어](development.ko.md)

## What it shows

Click the number in the menu bar (macOS) or the tray icon (Windows, Linux) to open the panel.

| Item            | What it means                                                                                               |
| :-------------- | :---------------------------------------------------------------------------------------------------------- |
| CPU             | Average use of all cores                                                                                    |
| Memory          | Memory in use and the total. The menu bar number is this value                                              |
| Disk            | Space used on the disk the system starts from (`/` on macOS and Linux, the system drive on Windows)         |
| claude sessions | Number of running `claude` processes                                                                        |
| GitHub runner   | **Building** when a job is running, **Idle** when a runner is waiting, **None** when no runner is installed |

The panel is also Monitor's menu: a left or a right click on the icon opens it, and under the readings are Settings… (⌘,), Help & Feedback and Quit Monitor. Settings has four tabs: Computers (every computer on the account), General (Open at Login, Check for Updates Automatically, Show in menu bar, Check for Updates), Account and About. Linux trays only open a menu set beforehand, so there the same commands come as a menu.

The panel and menu follow the language set for your computer. Monitor speaks 20 languages: Arabic, Chinese (Simplified), Chinese (Traditional), Dutch, English, Finnish, French, German, Hindi, Indonesian, Italian, Japanese, Korean, Polish, Portuguese, Russian, Spanish, Thai, Turkish and Vietnamese.

## Roadmap

Done:

- Tray app for this computer: CPU, memory, disk, claude sessions and runner state
- Panel with the macOS blur (Acrylic on Windows), light and dark mode
- Shared menu order with Split and Prompt
- 20 languages (the same set as Split)
- The other computers on the same RUNNERS account (Settings › Computers), with Quit and Empty from there
- Signed macOS releases with automatic updates, and installers for macOS, Windows and Linux

Next:

- AWS EC2 servers

Issues and pull requests are welcome in this repository.

## Building from source

Requires [Rust](https://rustup.rs), Node.js 24 and pnpm.

```sh
pnpm install
pnpm native         # build the native module (native/) for this computer
pnpm dev            # run with live reload
pnpm dist           # build an installer for this OS into dist.noindex/
```

For an Intel Mac build on Apple silicon, also run `pnpm native --target x86_64-apple-darwin` (after `rustup target add x86_64-apple-darwin`).

- `src/main/` is the main process (tray, panel window, sampling loop, updates), `src/preload/` the bridge the page talks through, `src/renderer/` the panel and Settings window. Parts shared by the RUNNERS apps are copies from runners-app-kit (`src/main/runners/`, `src/renderer/runners-account/`, the root configs); `pnpm check:account` fails when a copy changed, so change them in the kit.
- `native/` is the one native module (napi-rs): system readings, the cleanup scan, quitting an app, pausing a runner and the tray picture.
- Screen text lives in `locales/`; the page and the main process read the same files. Check them with `pnpm check:locales`.
- Debug runs take `MONITOR_OPEN=panel|settings|settings:<tab>|update|update-progress` (`settings:general` picks a Settings tab; the last two show the update window with made-up notes), `MONITOR_THEME=dark|light`, `MONITOR_DEMO=1` (made-up names for screenshots), `MONITOR_TEST_HEAT=1` (acts as if macOS were slowing a hot Mac) and `VITE_MONITOR_EXPAND=cpu|memory|disk|work|cleanup`.
- Test shot mode: a debug build started with `RUNNERS_TEST_SHOTS=<folder>` captures the menu-bar panel, the Computers window, the Settings tabs, the update window and the sign-in sheet with demo numbers, never showing a window, writes `<lang>-<light|dark>-<number>-<scope>-<screen>.png` and `shots.json`, then quits. Pick with `RUNNERS_TEST_LANG=ko,en` (default) and `RUNNERS_TEST_SCOPE=menu,main,settings,popups,account`. The rules are shared by all five RUNNERS apps (runners-app-kit `desktop/README.md`, "시험 촬영 모드"). Pages load from a debug build served through `ELECTRON_RENDERER_URL`.

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
