import * as vscode from "vscode";
import { AutorunClient } from "./client";
import { Event } from "./protocol";
import { config, onEvent, send } from "./session";
import { AutorunPanel } from "./panel";
import { GmodTerminal } from "./terminal";
import { addDumpFolder, makeStatusItem, setStatus } from "./workspace";

let client: AutorunClient | undefined;
let output: vscode.OutputChannel;
let status: vscode.StatusBarItem;
let pty: GmodTerminal | undefined;
let terminal: vscode.Terminal | undefined;
let panel: AutorunPanel;

/// Creates the gmod console terminal, reusing it if already open.
function showTerminal(): void {
    if (!terminal && client) {
        pty = new GmodTerminal(client, () => config().defaultRealm);
        terminal = vscode.window.createTerminal({ name: "Gmod Console", pty });
    }
    terminal?.show();
}

/// Handshake once the socket comes up: version, dump folder, console capture.
async function onConnected(): Promise<void> {
    if (!client) {
        return;
    }

    try {
        const version = await client.ping();
        setStatus(status, true, `v${version}`);
        panel.setConnected(true);
        output.appendLine(`[autorun] connected, DLL v${version}`);

        const cfg = config();
        if (cfg.autoAddDumpFolder) {
            addDumpFolder(await client.paths());
        }

        if (cfg.captureConsole) {
            await client.attachConsole(cfg.defaultRealm);
            output.appendLine(`[autorun] console capture attached (${cfg.defaultRealm})`);
        }
    } catch (why) {
        output.appendLine(`[autorun] handshake failed: ${(why as Error).message}`);
    }
}

export function activate(context: vscode.ExtensionContext): void {
    const cfg = config();

    output = vscode.window.createOutputChannel("Autorun");
    status = makeStatusItem();
    setStatus(status, false);

    client = new AutorunClient(cfg.host, cfg.port, cfg.reconnectInterval);

    client.on("log", (line: string) => output.appendLine(line));
    client.on("event", (event: Event) => onEvent(output, pty, event));
    client.on("disconnected", () => {
        setStatus(status, false);
        panel.setConnected(false);
    });
    client.on("connected", onConnected);

    panel = new AutorunPanel(() => client);

    context.subscriptions.push(
        output,
        status,
        vscode.window.registerWebviewViewProvider(AutorunPanel.viewType, panel),
        vscode.commands.registerCommand("autorun.focusPanel", () =>
            vscode.commands.executeCommand("autorun.panel.focus")
        ),
        vscode.commands.registerCommand("autorun.connect", () => client?.connect()),
        vscode.commands.registerCommand("autorun.disconnect", () => {
            client?.disconnect();
            setStatus(status, false);
        }),
        vscode.commands.registerCommand("autorun.openConsole", showTerminal),
        vscode.commands.registerCommand("autorun.attachConsole", async () => {
            await client?.attachConsole(config().defaultRealm);
        }),
        vscode.commands.registerCommand("autorun.runFile", async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                await send(client, output, editor.document, editor.document.getText());
            }
        }),
        vscode.commands.registerCommand("autorun.runSelection", async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && !editor.selection.isEmpty) {
                await send(
                    client,
                    output,
                    editor.document,
                    editor.document.getText(editor.selection)
                );
            }
        }),
        vscode.commands.registerCommand("autorun.openDumps", async () => {
            if (client?.connected) {
                addDumpFolder(await client.paths());
            }
        }),
        vscode.window.onDidCloseTerminal((closed) => {
            if (closed === terminal) {
                terminal = undefined;
                pty = undefined;
            }
        }),
        vscode.workspace.onDidSaveTextDocument(async (document) => {
            // Only lua, and only when the socket is live -- otherwise every save
            // in an unrelated project would raise a warning popup.
            if (config().runOnSave && document.languageId === "lua" && client?.connected) {
                await send(client, output, document, document.getText());
            }
        })
    );

    client.connect();

    if (cfg.openConsoleOnStart) {
        showTerminal();
    }
}

export function deactivate(): void {
    client?.disconnect();
    terminal?.dispose();
}
