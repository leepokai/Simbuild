import * as vscode from 'vscode';
import { Device } from '../devices/manager';

export class StatusBarManager {
    private buildButton: vscode.StatusBarItem;
    private schemeButton: vscode.StatusBarItem;
    private deviceButton: vscode.StatusBarItem;
    private stopButton: vscode.StatusBarItem;

    private _currentScheme: string | undefined;
    private _currentDevice: Device | undefined;
    private _isBuilding = false;

    constructor() {
        // Build & Run button (leftmost)
        this.buildButton = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
        this.buildButton.command = 'simbuild.run';
        this.buildButton.tooltip = 'Build & Run (SimBuild)';

        // Scheme selector
        this.schemeButton = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            99
        );
        this.schemeButton.command = 'simbuild.selectScheme';
        this.schemeButton.tooltip = 'Select Scheme';

        // Device selector
        this.deviceButton = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            98
        );
        this.deviceButton.command = 'simbuild.selectSimulator';
        this.deviceButton.tooltip = 'Select Device';

        // Stop button (hidden by default)
        this.stopButton = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            97
        );
        this.stopButton.command = 'simbuild.stop';
        this.stopButton.text = '$(debug-stop) Stop';
        this.stopButton.tooltip = 'Stop Build';
        this.stopButton.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');

        this.updateUI();
    }

    get currentScheme(): string | undefined {
        return this._currentScheme;
    }

    get currentDevice(): Device | undefined {
        return this._currentDevice;
    }

    setScheme(scheme: string | undefined) {
        this._currentScheme = scheme;
        this.updateUI();
    }

    setDevice(device: Device | undefined) {
        this._currentDevice = device;
        this.updateUI();
    }

    setBuilding(building: boolean, message?: string) {
        this._isBuilding = building;
        this.updateUI(message);
    }

    show() {
        this.buildButton.show();
        this.schemeButton.show();
        this.deviceButton.show();
    }

    hide() {
        this.buildButton.hide();
        this.schemeButton.hide();
        this.deviceButton.hide();
        this.stopButton.hide();
    }

    private updateUI(buildMessage?: string) {
        if (this._isBuilding) {
            this.buildButton.text = `$(sync~spin) ${buildMessage || 'Building...'}`;
            this.buildButton.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            this.stopButton.show();
        } else {
            this.buildButton.text = '$(play) Build & Run';
            this.buildButton.backgroundColor = undefined;
            this.stopButton.hide();
        }

        // Scheme button
        if (this._currentScheme) {
            this.schemeButton.text = `$(package) ${this._currentScheme}`;
        } else {
            this.schemeButton.text = '$(package) Select Scheme';
        }

        // Device button
        if (this._currentDevice) {
            const icon = this._currentDevice.type === 'simulator' ? '$(device-mobile)' : '$(plug)';
            const state = this._currentDevice.state === 'Booted' ? ' (Running)' : '';
            this.deviceButton.text = `${icon} ${this._currentDevice.name}${state}`;
        } else {
            this.deviceButton.text = '$(device-mobile) Select Device';
        }
    }

    showBuildResult(success: boolean, duration: number) {
        const durationStr = (duration / 1000).toFixed(1);
        if (success) {
            this.buildButton.text = `$(check) Built (${durationStr}s)`;
            this.buildButton.backgroundColor = undefined;
        } else {
            this.buildButton.text = `$(error) Failed`;
            this.buildButton.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        }

        // Reset after 5 seconds
        setTimeout(() => {
            if (!this._isBuilding) {
                this.buildButton.text = '$(play) Build & Run';
                this.buildButton.backgroundColor = undefined;
            }
        }, 5000);
    }

    dispose() {
        this.buildButton.dispose();
        this.schemeButton.dispose();
        this.deviceButton.dispose();
        this.stopButton.dispose();
    }
}
