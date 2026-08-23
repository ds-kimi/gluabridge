// Wire types mirroring autorun/src/ipc/protocol.rs and event.rs.
// Keep in sync with the Rust side; the socket speaks line-delimited JSON.

export type Realm = "client" | "menu";

/// The two scripthook files Autorun reads from ~/autorun/.
export type HookName = "autorun" | "hook";

export interface Hook {
    which: HookName;
    path: string;
    content: string;
}

export type Request =
    | { cmd: "run"; id: number; realm: Realm; code: string }
    | { cmd: "console"; id: number; realm: Realm; line: string }
    | { cmd: "attach_console"; id: number; realm: Realm }
    | { cmd: "read_hook"; id: number; which: HookName }
    | { cmd: "write_hook"; id: number; which: HookName; content: string }
    | { cmd: "ping"; id: number }
    | { cmd: "paths"; id: number };

export interface Paths {
    base: string;
    dumps: string;
    scripts: string;
    plugins: string;
}

export type Event =
    | { name: "dump"; path: string }
    | { name: "run_result"; ok: boolean; message: string }
    | { name: "connected"; ip: string }
    | { name: "console"; text: string };

export type Response =
    | { type: "ok"; id: number | null }
    | { type: "pong"; id: number | null; version: string }
    | ({ type: "paths"; id: number | null } & Paths)
    | ({ type: "hook"; id: number | null } & Hook)
    | { type: "error"; id: number | null; message: string }
    | { type: "event"; event: Event };
