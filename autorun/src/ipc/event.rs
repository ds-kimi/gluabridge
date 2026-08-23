//! Outbound events. Producers run on gmod's own threads (the loadbufferx detour,
//! painttraverse), so they only push onto a queue -- a blocked socket write there
//! would stall the game.

use std::{
	sync::{Arc, Mutex},
	time::Duration,
};

use once_cell::sync::Lazy;
use serde::Serialize;

use super::protocol::Response;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "name", rename_all = "snake_case")]
pub enum Event {
	/// A lua file was written to the dump directory.
	Dump { path: String },

	/// Result of a script the editor asked us to run.
	RunResult { ok: bool, message: String },

	/// Connected to a server; the editor uses this to re-mount the dump folder.
	Connected { ip: String },

	/// A line the game printed to its console, teed to us by the lua shim.
	Console { text: String },
}

static QUEUE: Lazy<Arc<Mutex<Vec<Event>>>> = Lazy::new(|| Arc::new(Mutex::new(Vec::new())));

const DRAIN_COOLDOWN: Duration = Duration::from_millis(100);

/// Cap so a dump flood can't grow the queue without bound when no editor drains it.
const MAX_QUEUED: usize = 2048;

pub fn push_event(event: Event) {
	if !super::has_clients() {
		return;
	}

	if let Ok(mut queue) = QUEUE.try_lock() {
		if queue.len() < MAX_QUEUED {
			queue.push(event);
		}
	}
}

pub fn pump() {
	loop {
		std::thread::sleep(DRAIN_COOLDOWN);

		let drained: Vec<Event> = match QUEUE.try_lock() {
			Ok(mut queue) if !queue.is_empty() => queue.drain(..).collect(),
			_ => continue,
		};

		for event in drained {
			Response::Event { event }.send();
		}
	}
}
