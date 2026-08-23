//! Bridges the gmod console to the editor, both directions.
//!
//! Capture is done in lua rather than by hooking ILuaBase::Msg: the vtable slot
//! differs between realms and gmod builds, while wrapping the global print
//! functions works everywhere and catches addon output too.

use std::{
	ffi::CStr,
	sync::atomic::{AtomicU8, Ordering},
};

use rglua::prelude::*;

use super::event::{push_event, Event};
use crate::logging::*;

/// Injected into each realm to tee console output at us. Wrappers are installed
/// once (guarded by the sentinel) so repeated attaches don't nest them, and the
/// original is always called first so the game console keeps working normally.
pub const CAPTURE_SHIM: &str = r##"
-- Re-attaching must be safe: the lua state is recreated on map change, and the
-- editor re-sends attach on reconnect. Wrappers are installed once, but the
-- write function is looked up live so a fresh _AutorunConsoleWrite is picked up
-- instead of a stale upvalue.
local function write(text)
    local fn = _AutorunConsoleWrite
    if fn then fn(text) end
end

if _AutorunConsoleHooked then return end
_AutorunConsoleHooked = true
local tostring, concat, select = tostring, table.concat, select
local type = type

local function join(...)
    local n = select("#", ...)
    local parts = {}
    for i = 1, n do
        local v = select(i, ...)
        -- MsgC colors arrive as tables; keep the text, drop the color
        if type(v) == "table" and v.r then
            parts[#parts + 1] = ""
        else
            parts[#parts + 1] = tostring(v)
        end
    end
    return concat(parts, "\t")
end

local function wrap(name, sep)
    local original = _G[name]
    if not original then return end
    _G[name] = function(...)
        original(...)
        -- pcall so a bridge failure can never break the game's own printing
        pcall(write, join(...) .. sep)
    end
end

wrap("print", "\n")
wrap("MsgN", "\n")
wrap("Msg", "")
wrap("MsgC", "")
"##;

/// `_AutorunConsoleWrite(text)` -- called by the shim above for every line.
#[lua_function]
pub fn console_write(l: LuaState) -> i32 {
	let text = luaL_checkstring(l, 1);
	let text = unsafe { CStr::from_ptr(text) }.to_string_lossy();

	push_event(Event::Console {
		text: text.to_string(),
	});

	0
}

/// Realms with a pending attach, as a bitmask. Set from the socket thread, read
/// and cleared by the painttraverse drain, which is the only place with a lua
/// state safe to touch.
static PENDING: AtomicU8 = AtomicU8::new(0);

/// Realms the editor has ever asked to capture, so a map change can restore them.
static ACTIVE: AtomicU8 = AtomicU8::new(0);

pub fn request_attach(realm: autorun_shared::Realm) {
	let bit = 1 << u8::from(realm);
	ACTIVE.fetch_or(bit, Ordering::Relaxed);
	PENDING.fetch_or(bit, Ordering::Relaxed);
}

/// Re-queues capture for every realm the editor asked for. Called when a new
/// server connection resets the lua state and wipes the wrappers.
pub fn reattach_if_active() {
	PENDING.fetch_or(ACTIVE.load(Ordering::Relaxed), Ordering::Relaxed);
}

/// Drains pending attach requests. Called every frame from painttraverse.
pub fn poll_attach() {
	let pending = PENDING.swap(0, Ordering::Relaxed);
	if pending == 0 {
		return;
	}

	for realm in [
		autorun_shared::Realm::Client,
		autorun_shared::Realm::Menu,
	] {
		if pending & (1 << u8::from(realm)) != 0 {
			attach(realm);
		}
	}
}

/// Installs the capture hook in a realm. Must run on gmod's thread (the
/// painttraverse drain calls this), never from the socket thread.
pub fn attach(realm: autorun_shared::Realm) {
	let Ok(state) = crate::lua::get_state(realm) else {
		debug!("console: no {realm} state to attach to");
		return;
	};

	lua_pushcfunction(state, console_write);
	lua_setglobal(state, cstr!("_AutorunConsoleWrite"));

	match crate::lua::dostring(state, CAPTURE_SHIM) {
		Err(why) => {
			error!("console: failed to attach capture in {realm}: {why}");
			push_event(Event::RunResult {
				ok: false,
				message: format!("console capture failed in {realm}: {why}"),
			});
		}
		Ok(_) => {
			debug!("console: capture attached in {realm}");
			push_event(Event::RunResult {
				ok: true,
				message: format!("console capture attached in {realm}"),
			});
		}
	}
}

/// Wraps a console command line as lua so it rides the existing script queue and
/// therefore executes on gmod's thread, same as everything else the editor sends.
pub fn as_lua(line: &str) -> String {
	// Long-bracket literal with a padded level that plain quotes/brackets in the
	// command cannot terminate.
	let mut level = String::new();
	while line.contains(&format!("]{level}]")) {
		level.push('=');
	}

	// LocalPlayer():ConCommand is the clientside route but there is no local
	// player in menu realm or before spawn, so fall back to the engine binding.
	format!(
		r#"local cmd = [{level}[{line}]{level}]
local ply = LocalPlayer and LocalPlayer()
if IsValid and IsValid(ply) then
    ply:ConCommand(cmd)
else
    RunConsoleCommand(unpack(string.Explode(" ", cmd)))
end"#
	)
}

#[cfg(test)]
mod tests {
	use super::as_lua;

	#[test]
	fn wraps_plain_command() {
		let out = as_lua("sv_cheats 1");
		assert!(out.contains("[[sv_cheats 1]]"));
	}

	#[test]
	fn quotes_cannot_break_out() {
		// Quotes are meaningless inside a long bracket, so they stay literal.
		let out = as_lua(r#"say "hi" end) print(1)"#);
		assert!(out.contains(r#"[[say "hi" end) print(1)]]"#));
	}

	#[test]
	fn brackets_bump_the_delimiter_level() {
		let out = as_lua("say ]] print(1) --");
		// A bare ]] would have closed the literal, so the level must grow.
		assert!(out.contains("[=[say ]] print(1) --]=]"));
		assert!(!out.contains("[[say"));
	}
}
