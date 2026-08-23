# GLuaBridge

Talks to the injected Autorun DLL over a loopback socket (`127.0.0.1:3005`).

## What it does

- **Save = run.** Saving a `.lua` file sends it to the live gmod client. Realm is
  guessed from the path (`cl_`/`sh_`/`client/`/`vgui/` → client, `menu_`/`menu/` →
  menu, otherwise `autorun.defaultRealm`).
- **Dumped server files appear in the explorer.** On connect the extension asks
  the DLL where `autorun/lua_dumps` lives and adds it as a workspace folder, so
  the clientside/shared files a server sends you are browsable without digging
  through your home directory. Requires `filesteal.enabled = true` in
  `autorun/settings.toml`.
- **Errors come back.** Lua compile/runtime errors from scripts you sent show as
  notifications and in the `Autorun` output channel.
- **Gmod console in a VSCode terminal.** A `Gmod Console` terminal streams the
  game's console output, and anything you type there runs in the game. Plain
  lines run as console commands (`sv_cheats 1`); prefix with `>` to run lua
  (`> print(LocalPlayer():Nick())`).

## Setup

1. Enable file stealing in `~/autorun/settings.toml`:
   ```toml
   [filesteal]
   enabled = true
   ```
2. Inject Autorun into gmod as usual.
3. `npm install && npm run compile` in this folder, then run the extension
   (F5 in VSCode, or package with `vsce package`).

It auto-connects on startup and retries every `autorun.reconnectInterval` ms, so
injecting after VSCode is already open works fine.

## Commands

| Command | Default key |
|---|---|
| `Autorun: Run Current File` | `ctrl+alt+r` |
| `Autorun: Run Selection` | |
| `Autorun: Connect` / `Disconnect` | |
| `Autorun: Open Dump Folder in Workspace` | |
| `Autorun: Open Gmod Console` | |
| `Autorun: Attach Console Capture` | |

## Console capture

Capture works by wrapping `print`/`Msg`/`MsgN`/`MsgC` in the target realm with
functions that call the original and then tee the text back over the socket. It
is installed once per realm (guarded by `_AutorunConsoleHooked`) and is
re-attached with `Autorun: Attach Console Capture` after a map change or
reconnect. Output printed by the engine itself rather than lua does not pass
through those functions, so it will not appear.

## Security

The socket is unauthenticated and grants arbitrary lua execution in your game
client. It binds loopback only — do not forward the port or bind it publicly.

## Protocol

Line-delimited JSON, defined in [`../autorun/src/ipc/`](../autorun/src/ipc/) and
mirrored in [`src/protocol.ts`](src/protocol.ts). Requests carry an `id` that is
echoed on the response; events (`dump`, `run_result`, `connected`) are pushed
unsolicited with no id.
