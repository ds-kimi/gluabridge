import * as vscode from "vscode";
import { AutorunClient } from "./client";
import { Event, Realm } from "./protocol";
import { realmFor } from "./realm";
import { GmodTerminal } from "./terminal";

export interface Config {
    host: string;
    port: number;
    runOnSave: boolean;
    defaultRealm: Realm;
    autoAddDumpFolder: boolean;
    reconnectInterval: number;
    captureConsole: boolean;
    openConsoleOnStart: boolean;
}

export function config(): Config {
    const c = vscode.workspace.getConfiguration("autorun");
    return {
        host: c.get<string>("host", "127.0.0.1"),
        port: c.get<number>("port", 3005),
        runOnSave: c.get<boolean>("runOnSave", true),
        defaultRealm: c.get<Realm>("defaultRealm", "client"),
        autoAddDumpFolder: c.get<boolean>("autoAddDumpFolder", true),
        reconnectInterval: c.get<number>("reconnectInterval", 3000),
        captureConsole: c.get<boolean>("captureConsole", true),
        openConsoleOnStart: c.get<boolean>("openConsoleOnStart", true),
    };
}

export function onEvent(
    output: vscode.OutputChannel,
    terminal: GmodTerminal | undefined,
    event: Event
): void {
    switch (event.name) {
        case "console":
            // Raw game output goes to the terminal so it reads like the real
            // console; the output channel keeps only Autorun's own bookkeeping.
            terminal?.print(event.text);
            return;
        case "dump":
            output.appendLine(`[dump] ${event.path}`);
            break;
        case "run_result":
            output.appendLine(`[${event.ok ? "ok" : "error"}] ${event.message}`);
            if (!event.ok) {
                vscode.window.showErrorMessage(`Autorun: ${event.message}`);
            }
            break;
        case "connected":
            output.appendLine(`[server] joined ${event.ip}`);
            break;
    }
}

/// Ships code at the game, picking the realm from the document's own path.
export async function send(
    client: AutorunClient | undefined,
    output: vscode.OutputChannel,
    document: vscode.TextDocument,
    code: string
): Promise<void> {
    if (!client?.connected) {
        vscode.window.showWarningMessage("Autorun: not connected.");
        return;
    }

    const realm = realmFor(document.uri.fsPath, config().defaultRealm);
    try {
        await client.run(realm, code);
        output.appendLine(`[run] ${realm} <- ${document.uri.fsPath}`);
    } catch (why) {
        vscode.window.showErrorMessage(`Autorun: ${(why as Error).message}`);
    }
}
