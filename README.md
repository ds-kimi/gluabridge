# GLuaBridge

A VSCode front-end for [Autorun-rs](https://github.com/vurvdev/Autorun-rs) — run
Lua in a live Garry's Mod client, read the game console, and browse the files a
server sends you, all without leaving your editor.

> **This is not an official Autorun-rs release.** It is a derived work built on
> Autorun-rs by [Vurv78](https://github.com/Vurv78) and its contributors, used
> under the Apache License 2.0. See [NOTICE](NOTICE) for the full attribution and
> the list of changes. Please report issues with *this* project here, not to
> upstream.

## What it adds over upstream Autorun-rs

| | |
|---|---|
| **Save to run** | Save a `.lua` file and it executes in the game. Realm inferred from the path. |
| **Server files in your explorer** | The `lua_dumps` folder is mounted as a workspace folder automatically, so clientside/shared files a server sends you are just there. |
| **The gmod console, in VSCode** | A terminal that streams console output and sends what you type back. |
| **Lua Runner sidebar** | Scratch runner plus editors for the `autorun.lua` and `hook.lua` scripthooks. |

Everything upstream does — dumping, scripthook, plugins, the external console —
still works unchanged.

## Download

Grab both files from the [Release](../../releases/tag/Release) page — it is
rebuilt automatically on every commit:

* `gmsv_autorun_win64.dll`
* `gluabridge.vsix`

Then jump to [Setup](#setup).

## Building it yourself

Two separate pieces. You can build one without the other.

### The DLL

Needs [Rust](https://www.rust-lang.org/tools/install). Nightly, because upstream
Autorun-rs requires it.

```sh
rustup toolchain install nightly
cargo +nightly build --release --manifest-path autorun/Cargo.toml
```

The result is `target/release/autorun.dll`. Rename it to
`gmsv_autorun_win64.dll` — gmod requires that exact name to load it as a module.

### The extension

Needs [Node.js](https://nodejs.org/) 18 or newer.

```sh
cd gluabridge
npm install
npm run compile
npx @vscode/vsce package --skip-license --out gluabridge.vsix
```

`npm run compile` turns the TypeScript in `src/` into JavaScript in `out/`;
`vsce package` zips that into the installable `gluabridge.vsix`.

To develop instead of package: open the `gluabridge` folder in VSCode and press
**F5**. That opens a second VSCode with the extension loaded, and reloads it when
you recompile.

## Setup

### 1. Load the DLL

Either way works:

* **Menu plugin** — put `gmsv_autorun_win64.dll` in `garrysmod/lua/bin/` and add
  `require("autorun")` at the bottom of `garrysmod/lua/menu/menu.lua`. It then
  loads every time gmod starts.
* **Injection** — inject it into gmod from the main menu with any 64-bit
  injector.

### 2. Install the extension

```sh
code --install-extension gluabridge.vsix
```

Or in VSCode: Extensions panel → `...` menu → **Install from VSIX**.

### 3. Turn on file dumping

Autorun only saves the files a server sends you if you ask it to. In
`%USERPROFILE%\autorun\settings.toml`:

```toml
[filesteal]
enabled = true
```

Off by default; the dump-folder mount needs it.

## Using it

Inject, then open VSCode. The status bar shows `⚡ Autorun` once connected — the
extension retries every few seconds, so injecting before or after opening VSCode
both work.

* **Save any `.lua`** → runs it. `cl_`/`sh_`/`client/`/`vgui/` → client realm,
  `menu_`/`menu/` → menu, otherwise `autorun.defaultRealm`.
* **Gmod Console terminal** → plain lines are console commands (`sv_cheats 1`),
  a `>` prefix runs lua (`> print(LocalPlayer():Nick())`).
* **Activity bar → Autorun** → scratch runner and the two scripthook editors.

Console capture works by wrapping `print`/`Msg`/`MsgN`/`MsgC` in the target
realm, so output the engine prints directly does not appear. It re-attaches
itself when you join a server.

## How it talks to the game

The DLL opens a line-delimited JSON socket on `127.0.0.1:3005`. Protocol lives in
[`autorun/src/ipc/`](autorun/src/ipc/) and is mirrored in
[`gluabridge/src/protocol.ts`](gluabridge/src/protocol.ts).

> **Security:** that socket is unauthenticated and grants arbitrary Lua execution
> in your game client. It binds to loopback only. Do not forward the port, and do
> not bind it to a public interface.

Scripthook file access is whitelisted to `autorun.lua` and `hook.lua` — the
socket cannot read or write anything else in your home directory.

## Upstream docs

Upstream's README, covering scripthook, plugins, settings and the file layout, is
kept verbatim at [UPSTREAM_README.md](UPSTREAM_README.md). The scripthook field
definitions are in [fields.lua](fields.lua) and examples in
[examples/](examples/).

Note that upstream considers Autorun-rs deprecated in favour of
[Autorun-ng](https://github.com/thevurv/Autorun-ng), which this project does not
target.

## License

Apache License 2.0 — see [LICENSE.md](LICENSE.md) and [NOTICE](NOTICE).
