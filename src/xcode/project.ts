import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const readdirAsync = promisify(fs.readdir);

export interface XcodeProject {
    path: string;
    name: string;
    type: 'workspace' | 'project';
}

export interface Scheme {
    name: string;
}

async function findXcodeProjectsInDir(dir: string): Promise<XcodeProject[]> {
    const projects: XcodeProject[] = [];

    try {
        const entries = await readdirAsync(dir, { withFileTypes: true });

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const fullPath = path.join(dir, entry.name);

            // Skip node_modules, Pods, etc.
            if (entry.name === 'node_modules' || entry.name === 'Pods' || entry.name.startsWith('.')) {
                continue;
            }

            if (entry.name.endsWith('.xcworkspace')) {
                // Skip workspaces inside .xcodeproj
                if (!dir.endsWith('.xcodeproj')) {
                    projects.push({
                        path: fullPath,
                        name: path.basename(entry.name, '.xcworkspace'),
                        type: 'workspace'
                    });
                }
            } else if (entry.name.endsWith('.xcodeproj')) {
                projects.push({
                    path: fullPath,
                    name: path.basename(entry.name, '.xcodeproj'),
                    type: 'project'
                });
            } else {
                // Recurse into subdirectories (max 3 levels deep)
                const depth = dir.split(path.sep).length;
                const rootDepth = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath.split(path.sep).length || 0;
                if (depth - rootDepth < 3) {
                    const subProjects = await findXcodeProjectsInDir(fullPath);
                    projects.push(...subProjects);
                }
            }
        }
    } catch (error) {
        console.error('Error reading directory:', dir, error);
    }

    return projects;
}

export async function findXcodeProjects(): Promise<XcodeProject[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        return [];
    }

    let allProjects: XcodeProject[] = [];

    for (const folder of workspaceFolders) {
        const projects = await findXcodeProjectsInDir(folder.uri.fsPath);
        allProjects.push(...projects);
    }

    // If both workspace and project with same name exist, prefer workspace
    const filtered: XcodeProject[] = [];
    for (const proj of allProjects) {
        if (proj.type === 'project') {
            const hasWorkspace = allProjects.some(p => p.name === proj.name && p.type === 'workspace');
            if (!hasWorkspace) {
                filtered.push(proj);
            }
        } else {
            filtered.push(proj);
        }
    }

    return filtered;
}

export async function getSchemes(project: XcodeProject): Promise<Scheme[]> {
    const flag = project.type === 'workspace' ? '-workspace' : '-project';

    try {
        const { stdout } = await execAsync(
            `xcodebuild ${flag} "${project.path}" -list -json`,
            { timeout: 30000 }
        );

        const data = JSON.parse(stdout);
        const schemeNames: string[] = project.type === 'workspace'
            ? data.workspace?.schemes || []
            : data.project?.schemes || [];

        return schemeNames.map(name => ({ name }));
    } catch (error) {
        console.error('Failed to get schemes:', error);
        return [];
    }
}

export async function getBundleIdentifier(
    project: XcodeProject,
    scheme: string,
    derivedDataPath: string
): Promise<string | undefined> {
    // Look for Info.plist in the build products
    const appPath = path.join(
        derivedDataPath,
        'Build/Products/Debug-iphonesimulator',
        `${scheme}.app`
    );

    try {
        const { stdout } = await execAsync(
            `defaults read "${appPath}/Info.plist" CFBundleIdentifier`
        );
        return stdout.trim();
    } catch {
        // Try to extract from project file
        return undefined;
    }
}
