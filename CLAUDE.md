# SimBuild - iOS Simulator Build Extension

## Project Overview
A VS Code extension that lets developers build an iOS app and install it to the simulator with one click, without opening Xcode.

## Tech Stack
- TypeScript
- VS Code Extension API
- xcodebuild (command line)
- xcrun simctl (simulator control)

## Key Commands
```bash
# Compile project
npm run compile

# Watch mode for development
npm run watch

# Run tests
npm run test

# Lint check
npm run lint
```

## Architecture

### Core Modules
- `src/extension.ts` - Extension entry point
- `src/xcode/` - Xcode operations
  - `project.ts` - Project/workspace detection
  - `build.ts` - xcodebuild command wrapper
  - `schemes.ts` - Scheme list parsing
- `src/simulator/` - Simulator operations
  - `list.ts` - List available simulators
  - `control.ts` - Launch/install app
- `src/ui/` - UI components
  - `statusBar.ts` - Status bar button
  - `picker.ts` - Picker UI
  - `output.ts` - Output panel

### Main Features
1. **Auto-detect Xcode Project** - Detect .xcodeproj or .xcworkspace automatically
2. **Simulator Picker** - Choose target simulator
3. **Scheme Picker** - Choose build scheme
4. **One-click Build & Run** - Build and install to simulator with one click
5. **Build Output** - Show build output and errors

### xcodebuild Commands
```bash
# List all schemes
xcodebuild -list -json

# List available simulators
xcrun simctl list devices available --json

# Build for simulator
xcodebuild -workspace MyApp.xcworkspace \
  -scheme MyScheme \
  -destination 'platform=iOS Simulator,id=DEVICE_UUID' \
  -derivedDataPath ./build \
  build

# Install app to simulator
xcrun simctl install DEVICE_UUID /path/to/MyApp.app

# Launch app
xcrun simctl launch DEVICE_UUID com.example.myapp
```

## Extension Commands
- `simbuild.build` - Build current project
- `simbuild.run` - Build and run on simulator
- `simbuild.selectSimulator` - Pick simulator
- `simbuild.selectScheme` - Pick scheme
- `simbuild.clean` - Clean build artifacts

## Configuration
```json
{
  "simbuild.defaultSimulator": "iPhone 15 Pro",
  "simbuild.derivedDataPath": "./build",
  "simbuild.showBuildTime": true
}
```
