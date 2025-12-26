import * as vscode from 'vscode';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { XcodeProject } from './project';
import { Device } from '../devices/manager';

export interface BuildOptions {
    project: XcodeProject;
    scheme: string;
    device: Device;
    derivedDataPath?: string;
    clean?: boolean;
}

export interface BuildResult {
    success: boolean;
    appPath?: string;
    duration: number;
    error?: string;
}

let currentBuildProcess: ChildProcess | null = null;

export function stopBuild(): boolean {
    if (currentBuildProcess) {
        currentBuildProcess.kill('SIGTERM');
        currentBuildProcess = null;
        return true;
    }
    return false;
}

export async function build(
    options: BuildOptions,
    outputChannel: vscode.OutputChannel,
    onProgress?: (message: string) => void
): Promise<BuildResult> {
    const startTime = Date.now();

    const projectFlag = options.project.type === 'workspace' ? '-workspace' : '-project';

    // Build destination based on device type
    const destination = options.device.type === 'simulator'
        ? `platform=iOS Simulator,id=${options.device.udid}`
        : `platform=iOS,id=${options.device.udid}`;

    const args = [
        projectFlag, options.project.path,
        '-scheme', options.scheme,
        '-destination', destination,
        '-configuration', 'Debug',
        '-allowProvisioningUpdates', // Auto-sign for real devices
    ];

    // Only specify derivedDataPath if user configured it
    if (options.derivedDataPath) {
        args.push('-derivedDataPath', options.derivedDataPath);
    }
    // Otherwise, let xcodebuild use Xcode's default DerivedData location

    if (options.clean) {
        args.push('clean');
    }
    args.push('build');

    outputChannel.clear();
    outputChannel.show(true);
    outputChannel.appendLine(`$ xcodebuild ${args.join(' ')}\n`);
    outputChannel.appendLine('Building...\n');

    return new Promise((resolve) => {
        const process = spawn('xcodebuild', args, {
            cwd: path.dirname(options.project.path),
            env: { ...global.process.env, LANG: 'en_US.UTF-8' }
        });

        currentBuildProcess = process;

        let lastPhase = '';
        let errorOutput = '';
        let buildOutput = '';

        process.stdout?.on('data', (data: Buffer) => {
            const text = data.toString();
            outputChannel.append(text);
            buildOutput += text;

            // Extract build phases for progress updates
            const phaseMatch = text.match(/^(Compile|Link|Copy|Process|Sign|Build|Analyze|CodeSign)/m);
            if (phaseMatch && phaseMatch[0] !== lastPhase) {
                lastPhase = phaseMatch[0];
                onProgress?.(`${lastPhase}...`);
            }
        });

        process.stderr?.on('data', (data: Buffer) => {
            const text = data.toString();
            outputChannel.append(text);
            errorOutput += text;
        });

        process.on('close', (code) => {
            currentBuildProcess = null;
            const duration = Date.now() - startTime;

            if (code === 0) {
                // Find the built app path from build output
                // Look for patterns like "Touch /path/to/App.app" or "CodeSign /path/to/App.app"
                const productDir = options.device.type === 'simulator'
                    ? 'Debug-iphonesimulator'
                    : 'Debug-iphoneos';

                let appPath: string | undefined;

                // Try to find app path in build output
                const appPathMatch = buildOutput.match(
                    new RegExp(`(/[^\\s]+/${productDir}/${options.scheme}\\.app)(?:\\s|$)`, 'm')
                );

                if (appPathMatch) {
                    appPath = appPathMatch[1];
                } else if (options.derivedDataPath) {
                    // Fallback to configured derivedDataPath
                    appPath = path.join(
                        options.derivedDataPath,
                        'Build/Products',
                        productDir,
                        `${options.scheme}.app`
                    );
                } else {
                    // Fallback to Xcode default DerivedData location
                    const homeDir = global.process.env.HOME || '/Users/' + global.process.env.USER;
                    const defaultDerivedData = path.join(homeDir, 'Library/Developer/Xcode/DerivedData');

                    // Find the project's derived data folder
                    const fs = require('fs');
                    try {
                        const dirs = fs.readdirSync(defaultDerivedData);
                        const projectDir = dirs.find((d: string) =>
                            d.startsWith(options.scheme) || d.startsWith(options.project.name)
                        );
                        if (projectDir) {
                            appPath = path.join(
                                defaultDerivedData,
                                projectDir,
                                'Build/Products',
                                productDir,
                                `${options.scheme}.app`
                            );
                        }
                    } catch {
                        // Ignore errors
                    }
                }

                outputChannel.appendLine(`\n✓ Build succeeded (${(duration / 1000).toFixed(1)}s)`);
                if (appPath) {
                    outputChannel.appendLine(`  App: ${appPath}`);
                }

                resolve({
                    success: true,
                    appPath,
                    duration
                });
            } else {
                outputChannel.appendLine(`\n✗ Build failed (exit code: ${code})`);

                // Try to extract meaningful error
                const errorMatch = errorOutput.match(/error: (.+)/);

                resolve({
                    success: false,
                    duration,
                    error: errorMatch?.[1] || 'Build failed'
                });
            }
        });

        process.on('error', (err) => {
            currentBuildProcess = null;
            outputChannel.appendLine(`\n✗ Failed to start build: ${err.message}`);

            resolve({
                success: false,
                duration: Date.now() - startTime,
                error: err.message
            });
        });
    });
}
