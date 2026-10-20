// The shared state, the navigation and the helpers every page uses.
export const WEBUI_CORE = `
const state = { csrf: "", page: "overview", config: null, monitor: null };

const PAGES = [
  { group: "Monitor", id: "overview", label: "Overview" },
  { group: "Monitor", id: "models", label: "Models" },
  { group: "Monitor", id: "keys", label: "API Keys" },
  { group: "Monitor", id: "quota", label: "Quota" },
  { group: "Tools", id: "playground", label: "Playground" },
  { group: "Tools", id: "rotation", label: "Rotation" },
  { group: "Settings", id: "config", label: "Configuration" },
  { group: "Settings", id: "account", label: "Account" },
  { group: "Settings", id: "logs", label: "Logs" },
];

const el = (id) => document.getElementById(id);

function toast(message, isError) {
  const node = el("toast");
  node.textContent = message;
  node.className = "show" + (isError ? " error" : "");
  clearTimeout(node._timer);
  node._timer = setTimeout(() => { node.className = ""; }, 4000);
}

async function api(path, options) {
  const settings = Object.assign({ credentials: "same-origin" }, options || {});
  settings.headers = Object.assign(
    { "Content-Type": "application/json" },
    settings.headers || {},
  );
  if (state.csrf && settings.method && settings.method !== "GET") {
    settings.headers["X-CSRF-Token"] = state.csrf;
  }
  const response = await fetch(path, settings);
  if (response.status === 401) {
    showLogin();
    throw new Error("session expired");
  }
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  if (!response.ok) {
    const message = payload && payload.error
      ? payload.error.message
      : "request failed with HTTP " + response.status;
    throw new Error(message);
  }
  return payload;
}

function showLogin() {
  el("app").classList.add("hidden");
  el("login").classList.remove("hidden");
}

function showApp() {
  el("login").classList.add("hidden");
  el("app").classList.remove("hidden");
}

function renderNav() {
  const groups = [];
  for (const page of PAGES) {
    let group = groups.find((entry) => entry.name === page.group);
    if (!group) {
      group = { name: page.group, items: [] };
      groups.push(group);
    }
    group.items.push(page);
  }
  el("nav").innerHTML = groups.map((group) => (
    '<div class="nav-group"><h3>' + group.name + '</h3>' +
    group.items.map((page) => (
      '<a class="nav-item" data-page="' + page.id + '">' + page.label + '</a>'
    )).join("") +
    '</div>'
  )).join("");
  for (const node of document.querySelectorAll(".nav-item")) {
    node.addEventListener("click", () => {
      location.hash = "#" + node.dataset.page;
    });
  }
}

function markActive() {
  for (const node of document.querySelectorAll(".nav-item")) {
    node.classList.toggle("active", node.dataset.page === state.page);
  }
}

function fmt(n) {
  if (n === undefined || n === null) return "0";
  return Number(n).toLocaleString("en-US");
}

function pct(value) {
  return (Math.round(value * 1000) / 10).toFixed(1) + "%";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stat(label, value, sub) {
  return '<div class="stat"><div class="label">' + escapeHtml(label) +
    '</div><div class="value">' + escapeHtml(value) +
    '</div><div class="sub">' + escapeHtml(sub) + '</div></div>';
}
`;
