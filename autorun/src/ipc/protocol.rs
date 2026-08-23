//! Request/response shapes for the editor socket.

use serde::{Deserialize, Serialize};

use crate::{fs as afs, logging::*};

#[derive(Debug, Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
pub enum Request {
	/// Execute lua in a realm. `id` echoes back so the editor can match results.
	Run {
		#[serde(default)]
		id: Option<u32>,
		#[serde(default = "default_realm")]
		realm: String,
		code: String,
	},

	/// Liveness + version handshake.
	Ping {
		#[serde(default)]
		id: Option<u32>,
	},

	/// Absolute paths of the autorun directories the editor should mount.
	Paths {
		#[serde(default)]
		id: Option<u32>,
	},

	/// Run a line in the game's console rather than the lua VM.
	Console {
		#[serde(default)]
		id: Option<u32>,
		#[serde(default = "default_realm")]
		realm: String,
		line: String,
	},

	/// Install the console capture shim so console output streams back as events.
	AttachConsole {
		#[serde(default)]
		id: Option<u32>,
		#[serde(default = "default_realm")]
		realm: String,
	},

	/// Read one of the scripthook files (`autorun` or `hook`).
	ReadHook {
		#[serde(default)]
		id: Option<u32>,
		which: String,
	},

	/// Write one of the scripthook files. Takes effect on the next connect for
	/// `autorun`, and on the next script loaded for `hook`.
	WriteHook {
		#[serde(default)]
		id: Option<u32>,
		which: String,
		content: String,
	},
}

