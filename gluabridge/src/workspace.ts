import * as vscode from "vscode";
import { Paths } from "./protocol";

/**
 * Mounts the autorun dump folder into the workspace so dumped server files show
 * up in the explorer without the user hunting through their home directory.
 */
export function addDumpFolder(paths: Paths): void {
    const uri = vscode.Uri.file(paths.dumps);
    const folders = vscode.workspace.workspaceFolders ?? [];

    if (folders.some((f) => f.uri.fsPath === uri.fsPath)) {
        return;
    }

    // Appending at the end avoids re-rooting a single-folder workspace, which
    // VSCode handles by restarting the extension host.
    vscode.workspace.updateWorkspaceFolders(folders.length, 0, {
        uri,
        name: "Autorun Dumps",
    });
}

export function makeStatusItem(): vscode.StatusBarItem {
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    item.command = "autorun.connect";
    item.show();
    return item;
}

export function setStatus(
    item: vscode.StatusBarItem,
    connected: boolean,
    detail?: string
): void {
    item.text = connected ? "$(zap) Autorun" : "$(debug-disconnect) Autorun";
    item.tooltip = connected
        ? `Connected to Autorun${detail ? ` (${detail})` : ""}`
        : "Autorun not connected - click to retry";
    item.command = connected ? "autorun.disconnect" : "autorun.connect";
}
