import * as vscode from 'vscode';
import { findXcodeProjects, getSchemes, XcodeProject, Scheme, getBundleIdentifier } from './xcode/project';
import { build, stopBuild } from './xcode/build';
import { Device, listAllDevices, bootSimulator, openSimulatorApp, installApp, launchApp, startLogStream, stopLogStream, isLogStreamRunning } from './devices/manager';
import { StatusBarManager } from './ui/statusBar';

let statusBar: StatusBarManager;
let outputChannel: vscode.OutputChannel;
let logOutputChannel: vscode.OutputChannel;
let currentProject: XcodeProject | undefined;
let schemes: Scheme[] = [];
let extensionContext: vscode.ExtensionContext;
let currentBundleId: string | undefined;

// Storage keys
const STORAGE_KEY_SCHEME = 'simbuild.selectedScheme';
const STORAGE_KEY_DEVICE = 'simbuild.selectedDevice';

export async function activate(context: vscode.ExtensionContext) {
    console.log('SimBuild is now active!');

    // Save context for later use
    extensionContext = context;

    // Create output channels
    outputChannel = vscode.window.createOutputChannel('SimBuild');
    outputChannel.appendLine('SimBuild extension activated');

    logOutputChannel = vscode.window.createOutputChannel('SimBuild Log');

    // Create status bar
    statusBar = new StatusBarManager();

    // Initialize - find Xcode project
    await initialize();

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('simbuild.build', () => runBuild(false)),
        vscode.commands.registerCommand('simbuild.run', () => runBuild(true)),
        vscode.commands.registerCommand('simbuild.selectSimulator', selectDevice),
        vscode.commands.registerCommand('simbuild.selectScheme', selectScheme),
        vscode.commands.registerCommand('simbuild.clean', () => runBuild(false, true)),
        vscode.commands.registerCommand('simbuild.stop', () => {
            if (stopBuild()) {
                vscode.window.showInformationMessage('Build stopped');
                statusBar.setBuilding(false);
            }
        }),
        vscode.commands.registerCommand('simbuild.refresh', refresh),
        vscode.commands.registerCommand('simbuild.startLog', startLog),
        vscode.commands.registerCommand('simbuild.stopLog', stopLog)
    );

    // Watch for workspace changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => initialize())
    );

    context.subscriptions.push(statusBar);
    context.subscriptions.push(outputChannel);
    context.subscriptions.push(logOutputChannel);
}

async function initialize() {
    console.log('SimBuild: Initializing...');
    const projects = await findXcodeProjects();
    console.log('SimBuild: Found projects:', projects.length, projects);

    if (projects.length === 0) {
        console.log('SimBuild: No projects found, hiding status bar');
        statusBar.hide();
        return;
    }

    // Auto-select project if only one exists
    if (projects.length === 1) {
        currentProject = projects[0];
    } else {
        // Let user choose
        const items = projects.map(p => ({
            label: p.name,
            description: p.type === 'workspace' ? 'Workspace' : 'Project',
            project: p
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select Xcode project'
        });

        if (selected) {
            currentProject = selected.project;
        }
    }

    if (currentProject) {
        // Load schemes
        schemes = await getSchemes(currentProject);

        // Restore saved scheme
        const savedScheme = extensionContext.workspaceState.get<string>(STORAGE_KEY_SCHEME);
        if (savedScheme && schemes.some(s => s.name === savedScheme)) {
            statusBar.setScheme(savedScheme);
        } else {
            // Auto-select scheme if configured and only one exists
            const config = vscode.workspace.getConfiguration('simbuild');
            if (config.get('autoSelectScheme') && schemes.length === 1) {
                statusBar.setScheme(schemes[0].name);
            }
        }

        // Restore saved device
        const savedDevice = extensionContext.workspaceState.get<Device>(STORAGE_KEY_DEVICE);
        if (savedDevice) {
            statusBar.setDevice(savedDevice);
        }

        statusBar.show();
    }
}

async function selectDevice() {
    const devices = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Loading devices...',
            cancellable: false
        },
        () => listAllDevices()
    );

    if (devices.length === 0) {
        vscode.window.showWarningMessage('No devices found. Make sure Xcode is installed.');
        return;
    }

    // Group devices by type
    const simulators = devices.filter(d => d.type === 'simulator');
    const realDevices = devices.filter(d => d.type === 'device');

    interface DeviceQuickPickItem extends vscode.QuickPickItem {
        device?: Device;
    }

    const items: DeviceQuickPickItem[] = [];

    if (realDevices.length > 0) {
        items.push({ label: 'Physical Devices', kind: vscode.QuickPickItemKind.Separator });
        for (const device of realDevices) {
            items.push({
                label: `$(plug) ${device.name}`,
                description: `iOS ${device.osVersion}`,
                detail: device.state,
                device
            });
        }
    }

    if (simulators.length > 0) {
        items.push({ label: 'Simulators', kind: vscode.QuickPickItemKind.Separator });

        // Group by iOS version
        const grouped = new Map<string, Device[]>();
        for (const sim of simulators) {
            const version = `iOS ${sim.osVersion}`;
            if (!grouped.has(version)) {
                grouped.set(version, []);
            }
            grouped.get(version)!.push(sim);
        }

        for (const [version, sims] of grouped) {
            items.push({ label: version, kind: vscode.QuickPickItemKind.Separator });
            for (const sim of sims) {
                const icon = sim.state === 'Booted' ? '$(vm-running)' : '$(device-mobile)';
                items.push({
                    label: `${icon} ${sim.name}`,
                    description: sim.state === 'Booted' ? 'Running' : '',
                    device: sim
                });
            }
        }
    }

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select target device',
        matchOnDescription: true
    });

    if (selected?.device) {
        statusBar.setDevice(selected.device);
        // Save selection
        extensionContext.workspaceState.update(STORAGE_KEY_DEVICE, selected.device);
    }
}

