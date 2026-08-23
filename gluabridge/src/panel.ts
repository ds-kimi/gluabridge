import * as vscode from "vscode";
import { AutorunClient } from "./client";
import { HookName, Realm } from "./protocol";
import { panelHtml } from "./panelHtml";

type Incoming =
    | { type: "run"; realm: Realm; code: string }
    | { type: "load"; which: HookName }
    | { type: "save"; which: HookName; content: string }
    | { type: "ready" };

/**
 * The Autorun sidebar: a standalone lua runner plus editors for the two
 * scripthook files.
 *
 * Scratch code is executed through Autorun's own executor (the script queue),
 * not through console commands, so it runs in the lua VM with no command-length
 * limit and reports real compile errors.
 */
export class AutorunPanel implements vscode.WebviewViewProvider {
    public static readonly viewType = "autorun.panel";
    private view?: vscode.WebviewView;

    constructor(private client: () => AutorunClient | undefined) {}

    resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view;
        view.webview.options = { enableScripts: true };
        view.webview.html = panelHtml();
        view.webview.onDidReceiveMessage((msg: Incoming) => this.onMessage(msg));
    }

    /// Reflects connection state into the panel so the buttons can disable.
    setConnected(connected: boolean): void {
        void this.view?.webview.postMessage({ type: "connection", connected });
    }

    private post(message: unknown): void {
        void this.view?.webview.postMessage(message);
    }

    private async onMessage(msg: Incoming): Promise<void> {
        const client = this.client();
        if (msg.type === "ready") {
            this.setConnected(!!client?.connected);
            return;
        }

        if (!client?.connected) {
            this.post({ type: "status", ok: false, text: "Not connected to Autorun." });
            return;
        }

        try {
            await this.dispatch(client, msg);
        } catch (why) {
            this.post({ type: "status", ok: false, text: (why as Error).message });
        }
    }

    private async dispatch(client: AutorunClient, msg: Incoming): Promise<void> {
        switch (msg.type) {
            case "run":
                await client.run(msg.realm, msg.code);
                this.post({ type: "status", ok: true, text: `Sent to ${msg.realm}.` });
                return;

            case "load": {
                const hook = await client.readHook(msg.which);
                this.post({ type: "hook", ...hook });
                return;
            }

            case "save":
                await client.writeHook(msg.which, msg.content);
                this.post({
                    type: "status",
                    ok: true,
                    text:
                        msg.which === "autorun"
                            ? "Saved. Runs on your next server connect."
                            : "Saved. Runs for the next script loaded.",
                });
                return;
        }
    }
}
