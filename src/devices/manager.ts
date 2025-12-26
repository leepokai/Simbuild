import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

let logProcess: ChildProcess | null = null;
let logProcessId: number = 0; // Used to track which process the callbacks belong to

export type DeviceType = 'simulator' | 'device';

export interface Device {
    udid: string;
    name: string;
    type: DeviceType;
    state: string;
    platform: string;
    osVersion: string;
    isAvailable: boolean;
}

interface SimctlDevice {
    udid: string;
    name: string;
    state: string;
    isAvailable: boolean;
}

interface SimctlOutput {
    devices: { [runtime: string]: SimctlDevice[] };
}

export async function listAllDevices(): Promise<Device[]> {
    const devices: Device[] = [];

    // Get simulators
    const simulators = await listSimulators();
    devices.push(...simulators);

    // Get real devices
    const realDevices = await listRealDevices();
    devices.push(...realDevices);

    return devices;
}

async function listSimulators(): Promise<Device[]> {
    try {
        const { stdout } = await execAsync('xcrun simctl list devices available --json');
        const data: SimctlOutput = JSON.parse(stdout);

        const devices: Device[] = [];

        for (const [runtime, simDevices] of Object.entries(data.devices)) {
            // Extract runtime name (e.g., "com.apple.CoreSimulator.SimRuntime.iOS-17-0" -> "iOS 17.0")
            const runtimeMatch = runtime.match(/iOS-(\d+)-(\d+)/);
            const osVersion = runtimeMatch
                ? `${runtimeMatch[1]}.${runtimeMatch[2]}`
                : 'Unknown';

            for (const device of simDevices) {
                if (device.isAvailable) {
                    devices.push({
                        udid: device.udid,
                        name: device.name,
                        type: 'simulator',
                        state: device.state,
                        platform: 'iOS Simulator',
                        osVersion,
                        isAvailable: device.isAvailable
                    });
                }
            }
        }

        return devices;
    } catch (error) {
        console.error('Failed to list simulators:', error);
        return [];
    }
}

async function listRealDevices(): Promise<Device[]> {
    try {
        // Use xcrun devicectl for iOS 17+ devices
        const devices = await listDevicesWithDevicectl();
        if (devices.length > 0) {
            return devices;
        }

        // Fallback to instruments for older devices
        return await listDevicesWithInstruments();
    } catch {
        return [];
    }
}

async function listDevicesWithDevicectl(): Promise<Device[]> {
    try {
        const { stdout } = await execAsync('xcrun devicectl list devices --json-output /dev/stdout 2>/dev/null');
        const data = JSON.parse(stdout);

        const devices: Device[] = [];

        for (const device of data.result?.devices || []) {
            if (device.connectionProperties?.transportType === 'wired' ||
                device.connectionProperties?.transportType === 'network') {
                devices.push({
                    udid: device.hardwareProperties?.udid || device.identifier,
                    name: device.deviceProperties?.name || 'Unknown Device',
                    type: 'device',
                    state: device.connectionProperties?.transportType === 'wired' ? 'Connected' : 'Network',
                    platform: 'iOS',
                    osVersion: device.deviceProperties?.osVersionNumber || 'Unknown',
                    isAvailable: true
                });
            }
        }

        return devices;
    } catch {
        return [];
    }
}

async function listDevicesWithInstruments(): Promise<Device[]> {
    try {
        const { stdout } = await execAsync('xcrun xctrace list devices 2>/dev/null');
        const lines = stdout.split('\n');
        const devices: Device[] = [];

        for (const line of lines) {
            // Match pattern: "Device Name (OS Version) (UDID)"
            const match = line.match(/^(.+?)\s+\((\d+\.\d+(?:\.\d+)?)\)\s+\(([A-F0-9-]+)\)$/i);
            if (match && !line.toLowerCase().includes('simulator')) {
                devices.push({
                    udid: match[3],
                    name: match[1].trim(),
                    type: 'device',
                    state: 'Connected',
                    platform: 'iOS',
                    osVersion: match[2],
                    isAvailable: true
                });
            }
        }

        return devices;
    } catch {
        return [];
    }
}

export async function bootSimulator(udid: string): Promise<void> {
    try {
        await execAsync(`xcrun simctl boot "${udid}"`);
    } catch (error: any) {
        // Ignore "already booted" error
        if (!error.message?.includes('Unable to boot device in current state: Booted')) {
            throw error;
        }
    }
}

export async function openSimulatorApp(): Promise<void> {
    await execAsync('open -a Simulator');
}

export async function installApp(device: Device, appPath: string): Promise<void> {
    if (device.type === 'simulator') {
        await execAsync(`xcrun simctl install "${device.udid}" "${appPath}"`);
    } else {
        // Use devicectl for real devices (iOS 17+)
        try {
            await execAsync(`xcrun devicectl device install app -d "${device.udid}" "${appPath}"`);
        } catch {
            // Fallback to ios-deploy if available
            await execAsync(`ios-deploy --id "${device.udid}" --bundle "${appPath}"`);
        }
    }
}