async function selectScheme() {
    if (!currentProject) {
        vscode.window.showWarningMessage('No Xcode project found');
        return;
    }

    if (schemes.length === 0) {
        schemes = await getSchemes(currentProject);
    }

    if (schemes.length === 0) {
        vscode.window.showWarningMessage('No schemes found in project');
        return;
    }

    const items = schemes.map(s => ({
        label: s.name
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select scheme to build'
    });

    if (selected) {
        statusBar.setScheme(selected.label);
        // Save selection
        extensionContext.workspaceState.update(STORAGE_KEY_SCHEME, selected.label);
    }
}

async function refresh() {
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'SimBuild: Refreshing...',
            cancellable: false
        },
        async () => {
            // Re-scan for projects
            const projects = await findXcodeProjects();

            if (projects.length === 0) {
                vscode.window.showWarningMessage('No Xcode projects found');
                return;
            }

            // Keep current project if still exists, otherwise re-select
            if (currentProject) {
                const stillExists = projects.some(p => p.path === currentProject!.path);
                if (!stillExists) {
                    currentProject = projects.length === 1 ? projects[0] : undefined;
                }
            } else {
                currentProject = projects.length === 1 ? projects[0] : undefined;
            }

            // Reload schemes
            if (currentProject) {
                schemes = await getSchemes(currentProject);

                // Validate saved scheme still exists
                const savedScheme = statusBar.currentScheme;
                if (savedScheme && !schemes.some(s => s.name === savedScheme)) {
                    statusBar.setScheme(undefined);
                    extensionContext.workspaceState.update(STORAGE_KEY_SCHEME, undefined);
                }
            }

            vscode.window.showInformationMessage(
                `SimBuild: Found ${projects.length} project(s), ${schemes.length} scheme(s)`
            );
        }
    );
}