fn default_realm() -> String {
	"client".to_owned()
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Response {
	Ok {
		id: Option<u32>,
	},
	Pong {
		id: Option<u32>,
		version: &'static str,
	},
	Paths {
		id: Option<u32>,
		base: String,
		dumps: String,
		scripts: String,
		plugins: String,
	},
	Error {
		id: Option<u32>,
		message: String,
	},
	Hook {
		id: Option<u32>,
		which: String,
		path: String,
		content: String,
	},
	/// Unsolicited pushes (dumped file, lua error, log line).
	Event {
		event: super::Event,
	},
}

impl Response {
	pub fn encode(&self) -> String {
		serde_json::to_string(self)
			.unwrap_or_else(|why| format!(r#"{{"type":"error","message":"encode failed: {why}"}}"#))
	}
}

fn parse_realm(name: &str) -> Option<autorun_shared::Realm> {
	match name {
		"client" | "cl" => Some(autorun_shared::Realm::Client),
		"menu" => Some(autorun_shared::Realm::Menu),
		// Server realm exists in the enum but a client-side injection has no
		// server lua_State to run against, so refuse instead of crashing later.
		_ => None,
	}
}

pub fn handle_line(line: &str) -> Response {
	let request: Request = match serde_json::from_str(line) {
		Ok(r) => r,
		Err(why) => {
			return Response::Error {
				id: None,
				message: format!("malformed request: {why}"),
			}
		}
	};

	match request {
		Request::Ping { id } => Response::Pong {
			id,
			version: env!("CARGO_PKG_VERSION"),
		},

		Request::Paths { id } => Response::Paths {
			id,
			base: afs::base().display().to_string(),
			dumps: afs::in_autorun(afs::DUMP_DIR).display().to_string(),
			scripts: afs::in_autorun(afs::INCLUDE_DIR).display().to_string(),
			plugins: afs::in_autorun(afs::PLUGIN_DIR).display().to_string(),
		},

		Request::Run { id, realm, code } => run(id, &realm, code),

		Request::Console { id, realm, line } => {
			run(id, &realm, super::console::as_lua(&line))
		}

		Request::ReadHook { id, which } => read_hook(id, &which),

		Request::WriteHook {
			id,
			which,
			content,
		} => write_hook(id, &which, &content),

		// The shim needs a live lua_State, so it is flagged here and installed by
		// the painttraverse drain rather than from this socket thread.
		Request::AttachConsole { id, realm } => match parse_realm(&realm) {
			Some(realm) => {
				super::console::request_attach(realm);
				Response::Ok { id }
			}
			None => Response::Error {
				id,
				message: format!("unknown or unsupported realm '{realm}'"),
			},
		},
	}
}

#[cfg(executor)]
fn run(id: Option<u32>, realm: &str, code: String) -> Response {
	let Some(realm) = parse_realm(realm) else {
		return Response::Error {
			id,
			message: format!("unknown or unsupported realm '{realm}'"),
		};
	};

	match crate::lua::run(realm, code) {
		Ok(_) => {
			debug!("IPC: queued script for {realm}");
			Response::Ok { id }
		}
		Err(why) => Response::Error {
			id,
			message: why.to_string(),
		},
	}
}

#[cfg(not(executor))]
fn run(id: Option<u32>, _realm: &str, _code: String) -> Response {
	let _ = parse_realm;
	Response::Error {
		id,
		message: "this build has the executor feature disabled".to_owned(),
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn parses_editor_requests() {
		assert!(matches!(
			serde_json::from_str::<Request>(r#"{"cmd":"ping","id":1}"#).unwrap(),
			Request::Ping { id: Some(1) }
		));

		// realm is optional and defaults to client
		assert!(matches!(
			serde_json::from_str::<Request>(r#"{"cmd":"run","id":2,"code":"print(1)"}"#).unwrap(),
			Request::Run { realm, .. } if realm == "client"
		));
	}

	#[test]
	fn encodes_tagged_responses() {
		let paths = Response::Paths {
			id: Some(3),
			base: "b".into(),
			dumps: "d".into(),
			scripts: "s".into(),
			plugins: "p".into(),
		};
		assert!(paths.encode().starts_with(r#"{"type":"paths","id":3"#));

		let event = Response::Event {
			event: super::super::Event::Dump { path: "x.lua".into() },
		};
		assert_eq!(
			event.encode(),
			r#"{"type":"event","event":{"name":"dump","path":"x.lua"}}"#
		);
	}

	#[test]
	fn hook_paths_are_whitelisted() {
		assert!(hook_path("autorun").is_some());
		assert!(hook_path("hook").is_some());
		// No traversal or arbitrary names -- only the two known hooks resolve.
		assert!(hook_path("../settings.toml").is_none());
		assert!(hook_path("settings").is_none());
		assert!(hook_path("").is_none());
	}

	#[test]
	fn rejects_garbage() {
		assert!(matches!(handle_line("not json"), Response::Error { .. }));
	}
}

/// Maps a hook name to its file, refusing anything else so the editor cannot
/// use this to read or write arbitrary paths in the user's home directory.
fn hook_path(which: &str) -> Option<std::path::PathBuf> {
	let name = match which {
		"autorun" => afs::AUTORUN_PATH,
		"hook" => afs::HOOK_PATH,
		_ => return None,
	};

	Some(afs::in_autorun(name))
}

fn read_hook(id: Option<u32>, which: &str) -> Response {
	let Some(path) = hook_path(which) else {
		return Response::Error {
			id,
			message: format!("unknown hook '{which}' (expected 'autorun' or 'hook')"),
		};
	};

	// A missing file is normal -- neither hook exists until the user writes one.
	let content = std::fs::read_to_string(&path).unwrap_or_default();

	Response::Hook {
		id,
		which: which.to_owned(),
		path: path.display().to_string(),
		content,
	}
}

fn write_hook(id: Option<u32>, which: &str, content: &str) -> Response {
	let Some(path) = hook_path(which) else {
		return Response::Error {
			id,
			message: format!("unknown hook '{which}' (expected 'autorun' or 'hook')"),
		};
	};

	match std::fs::write(&path, content) {
		Ok(_) => {
			debug!("IPC: wrote {which} hook ({} bytes)", content.len());
			Response::Ok { id }
		}
		Err(why) => Response::Error {
			id,
			message: format!("failed to write {}: {why}", path.display()),
		},
	}
}