export async function launchApp(device: Device, bundleId: string): Promise<void> {
    if (device.type === 'simulator') {
        await execAsync(`xcrun simctl launch "${device.udid}" "${bundleId}"`);
    } else {
        // Use devicectl for real devices
        try {
            await execAsync(`xcrun devicectl device process launch -d "${device.udid}" "${bundleId}"`);
        } catch {
            // Fallback to ios-deploy
            await execAsync(`ios-deploy --id "${device.udid}" --bundle-id "${bundleId}" --justlaunch`);
        }
    }
}

export async function terminateApp(device: Device, bundleId: string): Promise<void> {
    try {
        if (device.type === 'simulator') {
            await execAsync(`xcrun simctl terminate "${device.udid}" "${bundleId}"`);
        }
        // For real devices, termination is handled differently
    } catch {
        // Ignore errors if app is not running
    }
}

export type LogMode = 'stdout' | 'system' | 'both';

export interface LogStreamOptions {
    device: Device;
    bundleId: string;
    mode?: LogMode;
    onLog: (line: string) => void;
    onError: (error: string) => void;
    onClose: () => void;
}

let stdoutLogProcess: ChildProcess | null = null;

export function startLogStream(options: LogStreamOptions): boolean {
    // Stop any existing log stream
    stopLogStream();

    const { device, bundleId, onLog, onError, onClose, mode = 'stdout' } = options;

    // Increment process ID to track this specific process
    const currentProcessId = ++logProcessId;

    if (device.type === 'simulator') {
        if (mode === 'stdout' || mode === 'both') {
            // Use simctl launch --console to capture stdout/stderr (print statements)
            stdoutLogProcess = spawn('xcrun', [
                'simctl', 'launch', '--console-pty', '--terminate-running-process',
                device.udid, bundleId
            ]);

            stdoutLogProcess.stdout?.on('data', (data: Buffer) => {
                if (currentProcessId !== logProcessId) return;
                const lines = data.toString().split('\n');
                for (const line of lines) {
                    if (line.trim()) {
                        onLog(line);
                    }
                }
            });

            stdoutLogProcess.stderr?.on('data', (data: Buffer) => {
                if (currentProcessId !== logProcessId) return;
                const lines = data.toString().split('\n');
                for (const line of lines) {
                    if (line.trim()) {
                        onLog(`[stderr] ${line}`);
                    }
                }
            });

            stdoutLogProcess.on('close', () => {
                if (currentProcessId !== logProcessId) return;
                stdoutLogProcess = null;
                if (mode === 'stdout') {
                    onClose();
                }
            });

            stdoutLogProcess.on('error', (err) => {
                if (currentProcessId !== logProcessId) return;
                onError(err.message);
            });

            // If only stdout mode, we're done
            if (mode === 'stdout') {
                logProcess = stdoutLogProcess;
                return true;
            }
        }

        if (mode === 'system' || mode === 'both') {
            // Use log stream for system logs (os_log, NSLog)
            const processName = bundleId.split('.').pop() || bundleId;

            logProcess = spawn('xcrun', [
                'simctl', 'spawn', device.udid,
                'log', 'stream',
                '--level', 'debug',
                '--style', 'compact',
                '--predicate', `processImagePath contains "${processName}" OR subsystem contains "${bundleId}"`
            ]);
        }
    } else {
        // For real devices, use devicectl with --console to capture stdout
        if (mode === 'stdout' || mode === 'both') {
            logProcess = spawn('xcrun', [
                'devicectl', 'device', 'process', 'launch',
                '-d', device.udid,
                '--console',
                '--terminate-existing',
                bundleId
            ]);
        } else {
            // System log mode - use idevicesyslog if available
            logProcess = spawn('idevicesyslog', ['-u', device.udid]);
        }
    }

    if (!logProcess) {
        return false;
    }

    logProcess.stdout?.on('data', (data: Buffer) => {
        // Only process if this is still the current log process
        if (currentProcessId !== logProcessId) return;

        const lines = data.toString().split('\n');
        for (const line of lines) {
            if (line.trim()) {
                onLog(line);
            }
        }
    });

    logProcess.stderr?.on('data', (data: Buffer) => {
        // Only process if this is still the current log process
        if (currentProcessId !== logProcessId) return;
        onError(data.toString());
    });

    logProcess.on('close', () => {
        // Only update state if this is still the current log process
        if (currentProcessId !== logProcessId) return;
        logProcess = null;
        onClose();
    });

    logProcess.on('error', (err) => {
        // Only update state if this is still the current log process
        if (currentProcessId !== logProcessId) return;
        onError(err.message);
        logProcess = null;
    });

    return true;
}

export function stopLogStream(): boolean {
    let stopped = false;

    if (stdoutLogProcess) {
        stdoutLogProcess.kill('SIGTERM');
        stdoutLogProcess = null;
        stopped = true;
    }

    if (logProcess) {
        logProcess.kill('SIGTERM');
        logProcess = null;
        stopped = true;
    }

    return stopped;
}

export function isLogStreamRunning(): boolean {
    return logProcess !== null || stdoutLogProcess !== null;
}
