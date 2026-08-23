import * as net from "net";
import { EventEmitter } from "events";
import { Event, Hook, HookName, Paths, Realm, Request, Response } from "./protocol";

interface Pending {
    resolve: (value: Response) => void;
    reject: (why: Error) => void;
    timer: NodeJS.Timeout;
}

/// How long a request waits before we assume the game hung or died.
const REQUEST_TIMEOUT_MS = 5000;

/**
 * Line-delimited JSON client for the injected Autorun DLL.
 *
 * Emits: "connected", "disconnected", "event" (Event), "log" (string).
 */
export class AutorunClient extends EventEmitter {
    private socket?: net.Socket;
    private buffer = "";
    private nextId = 1;
    private pending = new Map<number, Pending>();
    private reconnectTimer?: NodeJS.Timeout;
    private wantConnection = false;

    constructor(
        private host: string,
        private port: number,
        private reconnectInterval: number
    ) {
        super();
    }

    get connected(): boolean {
        return !!this.socket && !this.socket.destroyed;
    }

    connect(): void {
        this.wantConnection = true;
        if (this.connected) {
            return;
        }

        const socket = net.createConnection({ host: this.host, port: this.port });
        this.socket = socket;

        socket.setEncoding("utf8");
        socket.on("connect", () => this.emit("connected"));
        socket.on("data", (chunk: string) => this.onData(chunk));
        socket.on("error", (why) => this.emit("log", `socket error: ${why.message}`));
        socket.on("close", () => this.onClose());
    }

    disconnect(): void {
        this.wantConnection = false;
        this.clearReconnect();
        this.socket?.destroy();
        this.socket = undefined;
    }

    private onClose(): void {
        this.socket = undefined;
        this.buffer = "";
        this.failPending(new Error("disconnected"));
        this.emit("disconnected");

        if (this.wantConnection && this.reconnectInterval > 0 && !this.reconnectTimer) {
            this.reconnectTimer = setTimeout(() => {
                this.reconnectTimer = undefined;
                this.connect();
            }, this.reconnectInterval);
        }
    }

    private clearReconnect(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
    }

    private failPending(why: Error): void {
        for (const p of this.pending.values()) {
            clearTimeout(p.timer);
            p.reject(why);
        }
        this.pending.clear();
    }

    private onData(chunk: string): void {
        this.buffer += chunk;

        // A single TCP read can straddle message boundaries, so only whole
        // lines are parsed and the tail is kept for the next chunk.
        let index: number;
        while ((index = this.buffer.indexOf("\n")) >= 0) {
            const line = this.buffer.slice(0, index).trim();
            this.buffer = this.buffer.slice(index + 1);
            if (line) {
                this.dispatch(line);
            }
        }
    }

    private dispatch(line: string): void {
        let message: Response;
        try {
            message = JSON.parse(line) as Response;
        } catch {
            this.emit("log", `unparseable line: ${line}`);
            return;
        }

        if (message.type === "event") {
            this.emit("event", message.event as Event);
            return;
        }

        const id = message.id;
        if (id === null || id === undefined) {
            this.emit("log", JSON.stringify(message));
            return;
        }

        const pending = this.pending.get(id);
        if (!pending) {
            return;
        }

        this.pending.delete(id);
        clearTimeout(pending.timer);
        pending.resolve(message);
    }

    private send(request: Omit<Request, "id">): Promise<Response> {
        if (!this.socket || this.socket.destroyed) {
            return Promise.reject(new Error("not connected to Autorun"));
        }

        const id = this.nextId++;
        const socket = this.socket;

        return new Promise<Response>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error("request timed out"));
            }, REQUEST_TIMEOUT_MS);

            this.pending.set(id, { resolve, reject, timer });
            socket.write(JSON.stringify({ ...request, id }) + "\n");
        });
    }

    async run(realm: Realm, code: string): Promise<void> {
        const response = await this.send({ cmd: "run", realm, code } as Omit<Request, "id">);
        if (response.type === "error") {
            throw new Error(response.message);
        }
    }

    /// Runs a line in the game's console rather than the lua VM.
    async console(realm: Realm, line: string): Promise<void> {
        const response = await this.send({ cmd: "console", realm, line } as Omit<Request, "id">);
        if (response.type === "error") {
            throw new Error(response.message);
        }
    }

    /// Asks the DLL to tee gmod console output back to us as events.
    async attachConsole(realm: Realm): Promise<void> {
        const response = await this.send({
            cmd: "attach_console",
            realm,
        } as Omit<Request, "id">);
        if (response.type === "error") {
            throw new Error(response.message);
        }
    }

    async readHook(which: HookName): Promise<Hook> {
        const response = await this.send({ cmd: "read_hook", which } as Omit<Request, "id">);
        if (response.type !== "hook") {
            throw new Error(
                response.type === "error" ? response.message : "unexpected response"
            );
        }
        return { which: response.which, path: response.path, content: response.content };
    }

    async writeHook(which: HookName, content: string): Promise<void> {
        const response = await this.send({
            cmd: "write_hook",
            which,
            content,
        } as Omit<Request, "id">);
        if (response.type === "error") {
            throw new Error(response.message);
        }
    }

    async paths(): Promise<Paths> {
        const response = await this.send({ cmd: "paths" } as Omit<Request, "id">);
        if (response.type !== "paths") {
            throw new Error(
                response.type === "error" ? response.message : "unexpected response"
            );
        }
        return {
            base: response.base,
            dumps: response.dumps,
            scripts: response.scripts,
            plugins: response.plugins,
        };
    }

    async ping(): Promise<string> {
        const response = await this.send({ cmd: "ping" } as Omit<Request, "id">);
        if (response.type !== "pong") {
            throw new Error(
                response.type === "error" ? response.message : "unexpected response"
            );
        }
        return response.version;
    }
}
