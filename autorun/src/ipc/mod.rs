//! Line-delimited JSON control server for external editors (VSCode extension).
//!
//! Sits on a loopback socket so an editor can push lua at the game without the
//! user touching the injected console. Loopback-only by design: the protocol is
//! unauthenticated and grants arbitrary lua execution.

use std::{
	io::{BufRead, BufReader, Write},
	net::{TcpListener, TcpStream},
	sync::{Arc, Mutex},
};

use crate::logging::*;

pub mod console;
mod event;
mod protocol;

pub use event::{push_event, Event};
use protocol::{handle_line, Response};

/// Sockets of every attached editor. Events fan out to all of them.
static CLIENTS: once_cell::sync::Lazy<Arc<Mutex<Vec<TcpStream>>>> =
	once_cell::sync::Lazy::new(|| Arc::new(Mutex::new(Vec::new())));

pub fn init() {
	std::thread::spawn(listen);
	std::thread::spawn(event::pump);
}

fn listen() {
	let listener = match TcpListener::bind(autorun_shared::IP) {
		Ok(l) => l,
		Err(why) => {
			error!("IPC: failed to bind {}: {why}", autorun_shared::IP);
			return;
		}
	};

	info!("IPC: listening on {}", autorun_shared::IP);

	for stream in listener.incoming().flatten() {
		let Ok(write_half) = stream.try_clone() else {
			continue;
		};

		if let Ok(mut clients) = CLIENTS.lock() {
			clients.push(write_half);
		}

		std::thread::spawn(move || serve(stream));
	}
}

fn serve(stream: TcpStream) {
	let peer = stream
		.peer_addr()
		.map(|a| a.to_string())
		.unwrap_or_else(|_| "?".to_owned());

	debug!("IPC: editor connected ({peer})");

	let mut writer = match stream.try_clone() {
		Ok(w) => w,
		Err(why) => {
			error!("IPC: failed to clone stream: {why}");
			return;
		}
	};

	for line in BufReader::new(stream).lines() {
		let Ok(line) = line else { break };
		if line.trim().is_empty() {
			continue;
		}

		let response = handle_line(&line);
		if let Err(why) = writeln!(writer, "{}", response.encode()) {
			debug!("IPC: write failed ({peer}): {why}");
			break;
		}
	}

	debug!("IPC: editor disconnected ({peer})");
	drop_client(&peer);
}

/// Drops write halves whose peer matches; a failed send also prunes lazily.
fn drop_client(peer: &str) {
	if let Ok(mut clients) = CLIENTS.lock() {
		clients.retain(|c| {
			c.peer_addr()
				.map(|a| a.to_string() != peer)
				.unwrap_or(false)
		});
	}
}

/// Broadcast a pre-encoded JSON line to every attached editor.
fn broadcast(line: &str) {
	if let Ok(mut clients) = CLIENTS.lock() {
		clients.retain_mut(|c| writeln!(c, "{line}").is_ok());
	}
}

/// Whether any editor is attached; lets callers skip event formatting work.
pub fn has_clients() -> bool {
	CLIENTS.lock().map(|c| !c.is_empty()).unwrap_or(false)
}

impl Response {
	fn send(self) {
		broadcast(&self.encode());
	}
}
