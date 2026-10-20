// The WebUI stylesheet. The layout is a fixed sidebar beside a scrolling
// content column, and every primitive mirrors the greyscale dark tokens.
export const WEBUI_STYLES = `
* { box-sizing: border-box; margin: 0; padding: 0; }

html, body {
  height: 100%;
  background: var(--bg);
  color: var(--text-1);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Microsoft YaHei", Roboto, Helvetica, Arial, sans-serif;
  font-size: var(--fs-md);
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}

a { color: var(--text-1); text-decoration: none; }
a:hover { color: var(--inverse-hover); }

code, pre, .mono {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
    "Liberation Mono", monospace;
  font-size: var(--fs-sm);
}

#layout { display: flex; min-height: 100%; }

#sidebar {
  width: var(--sidebar-w);
  flex: 0 0 var(--sidebar-w);
  background: var(--surface);
  border-right: 1px solid var(--border-1);
  padding: var(--sp-5) var(--sp-3);
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
}

#brand {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 0 var(--sp-3) var(--sp-5);
  font-size: var(--fs-lg);
  font-weight: 600;
  letter-spacing: -0.01em;
}

#brand .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-1);
}

.nav-group { margin-bottom: var(--sp-5); }
.nav-group h3 {
  font-size: var(--fs-xs);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-3);
  padding: 0 var(--sp-3) var(--sp-2);
}

.nav-item {
  display: block;
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-md);
  color: var(--text-2);
  font-size: var(--fs-sm);
  cursor: pointer;
  border: 1px solid transparent;
}

.nav-item:hover { background: var(--bg-subtle); color: var(--text-1); }
.nav-item.active {
  background: var(--surface-2);
  color: var(--text-1);
  border-color: var(--border-1);
}

#content {
  flex: 1 1 auto;
  max-width: var(--content-max);
  padding: var(--sp-8) var(--sp-8) var(--sp-12);
  min-width: 0;
}

.page-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-4);
  margin-bottom: var(--sp-6);
  flex-wrap: wrap;
}

.page-head h1 { font-size: var(--fs-2xl); font-weight: 600; letter-spacing: -0.02em; }
.page-head p { color: var(--text-3); font-size: var(--fs-sm); }

.card {
  background: var(--surface);
  border: 1px solid var(--border-1);
  border-radius: var(--r-lg);
  padding: var(--sp-5);
  margin-bottom: var(--sp-4);
}

.card h2 {
  font-size: var(--fs-lg);
  font-weight: 600;
  margin-bottom: var(--sp-4);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--sp-4);
}

.stat {
  background: var(--surface);
  border: 1px solid var(--border-1);
  border-radius: var(--r-lg);
  padding: var(--sp-4) var(--sp-5);
}

.stat .label {
  color: var(--text-3);
  font-size: var(--fs-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: var(--sp-2);
}

.stat .value { font-size: var(--fs-3xl); font-weight: 600; letter-spacing: -0.03em; }
.stat .sub { color: var(--text-3); font-size: var(--fs-xs); margin-top: var(--sp-1); }

table { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
th {
  text-align: left;
  font-weight: 500;
  color: var(--text-3);
  font-size: var(--fs-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: var(--sp-2) var(--sp-3);
  border-bottom: 1px solid var(--border-1);
}
td { padding: var(--sp-3); border-bottom: 1px solid var(--border-1); }
tr:last-child td { border-bottom: none; }
tbody tr:hover { background: var(--bg-subtle); }

button, .btn {
  appearance: none;
  border: 1px solid var(--border-2);
  background: var(--surface-2);
  color: var(--text-1);
  border-radius: var(--r-md);
  padding: var(--sp-2) var(--sp-4);
  font-size: var(--fs-sm);
  font-family: inherit;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}

button:hover, .btn:hover { background: var(--bg-subtle); border-color: var(--text-3); }
button:focus-visible, .btn:focus-visible, input:focus-visible,
select:focus-visible, textarea:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

button.primary {
  background: var(--inverse-bg);
  color: var(--inverse-text);
  border-color: var(--inverse-bg);
  font-weight: 500;
}
button.primary:hover { background: var(--inverse-hover); border-color: var(--inverse-hover); }
button.ghost { background: transparent; border-color: var(--border-1); }
button:disabled { opacity: 0.5; cursor: not-allowed; }

input, select, textarea {
  width: 100%;
  background: var(--surface-2);
  border: 1px solid var(--border-2);
  border-radius: var(--r-md);
  color: var(--text-1);
  padding: var(--sp-2) var(--sp-3);
  font-size: var(--fs-sm);
  font-family: inherit;
}

textarea { min-height: 140px; resize: vertical; font-family: inherit; }
input::placeholder, textarea::placeholder { color: var(--text-3); }

.field { margin-bottom: var(--sp-4); }
.field label {
  display: block;
  font-size: var(--fs-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-3);
  margin-bottom: var(--sp-2);
}
.field .hint { color: var(--text-3); font-size: var(--fs-xs); margin-top: var(--sp-1); }

.row { display: flex; gap: var(--sp-3); flex-wrap: wrap; align-items: center; }
.row > * { flex: 1 1 200px; }
.row > .shrink { flex: 0 0 auto; }

.badge {
  display: inline-block;
  padding: 1px var(--sp-2);
  border-radius: var(--r-sm);
  font-size: var(--fs-xs);
  border: 1px solid var(--border-2);
  color: var(--text-2);
  white-space: nowrap;
}

.badge.ok { color: var(--ok); border-color: var(--ok); }
.badge.warn { color: var(--warn); border-color: var(--warn); background: var(--warn-bg); }
.badge.bad { color: var(--bad); border-color: var(--bad); background: var(--bad-bg); }

#toast {
  position: fixed;
  right: var(--sp-6);
  bottom: var(--sp-6);
  background: var(--surface);
  border: 1px solid var(--border-2);
  border-radius: var(--r-md);
  padding: var(--sp-3) var(--sp-5);
  font-size: var(--fs-sm);
  max-width: 380px;
  display: none;
  z-index: 40;
}

#toast.show { display: block; }
#toast.error { border-color: var(--bad); color: var(--bad); }

.log-line {
  display: grid;
  grid-template-columns: 92px 64px 1fr;
  gap: var(--sp-3);
  padding: var(--sp-1) 0;
  border-bottom: 1px solid var(--border-1);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: var(--fs-xs);
}

.log-line .time { color: var(--text-3); }
.log-line .level { text-transform: uppercase; }
.log-line .level.debug { color: var(--text-3); }
.log-line .level.info { color: var(--text-1); }
.log-line .level.warn { color: var(--warn); }
.log-line .level.error { color: var(--bad); }
.log-line .message { color: var(--text-2); word-break: break-word; }

#login {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sp-6);
}

#login .card { width: 100%; max-width: 380px; margin: 0; }
#login h1 { font-size: var(--fs-xl); margin-bottom: var(--sp-2); }
#login p { color: var(--text-3); font-size: var(--fs-sm); margin-bottom: var(--sp-5); }

.hidden { display: none !important; }

.bar {
  height: 6px;
  background: var(--surface-2);
  border-radius: 3px;
  overflow: hidden;
}
.bar > span { display: block; height: 100%; background: var(--text-2); }

.empty {
  color: var(--text-3);
  font-size: var(--fs-sm);
  padding: var(--sp-6);
  text-align: center;
}
`;
