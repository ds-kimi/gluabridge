/// Markup for the Autorun sidebar. Kept in its own module so panel.ts stays
/// about behaviour; VSCode theme variables keep it native in any color theme.
export function panelHtml(): string {
    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
         color: var(--vscode-foreground); padding: 8px; }
  .tabs { display: flex; gap: 4px; margin-bottom: 8px; }
  .tab { padding: 4px 10px; cursor: pointer; border: none; border-radius: 3px;
         background: var(--vscode-button-secondaryBackground);
         color: var(--vscode-button-secondaryForeground); }
  .tab.active { background: var(--vscode-button-background);
                color: var(--vscode-button-foreground); }
  textarea { width: 100%; box-sizing: border-box; min-height: 220px; resize: vertical;
             font-family: var(--vscode-editor-font-family); font-size: 12px;
             background: var(--vscode-input-background); color: var(--vscode-input-foreground);
             border: 1px solid var(--vscode-input-border, transparent); padding: 6px; }
  .row { display: flex; gap: 6px; align-items: center; margin-top: 8px; flex-wrap: wrap; }
  button.action { padding: 4px 12px; border: none; border-radius: 3px; cursor: pointer;
                  background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.action:disabled { opacity: 0.5; cursor: default; }
  select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground);
           border: 1px solid var(--vscode-dropdown-border, transparent); padding: 3px; }
  .hint { color: var(--vscode-descriptionForeground); font-size: 11px; margin-top: 6px; }
  .status { margin-top: 8px; font-size: 11px; min-height: 14px; }
  .status.err { color: var(--vscode-errorForeground); }
  .path { color: var(--vscode-descriptionForeground); font-size: 10px;
          word-break: break-all; margin-top: 4px; }
  .off { color: var(--vscode-errorForeground); }
</style></head>
<body>
  <div class="tabs">
    <button class="tab active" data-pane="scratch">Runner</button>
    <button class="tab" data-pane="autorun">autorun.lua</button>
    <button class="tab" data-pane="hook">hook.lua</button>
  </div>

  <div id="pane-scratch">
    <textarea id="code" placeholder="print('hello from autorun')"></textarea>
    <div class="row">
      <select id="realm"><option value="client">client</option><option value="menu">menu</option></select>
      <button class="action" id="run">Run</button>
    </div>
    <div class="hint">Runs through Autorun's executor, not console commands.</div>
  </div>

  <div id="pane-autorun" hidden>
    <textarea id="autorun-content"></textarea>
    <div class="row">
      <button class="action" id="autorun-save">Save</button>
      <button class="action" id="autorun-reload">Reload</button>
    </div>
    <div class="hint">Runs <b>once</b> before any server script, on connect.
      Use C functions (<code>HTTP</code>, <code>file.Open</code>) &mdash; the lua
      library is not loaded yet.</div>
    <div class="path" id="autorun-path"></div>
  </div>

  <div id="pane-hook" hidden>
    <textarea id="hook-content"></textarea>
    <div class="row">
      <button class="action" id="hook-save">Save</button>
      <button class="action" id="hook-reload">Reload</button>
    </div>
    <div class="hint">Runs for <b>every</b> script. <code>return true</code> blocks it,
      returning a string replaces it. Source is in <code>Autorun.CODE</code>.</div>
    <div class="path" id="hook-path"></div>
  </div>

  <div class="status" id="status"></div>

<script>
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  let connected = false;

  function setStatus(text, ok) {
    const el = $("status");
    el.textContent = text;
    el.className = ok === false ? "status err" : "status";
  }

  function showPane(name) {
    for (const tab of document.querySelectorAll(".tab")) {
      tab.classList.toggle("active", tab.dataset.pane === name);
    }
    for (const pane of ["scratch", "autorun", "hook"]) {
      $("pane-" + pane).hidden = pane !== name;
    }
    // Hook contents live on disk in the game's home dir, so pull fresh on open
    if (name !== "scratch") { vscode.postMessage({ type: "load", which: name }); }
  }

  for (const tab of document.querySelectorAll(".tab")) {
    tab.addEventListener("click", () => showPane(tab.dataset.pane));
  }

  $("run").addEventListener("click", () => {
    vscode.postMessage({ type: "run", realm: $("realm").value, code: $("code").value });
  });

  for (const which of ["autorun", "hook"]) {
    $(which + "-save").addEventListener("click", () => {
      vscode.postMessage({ type: "save", which, content: $(which + "-content").value });
    });
    $(which + "-reload").addEventListener("click", () => {
      vscode.postMessage({ type: "load", which });
    });
  }

  window.addEventListener("message", (e) => {
    const msg = e.data;
    if (msg.type === "hook") {
      $(msg.which + "-content").value = msg.content;
      $(msg.which + "-path").textContent = msg.path;
    } else if (msg.type === "status") {
      setStatus(msg.text, msg.ok);
    } else if (msg.type === "connection") {
      connected = msg.connected;
      for (const b of document.querySelectorAll("button.action")) { b.disabled = !connected; }
      if (!connected) { setStatus("Autorun not connected.", false); }
      else if ($("status").classList.contains("err")) { setStatus(""); }
    }
  });

  vscode.postMessage({ type: "ready" });
</script>
</body></html>`;
}
