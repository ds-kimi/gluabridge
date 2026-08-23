import * as vscode from "vscode";
import { AutorunClient } from "./client";
import { Realm } from "./protocol";

const PROMPT = "\r\n\x1b[36mgmod\x1b[0m> ";

/**
 * A VSCode terminal wired to the game.
 *
 * Lines are sent as console commands by default -- that is what a console
 * prompt should do -- with a `>` prefix escaping to raw lua, mirroring how
 * gmod's own `lua_run_cl` reads.
 */
export class GmodTerminal implements vscode.Pseudoterminal {
    private writeEmitter = new vscode.EventEmitter<string>();
    private closeEmitter = new vscode.EventEmitter<number>();
    private line = "";

    readonly onDidWrite = this.writeEmitter.event;
    readonly onDidClose = this.closeEmitter.event;

    constructor(private client: AutorunClient, private realm: () => Realm) {}

    open(): void {
        this.writeEmitter.fire(
            "\x1b[90mAutorun console. Lines run as console commands; prefix with > for lua.\x1b[0m"
        );
        this.writeEmitter.fire(PROMPT);
    }

    close(): void {
        this.closeEmitter.fire(0);
    }

    /// Console output arriving from the game; \n needs \r for a raw terminal.
    print(text: string): void {
        this.writeEmitter.fire(text.replace(/\r?\n/g, "\r\n"));
    }

    handleInput(data: string): void {
        for (const char of data) {
            this.handleChar(char);
        }
    }

    private handleChar(char: string): void {
        switch (char) {
            case "\r":
                this.submit();
                return;
            case "\x7f":
                if (this.line.length > 0) {
                    this.line = this.line.slice(0, -1);
                    this.writeEmitter.fire("\b \b");
                }
                return;
            case "\x03":
                this.line = "";
                this.writeEmitter.fire("^C" + PROMPT);
                return;
            default:
                // Ignore escape sequences (arrows etc) rather than echoing junk
                if (char >= " ") {
                    this.line += char;
                    this.writeEmitter.fire(char);
                }
        }
    }

    private submit(): void {
        const input = this.line.trim();
        this.line = "";

        if (!input) {
            this.writeEmitter.fire(PROMPT);
            return;
        }

        void this.dispatch(input);
    }

    private async dispatch(input: string): Promise<void> {
        try {
            if (input.startsWith(">")) {
                await this.client.run(this.realm(), input.slice(1));
            } else {
                await this.client.console(this.realm(), input);
            }
        } catch (why) {
            this.writeEmitter.fire(`\r\n\x1b[31m${(why as Error).message}\x1b[0m`);
        }
        this.writeEmitter.fire(PROMPT);
    }
}
