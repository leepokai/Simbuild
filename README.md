# SimBuild - iOS Simulator Build Extension

SimBuild is a VS Code extension that builds your iOS app and installs it to the simulator with one click—no need to open Xcode.

## What it does
- Auto-detects `.xcodeproj` or `.xcworkspace` in the workspace
- Lets you pick an iOS simulator to target
- Lets you pick an Xcode scheme
- Builds for the simulator using `xcodebuild`
- Installs and launches the built app on the chosen simulator
- Shows build output in a dedicated panel

## Requirements
- macOS with Xcode installed (includes the iOS Simulator)
- Xcode command line tools available (`xcode-select -p` should resolve)
- `xcrun simctl` available (bundled with Xcode)
- Node.js 18+ (for local development/building the extension)

## Install
- From VS Code: install from a packaged VSIX, or
- Build locally: clone the repo, then run `npm install` and `npm run compile`

## Quickstart
1) Open the iOS project folder in VS Code (must contain a `.xcodeproj` or `.xcworkspace`).
2) Run the command palette (`Cmd/Ctrl+Shift+P`) and choose one:
   - `SimBuild: Build`
   - `SimBuild: Build and Run`
3) Select a scheme (first run only).
4) Select a simulator device (first run only).
5) Watch build progress in the SimBuild output panel; the app installs and launches on completion.

## Commands
- `simbuild.build` — Build the current project.
- `simbuild.run` — Build and run on a simulator.
- `simbuild.selectSimulator` — Pick a simulator device.
- `simbuild.selectScheme` — Pick a scheme.
- `simbuild.clean` — Clean build artifacts.

## Settings
Configuration keys (set in VS Code settings):
```json
{
  "simbuild.defaultSimulator": "iPhone 15 Pro",
  "simbuild.derivedDataPath": "./build",
  "simbuild.showBuildTime": true
}
```

## Development
- Install deps: `npm install`
- Compile once: `npm run compile`
- Watch mode: `npm run watch`
- Tests: `npm run test`
- Lint: `npm run lint`

## Troubleshooting
- Ensure `xcode-select -p` points to an installed Xcode.
- Ensure `xcrun simctl list devices available --json` returns devices.
- If no schemes are found, open the project in Xcode once to generate shared schemes.
