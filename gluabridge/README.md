# GLuaBridge

Garry's Mod Lua dumper and executor, inside VSCode.

Talks to the [Autorun](https://github.com/ds-kimi/gluabridge) DLL over a loopback
socket on `127.0.0.1:3005`. **The DLL must be running inside gmod for anything
here to work** — see the [project README](https://github.com/ds-kimi/gluabridge)
for how to set that up.

## Features

* **Save to run.** Saving a `.lua` file executes it in the live client. Realm is
  guessed from the path (`cl_`/`sh_`/`client/`/`vgui/` → client, `menu_`/`menu/`
  → menu, otherwise `autorun.defaultRealm`).
* **Server files in your explorer.** The `lua_dumps` folder is mounted as a
  workspace folder on connect, so files a server sends you are browsable without
  digging through your home directory.
* **The game console, in a terminal.** Streams console output; what you type goes
  back. Plain lines are console commands (`sv_cheats 1`), a `>` prefix runs Lua
  (`> print(LocalPlayer():Nick())`).
* **Lua Runner sidebar.** Scratch runner plus editors for the `autorun.lua` and
  `hook.lua` scripthooks.

## Commands

| Command | Default key |
|---|---|
| `Autorun: Run Current File` | <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>R</kbd> |
| `Autorun: Run Selection` | |
| `Autorun: Open Gmod Console` | |
| `Autorun: Attach Console Capture` | |
| `Autorun: Focus Lua Runner` | |
| `Autorun: Open Dump Folder in Workspace` | |
| `Autorun: Connect` / `Disconnect` | |

## Settings

| Setting | Default | |
|---|---|---|
| `autorun.host` / `autorun.port` | `127.0.0.1` / `3005` | Where the DLL listens |
| `autorun.runOnSave` | `true` | Send a `.lua` file to the game on save |
| `autorun.defaultRealm` | `client` | Used when the path gives no hint |
| `autorun.captureConsole` | `true` | Tee game console output into the terminal |
| `autorun.openConsoleOnStart` | `true` | Open that terminal on activation |
| `autorun.autoAddDumpFolder` | `true` | Mount `lua_dumps` as a workspace folder |
| `autorun.reconnectInterval` | `3000` | Reconnect delay in ms; `0` disables |

## Security

The socket is unauthenticated and grants arbitrary Lua execution in your game
client. It binds loopback only — do not forward the port.

## License

Apache License 2.0. Built on [Autorun-rs](https://github.com/vurvdev/Autorun-rs)
by Vurv78 and its contributors.
