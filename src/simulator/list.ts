import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface Simulator {
    udid: string;
    name: string;
    state: 'Booted' | 'Shutdown' | string;
    runtime: string;
    isAvailable: boolean;
}

export interface SimulatorRuntime {
    name: string;
    identifier: string;
    version: string;
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

export async function listSimulators(): Promise<Simulator[]> {
    try {
        const { stdout } = await execAsync('xcrun simctl list devices available --json');
        const data: SimctlOutput = JSON.parse(stdout);

        const simulators: Simulator[] = [];

        for (const [runtime, devices] of Object.entries(data.devices)) {
            // Extract runtime name (e.g., "com.apple.CoreSimulator.SimRuntime.iOS-17-0" -> "iOS 17.0")
            const runtimeMatch = runtime.match(/iOS-(\d+)-(\d+)/);
            const runtimeName = runtimeMatch
                ? `iOS ${runtimeMatch[1]}.${runtimeMatch[2]}`
                : runtime;

            for (const device of devices) {
                if (device.isAvailable) {
                    simulators.push({
                        udid: device.udid,
                        name: device.name,
                        state: device.state as Simulator['state'],
                        runtime: runtimeName,
                        isAvailable: device.isAvailable
                    });
                }
            }
        }

        // Sort: Booted first, then by iOS version (newest first), then by name
        simulators.sort((a, b) => {
            if (a.state === 'Booted' && b.state !== 'Booted') return -1;
            if (a.state !== 'Booted' && b.state === 'Booted') return 1;

            // Compare iOS versions
            const versionA = a.runtime.match(/iOS (\d+)\.(\d+)/);
            const versionB = b.runtime.match(/iOS (\d+)\.(\d+)/);
            if (versionA && versionB) {
                const majorDiff = parseInt(versionB[1]) - parseInt(versionA[1]);
                if (majorDiff !== 0) return majorDiff;
                const minorDiff = parseInt(versionB[2]) - parseInt(versionA[2]);
                if (minorDiff !== 0) return minorDiff;
            }

            return a.name.localeCompare(b.name);
        });

        return simulators;
    } catch (error) {
        console.error('Failed to list simulators:', error);
        throw new Error('Failed to list simulators. Make sure Xcode is installed.');
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

export async function installApp(udid: string, appPath: string): Promise<void> {
    await execAsync(`xcrun simctl install "${udid}" "${appPath}"`);
}

export async function launchApp(udid: string, bundleId: string): Promise<void> {
    await execAsync(`xcrun simctl launch "${udid}" "${bundleId}"`);
}

export async function terminateApp(udid: string, bundleId: string): Promise<void> {
    try {
        await execAsync(`xcrun simctl terminate "${udid}" "${bundleId}"`);
    } catch {
        // Ignore errors if app is not running
    }
}
