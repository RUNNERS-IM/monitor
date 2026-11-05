// Packaging for Monitor (electron-builder), the same toolchain as Prompt but much smaller.
//
//   pnpm dist                      unsigned build for this computer, into dist.noindex/
//   MONITOR_RELEASE=1 ...          release build: hardened runtime, Developer ID signing and notarization (CI)
//   MONITOR_TAG=2.6.110502 ...     file names use the release tag instead of the in-app version (CI)
//
// Why the tag in file names: releases before 2026-11-05 had an in-app version like 2.6.1030+2, and a "+" in a
// GitHub release file name is not kept as is. Now the tag and the in-app version are the same (2.6.110502).
// The native module (native/monitor-native.<os>-<cpu>*.node) must be built for every CPU being packaged first
// (pnpm native, plus --target x86_64-apple-darwin for Intel Macs).
const isRelease = process.env.MONITOR_RELEASE === "1";
const tag = process.env.MONITOR_TAG || "${version}";

// Why: Windows keeps a file version as four numbers of at most 65535 each, so 2.6.110504 is written as
// 2.6.1105.4 there (version-parts.cjs). electron-updater compares app.getVersion() (package.json), not this.
const { versionParts } = require("./version-parts.cjs");
const { shown: shownVersion, file: buildVersion } = versionParts(require("./package.json").version);

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: "im.runners.monitor",
  productName: "Monitor",
  // Why: Windows and Linux keep the lower-case "monitor" command the Tauri build had.
  executableName: "monitor",
  buildVersion,
  copyright: "© 2026 RUNNERS. All rights reserved.",
  directories: { output: "dist.noindex", buildResources: "build" },
  // Why: React and the icons are bundled into out/renderer by vite; they stay prod dependencies only so the open
  // source notices list them, and are left out of the app's node_modules.
  files: [
    "out/**",
    "resources/menu/**",
    "package.json",
    "!**/*.map",
    "!node_modules/{react,react-dom,scheduler,lucide-react}/**",
  ],
  extraResources: [{ from: "native", to: "native", filter: ["monitor-native.${platform}-${arch}*.node"] }],
  // Why: no npm package with native code ships; the one native module is built by cargo above.
  npmRebuild: false,
  mac: {
    // Why: executableName also names the app bundle, so without this the Mac app would be "monitor.app" (electron-builder 26.15).
    // A Tauri copy restarts into Contents/MacOS/monitor after its update, which still finds "Monitor" on the
    // case-insensitive Mac disk.
    executableName: "Monitor",
    category: "public.app-category.utilities",
    icon: "build/icon.icns",
    target: [
      { target: "dmg", arch: ["arm64", "x64"] },
      { target: "zip", arch: ["arm64", "x64"] },
    ],
    artifactName: `Monitor-${tag}-mac-\${arch}.\${ext}`,
    hardenedRuntime: isRelease,
    notarize: isRelease,
    // Why: a local build is not signed with the Developer ID; it is signed ad hoc so it still opens on this Mac.
    ...(isRelease ? {} : { identity: null }),
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist",
    extendInfo: {
      // Monitor lives in the menu bar only: no Dock icon, no app menu.
      LSUIElement: true,
      CFBundleShortVersionString: shownVersion,
      NSAppleEventsUsageDescription: "Monitor asks an app to quit, like ⌘Q, when you press Quit in its panel.",
    },
  },
  dmg: { artifactName: `Monitor-${tag}-mac-\${arch}.\${ext}` },
  forceCodeSigning: isRelease,
  win: {
    icon: "build/icon.ico",
    target: [{ target: "nsis", arch: ["x64"] }],
    artifactName: `monitor-${tag}-windows-x64-setup.\${ext}`,
  },
  nsis: { oneClick: true, perMachine: false },
  linux: {
    icon: "build/icon.icns",
    category: "Utility",
    target: ["AppImage", "deb", "rpm"],
    maintainer: "RUNNERS",
    synopsis: "CPU, memory, disk, claude sessions and runners in the tray",
  },
  appImage: { artifactName: `monitor-${tag}-linux-x86_64.AppImage` },
  deb: { artifactName: `monitor-${tag}-linux-amd64.deb` },
  rpm: { artifactName: `monitor-${tag}-linux-x86_64.rpm` },
  // Read by electron-updater inside the app (app-update.yml). CI uploads the files itself (--publish never).
  publish: { provider: "github", owner: "RUNNERS-IM", repo: "monitor" },
};
