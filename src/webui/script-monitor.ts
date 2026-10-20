// The monitor pages of the control WebUI: the overview, the models, the
// local keys and the quota.
export const WEBUI_MONITOR_PAGES = `
async function loadOverview() {
  const data = await api("/api/monitor");
  state.monitor = data;
  const metrics = data.metrics || {};
  const lifetime = metrics.lifetime || {};
  const window = metrics.last_hour || {};
  const usage = metrics.usage || {};
  const upstream = metrics.upstream || {};
  el("content").innerHTML = (
    '<div class="page-head"><div><h1>Overview</h1>' +
    '<p>Live traffic, token usage and upstream health</p></div></div>' +
    '<div class="grid">' +
    stat("Total requests", fmt(lifetime.total), fmt(lifetime.errors) + " errors") +
    stat("Success rate", pct(lifetime.success_rate || 0), "lifetime") +
    stat("Active requests", fmt(metrics.active_requests), fmt(metrics.active_streams) + " streaming") +
    stat("Uptime", formatUptime(metrics.uptime_seconds), "since start") +
    stat("Input tokens", fmt(usageLifetime(usage, "input_tokens")), "lifetime") +
    stat("Output tokens", fmt(usageLifetime(usage, "output_tokens")), "lifetime") +
    stat("Last hour", fmt(window.total), "requests") +
    stat("Upstream attempts", fmt((upstream.lifetime || {}).total), "total") +
    '</div>' +
    '<div class="card"><h2>Requests per minute</h2>' +
    seriesChart(metrics.series || []) +
    '</div>' +
    '<div class="card"><h2>Models</h2>' +
    countTable(metrics.models || {}) +
    '</div>' +
    '<div class="card"><h2>Recent upstream requests</h2>' +
    upstreamTable(upstream.requests || []) +
    '</div>'
  );
}

function usageLifetime(usage, field) {
  const lifetime = usage.lifetime || {};
  const tokens = lifetime.tokens || {};
  return tokens[field] || 0;
}

function formatUptime(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return hours + "h " + minutes + "m";
  return minutes + "m " + (total % 60) + "s";
}

function seriesChart(series) {
  if (!series.length) return '<div class="empty">No traffic recorded yet</div>';
  const max = series.reduce((acc, point) => Math.max(acc, point.total), 0) || 1;
  const bars = series.slice(-30).map((point) => {
    const height = Math.round((point.total / max) * 100);
    const label = new Date(point.minute).toLocaleTimeString("en-US", {
      hour: "2-digit", minute: "2-digit",
    });
    return '<div title="' + escapeHtml(label) + ": " + point.total + " requests, " +
      point.errors + ' errors" style="flex:1 1 0;height:100%;display:flex;' +
      'flex-direction:column;justify-content:flex-end">' +
      '<div style="height:' + Math.max(height, 1) + '%;background:var(--text-2);' +
      'border-radius:2px 2px 0 0"></div></div>';
  }).join("");
  return '<div style="display:flex;align-items:flex-end;gap:2px;height:140px">' +
    bars + '</div>';
}

function countTable(counts) {
  const entries = Object.entries(counts || {});
  if (!entries.length) return '<div class="empty">No data yet</div>';
  entries.sort((a, b) => b[1] - a[1]);
  return '<table><thead><tr><th>Name</th><th>Count</th></tr></thead><tbody>' +
    entries.map(([name, count]) =>
      '<tr><td class="mono">' + escapeHtml(name) + '</td><td>' + fmt(count) + '</td></tr>'
    ).join("") + '</tbody></table>';
}

function upstreamTable(requests) {
  if (!requests.length) return '<div class="empty">No upstream requests yet</div>';
  return '<table><thead><tr><th>Time</th><th>Model</th><th>Tier</th>' +
    '<th>Status</th><th>Duration</th><th>Outcome</th></tr></thead><tbody>' +
    requests.slice().reverse().slice(0, 50).map((entry) =>
      '<tr><td class="mono">' + escapeHtml(new Date(entry.time).toLocaleTimeString()) +
      '</td><td class="mono">' + escapeHtml(entry.model) +
      '</td><td>' + escapeHtml(entry.tier || "-") +
      '</td><td>' + escapeHtml(entry.status) +
      '</td><td>' + fmt(entry.duration_ms) + " ms" +
      '</td><td>' + escapeHtml(entry.outcome || "-") + '</td></tr>'
    ).join("") + '</tbody></table>';
}

async function loadModels() {
  const data = await api("/api/debug/models");
  const models = data.models || [];
  const catalog = data.catalog || {};
  el("content").innerHTML = (
    '<div class="page-head"><div><h1>Models</h1>' +
    '<p>' + fmt(catalog.total) + " discovered, " + fmt(catalog.exposed) +
    " exposed" + (catalog.stale ? " (stale)" : "") + '</p></div></div>' +
    '<div class="card"><h2>Catalog</h2>' +
    '<div class="grid">' +
    stat("Zen models", fmt(catalog.zen), "") +
    stat("Go models", fmt(catalog.go), "") +
    stat("Total", fmt(catalog.total), "") +
    stat("Exposed", fmt(catalog.exposed), "") +
    '</div></div>' +
    '<div class="card"><h2>Routing</h2>' +
    modelsTable(models) +
    '</div>'
  );
}

function modelsTable(models) {
  if (!models.length) return '<div class="empty">No models discovered yet</div>';
  return '<table><thead><tr><th>Model</th><th>Protocol</th><th>Tier</th>' +
    '<th>Anonymous</th><th>Source</th><th>Error</th></tr></thead><tbody>' +
    models.map((entry) =>
      '<tr><td class="mono">' + escapeHtml(entry.model) +
      '</td><td>' + escapeHtml(entry.native_protocol || "-") +
      '</td><td>' + escapeHtml(entry.tier || "-") +
      '</td><td>' + (entry.anonymous ? "yes" : "no") +
      '</td><td>' + escapeHtml(entry.protocol_source || "-") +
      '</td><td>' + (entry.route_error
        ? '<span class="badge bad">' + escapeHtml(entry.route_error) + '</span>'
        : '<span class="badge ok">ok</span>') +
      '</td></tr>'
    ).join("") + '</tbody></table>';
}

async function loadKeys() {
  const data = await api("/api/api-keys");
  const keys = data.keys || [];
  el("content").innerHTML = (
    '<div class="page-head"><div><h1>API Keys</h1>' +
    '<p>Local keys your clients authenticate with</p></div>' +
    '<button class="primary shrink" id="create-key">Create key</button></div>' +
    '<div class="card"><h2>Keys</h2>' + keysTable(keys) + '</div>'
  );
  el("create-key").addEventListener("click", createKey);
}

function keysTable(keys) {
  if (!keys.length) return '<div class="empty">No keys configured</div>';
  return '<table><thead><tr><th>Name</th><th>Value</th><th>State</th>' +
    '<th>Requests</th><th>Created</th><th></th></tr></thead><tbody>' +
    keys.map((entry) =>
      '<tr><td>' + escapeHtml(entry.name) +
      '</td><td class="mono">' + escapeHtml(entry.display) +
      '</td><td>' + (entry.enabled
        ? '<span class="badge ok">enabled</span>'
        : '<span class="badge bad">disabled</span>') +
      '</td><td>' + fmt((entry.usage || {}).lifetime
        ? entry.usage.lifetime.requests : 0) +
      '</td><td class="mono">' + escapeHtml(
        entry.created_at ? new Date(entry.created_at).toLocaleDateString() : "-") +
      '</td><td><button class="ghost" data-toggle="' + escapeHtml(entry.id) +
      '">Toggle</button> ' +
      '<button class="ghost" data-delete="' + escapeHtml(entry.id) +
      '">Delete</button></td></tr>'
    ).join("") + '</tbody></table>';
}

async function createKey() {
  const name = prompt("Name for the new API key");
  if (!name) return;
  try {
    const result = await api("/api/api-keys", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    toast("Key created: " + result.key);
    await loadKeys();
  } catch (error) {
    toast(error.message, true);
  }
}

async function loadQuota() {
  const data = await api("/api/model-quotas");
  const accounts = data.accounts || [];
  el("content").innerHTML = (
    '<div class="page-head"><div><h1>Quota</h1>' +
    '<p>' + escapeHtml(data.note || "") + '</p></div></div>' +
    '<div class="card"><h2>Accounts</h2>' + quotaTable(accounts) + '</div>'
  );
}

function quotaTable(accounts) {
  if (!accounts.length) return '<div class="empty">No Go keys configured</div>';
  return '<table><thead><tr><th>Key</th><th>Status</th><th>Window</th>' +
    '<th>Used</th></tr></thead><tbody>' +
    accounts.map((entry) => {
      const windows = entry.windows || {};
      const rows = Object.keys(windows).map((name) => {
        const win = windows[name] || {};
        return "<tr><td>" + escapeHtml(entry.display) + '</td><td>' +
          escapeHtml(entry.status) + '</td><td>' + escapeHtml(name) +
          '</td><td>' + pct(win.used_percent || 0) + '</td></tr>';
      }).join("");
      return rows || '<tr><td>' + escapeHtml(entry.display) +
        '</td><td>' + escapeHtml(entry.status) + '</td><td>-</td><td>-</td></tr>';
    }).join("") + '</tbody></table>';
}
`;
