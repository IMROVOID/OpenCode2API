// The tools and settings pages of the control WebUI: the Playground, the
// rotation, the configuration, the account and the live log stream.
export const WEBUI_SETTINGS_PAGES = `
async function loadPlayground() {
  el("content").innerHTML = (
    '<div class="page-head"><div><h1>Playground</h1>' +
    '<p>Send a test request through the proxy</p></div></div>' +
    '<div class="card"><h2>Request</h2>' +
    '<div class="row">' +
    '<div class="field"><label>Protocol</label><select id="pg-protocol">' +
    '<option value="chat">chat</option>' +
    '<option value="responses">responses</option>' +
    '<option value="anthropic">anthropic</option>' +
    '</select></div>' +
    '<div class="field"><label>Model</label><input id="pg-model" placeholder="model id"></div>' +
    '</div>' +
    '<div class="field"><label>Body</label><textarea id="pg-body">' +
    '{"model":"","messages":[{"role":"user","content":"Hello"}]}' +
    '</textarea><div class="hint">The model field is filled in from the box above.</div></div>' +
    '<button class="primary" id="pg-send">Send request</button>' +
    '</div>' +
    '<div class="card"><h2>Response</h2><pre id="pg-result" class="mono">' +
    'No request sent yet.</pre></div>'
  );
  el("pg-send").addEventListener("click", sendPlayground);
}

async function sendPlayground() {
  const protocol = el("pg-protocol").value;
  const model = el("pg-model").value.trim();
  let body;
  try {
    body = JSON.parse(el("pg-body").value);
  } catch {
    toast("The body must be valid JSON", true);
    return;
  }
  body.model = model;
  el("pg-result").textContent = "Sending...";
  try {
    const result = await api("/api/debug/inference", {
      method: "POST",
      body: JSON.stringify({ protocol, request: body }),
    });
    el("pg-result").textContent = JSON.stringify(result, null, 2);
  } catch (error) {
    el("pg-result").textContent = error.message;
    toast(error.message, true);
  }
}

async function loadRotation() {
  const data = await api("/api/rotation");
  const groups = data.groups || [];
  el("content").innerHTML = (
    '<div class="page-head"><div><h1>Rotation</h1>' +
    '<p>Model groups that rotate between upstreams</p></div></div>' +
    groups.map((group) => (
      '<div class="card"><h2>' + escapeHtml(group.alias || group.id) +
      ' <span class="badge">current: ' + escapeHtml(group.current || "-") +
      '</span></h2>' +
      '<table><thead><tr><th>Model</th><th>State</th><th></th></tr></thead><tbody>' +
      (group.order || []).map((model) => (
        '<tr><td class="mono">' + escapeHtml(model) + '</td><td>' +
        (group.current === model
          ? '<span class="badge ok">current</span>'
          : '<span class="badge">idle</span>') +
        '</td><td><button class="ghost" data-group="' + escapeHtml(group.id) +
        '" data-model="' + escapeHtml(model) + '">Use</button></td></tr>'
      )).join("") + '</tbody></table></div>'
    )).join("")
  );
  for (const button of document.querySelectorAll("[data-group]")) {
    button.addEventListener("click", () => selectRotation(
      button.dataset.group, button.dataset.model));
  }
}

async function selectRotation(group, model) {
  try {
    await api("/api/rotation/current", {
      method: "POST",
      body: JSON.stringify({ group, model }),
    });
    toast("Switched to " + model);
    await loadRotation();
  } catch (error) {
    toast(error.message, true);
  }
}

async function loadConfig() {
  const config = await api("/api/config");
  state.config = config;
  el("content").innerHTML = (
    '<div class="page-head"><div><h1>Configuration</h1>' +
    '<p>Upstream lanes, retries and server behavior</p></div>' +
    '<button class="primary shrink" id="save-config">Save</button></div>' +
    '<div class="card"><h2>Upstream</h2>' +
    '<div class="field"><label>Zen base URL</label>' +
    '<input id="cfg-zen" value="' + escapeHtml(config.upstream.zen) + '"></div>' +
    '<div class="field"><label>Go base URL</label>' +
    '<input id="cfg-go" value="' + escapeHtml(config.upstream.go) + '"></div>' +
    '<div class="field"><label>Anonymous base URL</label>' +
    '<input id="cfg-anon" value="' + escapeHtml(config.upstream.anonymous || "") + '">' +
    '</div></div>' +
    '<div class="card"><h2>Behavior</h2><div class="row">' +
    '<div class="field"><label>Prefer tier</label><select id="cfg-prefer">' +
    '<option value="go"' + (config.prefer === "go" ? " selected" : "") + '>go</option>' +
    '<option value="zen"' + (config.prefer === "zen" ? " selected" : "") + '>zen</option>' +
    '</select></div>' +
    '<div class="field"><label>Max attempts</label><input id="cfg-attempts" type="number" value="' +
    escapeHtml(config.retry.max_attempts) + '"></div>' +
    '<div class="field"><label>Timeout (seconds)</label><input id="cfg-timeout" type="number" value="' +
    escapeHtml(config.retry.timeout_seconds) + '"></div>' +
    '<div class="field"><label>Catalog refresh (seconds)</label>' +
    '<input id="cfg-refresh" type="number" value="' +
    escapeHtml(config.models.refresh_seconds) + '"></div>' +
    '</div>' +
    '<div class="row"><div class="field"><label>Log level</label><select id="cfg-level">' +
    ["debug", "info", "warn", "error"].map((level) =>
      '<option value="' + level + '"' +
      (config.logging.level === level ? " selected" : "") + '>' + level + '</option>'
    ).join("") + '</select></div>' +
    '<div class="field"><label>Log ring size</label><input id="cfg-ring" type="number" value="' +
    escapeHtml(config.logging.ring_size) + '"></div></div>' +
    '<div class="field"><label>Free models only</label>' +
    '<select id="cfg-freeonly"><option value="false"' +
    (!config.models.free_only ? " selected" : "") + '>no</option>' +
    '<option value="true"' + (config.models.free_only ? " selected" : "") +
    '>yes</option></select></div></div>' +
    (config.restart_required_fields && config.restart_required_fields.length
      ? '<div class="card"><span class="badge warn">Restart required: ' +
        escapeHtml(config.restart_required_fields.join(", ")) + '</span></div>'
      : "")
  );
  el("save-config").addEventListener("click", saveConfig);
}

async function saveConfig() {
  const config = state.config;
  const body = JSON.parse(JSON.stringify(config));
  body.upstream.zen = el("cfg-zen").value.trim();
  body.upstream.go = el("cfg-go").value.trim();
  body.upstream.anonymous = el("cfg-anon").value.trim();
  body.prefer = el("cfg-prefer").value;
  body.retry.max_attempts = Number(el("cfg-attempts").value);
  body.retry.timeout_seconds = Number(el("cfg-timeout").value);
  body.models.refresh_seconds = Number(el("cfg-refresh").value);
  body.models.free_only = el("cfg-freeonly").value === "true";
  body.logging.level = el("cfg-level").value;
  body.logging.ring_size = Number(el("cfg-ring").value);
  delete body.effective;
  delete body.restart_required_fields;
  try {
    await api("/api/config", { method: "PUT", body: JSON.stringify(body) });
    toast("Configuration saved");
    await loadConfig();
  } catch (error) {
    toast(error.message, true);
  }
}

async function loadAccount() {
  el("content").innerHTML = (
    '<div class="page-head"><div><h1>Account</h1>' +
    '<p>Change the WebUI credentials</p></div></div>' +
    '<div class="card"><h2>Credentials</h2>' +
    '<div class="field"><label>Current password</label>' +
    '<input id="acc-current" type="password"></div>' +
    '<div class="field"><label>New username</label>' +
    '<input id="acc-username" placeholder="leave empty to keep"></div>' +
    '<div class="field"><label>New password</label>' +
    '<input id="acc-password" type="password" placeholder="leave empty to keep"></div>' +
    '<button class="primary" id="acc-save">Update</button></div>'
  );
  el("acc-save").addEventListener("click", saveAccount);
}

async function saveAccount() {
  const body = {
    current_password: el("acc-current").value,
    username: el("acc-username").value.trim(),
    new_password: el("acc-password").value,
  };
  try {
    await api("/api/account", { method: "PUT", body: JSON.stringify(body) });
    toast("Account updated, please sign in again");
    showLogin();
  } catch (error) {
    toast(error.message, true);
  }
}

let logSource = null;

async function loadLogs() {
  el("content").innerHTML = (
    '<div class="page-head"><div><h1>Logs</h1>' +
    '<p>Live structured log stream</p></div></div>' +
    '<div class="card"><h2>Stream</h2><div id="log-lines"></div></div>'
  );
  if (logSource) { logSource.close(); logSource = null; }
  const source = new EventSource("/api/logs/stream");
  logSource = source;
  source.addEventListener("log", (event) => {
    const entry = JSON.parse(event.data);
    const container = el("log-lines");
    if (!container) return;
    const line = document.createElement("div");
    line.className = "log-line";
    line.innerHTML = '<span class="time">' +
      escapeHtml(new Date(entry.time).toLocaleTimeString()) +
      '</span><span class="level ' + escapeHtml(entry.level) + '">' +
      escapeHtml(entry.level) + '</span><span class="message">' +
      escapeHtml(entry.message) +
      (entry.component ? ' [' + escapeHtml(entry.component) + ']' : "") +
      '</span>';
    container.prepend(line);
    while (container.children.length > 500) {
      container.removeChild(container.lastChild);
    }
  });
  source.addEventListener("gap", () => {
    toast("Some log events were skipped", true);
  });
}

const LOADERS = {
  overview: loadOverview,
  models: loadModels,
  keys: loadKeys,
  quota: loadQuota,
  playground: loadPlayground,
  rotation: loadRotation,
  config: loadConfig,
  account: loadAccount,
  logs: loadLogs,
};

async function render() {
  const hash = location.hash.replace("#", "") || "overview";
  state.page = LOADERS[hash] ? hash : "overview";
  markActive();
  try {
    await LOADERS[state.page]();
  } catch (error) {
    el("content").innerHTML = '<div class="empty">' +
      escapeHtml(error.message) + '</div>';
  }
}

async function login(event) {
  event.preventDefault();
  const username = el("login-user").value;
  const password = el("login-pass").value;
  try {
    const result = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    state.csrf = result.csrf_token;
    showApp();
    await render();
  } catch (error) {
    toast(error.message, true);
  }
}

async function boot() {
  renderNav();
  window.addEventListener("hashchange", render);
  el("login-form").addEventListener("submit", login);
  try {
    const session = await api("/api/auth/session");
    state.csrf = session.csrf_token;
    showApp();
    await render();
  } catch {
    showLogin();
  }
}

boot();
`;