async function runBuild(runAfterBuild: boolean, clean = false) {
    // Validate requirements
    if (!currentProject) {
        vscode.window.showWarningMessage('No Xcode project found. Open a folder with .xcodeproj or .xcworkspace');
        return;
    }

    const scheme = statusBar.currentScheme;
    if (!scheme) {
        await selectScheme();
        if (!statusBar.currentScheme) {return;}
    }

    const device = statusBar.currentDevice;
    if (!device) {
        await selectDevice();
        if (!statusBar.currentDevice) {return;}
    }

    // Get config
    const config = vscode.workspace.getConfiguration('simbuild');
    const derivedDataPath = config.get<string>('derivedDataPath') || undefined;

    // Start build
    statusBar.setBuilding(true);

    try {
        const result = await build(
            {
                project: currentProject,
                scheme: statusBar.currentScheme!,
                device: statusBar.currentDevice!,
                derivedDataPath,
                clean
            },
            outputChannel,
            (message) => statusBar.setBuilding(true, message)
        );

        statusBar.setBuilding(false);
        statusBar.showBuildResult(result.success, result.duration);

        if (result.success) {
            if (config.get('showBuildTime')) {
                vscode.window.showInformationMessage(
                    `Build succeeded in ${(result.duration / 1000).toFixed(1)}s`
                );
            }

            // Run app if requested
            if (runAfterBuild && result.appPath) {
                await runApp(result.appPath);
            }
        } else {
            vscode.window.showErrorMessage(`Build failed: ${result.error}`);
        }
    } catch (error: any) {
        statusBar.setBuilding(false);
        vscode.window.showErrorMessage(`Build error: ${error.message}`);
    }
}

async function runApp(appPath: string) {
    const device = statusBar.currentDevice;
    if (!device) {return;}

    try {
        // Boot simulator if needed
        if (device.type === 'simulator' && device.state !== 'Booted') {
            statusBar.setBuilding(true, 'Booting simulator...');
            await bootSimulator(device.udid);
            await openSimulatorApp();
        }

        // Install app
        statusBar.setBuilding(true, 'Installing...');
        await installApp(device, appPath);

        // Get bundle ID and launch
        const bundleId = await getBundleIdentifier(
            currentProject!,
            statusBar.currentScheme!,
            appPath.replace(/\/Build\/Products\/.*/, '')
        );

        if (bundleId) {
            // Save bundle ID for log streaming
            currentBundleId = bundleId;

            // Use console mode which launches the app and captures stdout
            // Works for both simulator (simctl launch --console-pty) and device (devicectl launch --console)
            statusBar.setBuilding(true, 'Launching with console...');
            startLogStreamInternal(device, bundleId);
        }

        statusBar.setBuilding(false);
        vscode.window.showInformationMessage('App launched. Console output streaming.');

    } catch (error: any) {
        statusBar.setBuilding(false);
        vscode.window.showErrorMessage(`Failed to run app: ${error.message}`);
    }
}

function startLogStreamInternal(device: Device, bundleId: string) {
    logOutputChannel.clear();
    logOutputChannel.show(true);
    logOutputChannel.appendLine(`📱 Starting console for ${bundleId}...`);
    logOutputChannel.appendLine(`   Device: ${device.name} (${device.type})`);
    logOutputChannel.appendLine(`   Mode: stdout (print statements)`);
    logOutputChannel.appendLine('─'.repeat(60));
    logOutputChannel.appendLine('');

    const success = startLogStream({
        device,
        bundleId,
        mode: 'stdout',  // Capture print() statements
        onLog: (line) => {
            logOutputChannel.appendLine(line);
        },
        onError: (error) => {
            logOutputChannel.appendLine(`[Error] ${error}`);
        },
        onClose: () => {
            logOutputChannel.appendLine('');
            logOutputChannel.appendLine('─'.repeat(60));
            logOutputChannel.appendLine('📱 Console ended (app terminated)');
        }
    });

    if (!success) {
        logOutputChannel.appendLine('[Error] Failed to start console');
    }
}

async function startLog() {
    const device = statusBar.currentDevice;
    if (!device) {
        vscode.window.showWarningMessage('No device selected. Please select a device first.');
        return;
    }

    if (!currentBundleId) {
        vscode.window.showWarningMessage('No app has been launched yet. Run the app first.');
        return;
    }

    if (isLogStreamRunning()) {
        vscode.window.showInformationMessage('Log stream is already running.');
        logOutputChannel.show(true);
        return;
    }

    startLogStreamInternal(device, currentBundleId);
}

function stopLog() {
    if (stopLogStream()) {
        vscode.window.showInformationMessage('Log stream stopped');
    } else {
        vscode.window.showInformationMessage('No log stream is running');
    }
}

export function deactivate() {
    stopLogStream();
    statusBar?.dispose();
    outputChannel?.dispose();
    logOutputChannel?.dispose();
}
