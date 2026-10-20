import { THEME_TOKENS } from "./theme.js";
import { WEBUI_STYLES } from "./styles.js";
import {
  WEBUI_CORE,
  WEBUI_MONITOR_PAGES,
  WEBUI_SETTINGS_PAGES,
} from "./script.js";

// The WebUI application script. It is assembled from the shared helpers, the
// monitor pages and the settings pages, and inlined so the whole UI ships as
// one self-contained HTML document.
export const WEBUI_SCRIPT = `${WEBUI_CORE}${WEBUI_MONITOR_PAGES}${WEBUI_SETTINGS_PAGES}`;

// The WebUI markup. The document is self-contained: the stylesheet and the
// script are inlined, so the Node build can embed it as a string and the
// Worker can serve it from its bundle.
const WEBUI_BODY = `
<div id="login" class="hidden">
  <div class="card">
    <h1>OpenCode2API</h1>
    <p>Sign in to the control panel.</p>
    <form id="login-form">
      <div class="field">
        <label for="login-user">Username</label>
        <input id="login-user" value="admin" autocomplete="username">
      </div>
      <div class="field">
        <label for="login-pass">Password</label>
        <input id="login-pass" type="password" autocomplete="current-password">
      </div>
      <button class="primary" type="submit" style="width:100%">Sign in</button>
    </form>
  </div>
</div>

<div id="app" class="hidden">
  <div id="layout">
    <aside id="sidebar">
      <div id="brand"><span class="dot"></span>OpenCode2API</div>
      <nav id="nav"></nav>
    </aside>
    <main id="content"></main>
  </div>
</div>

<div id="toast"></div>
`;

// buildWebUIHTML renders the complete WebUI document.
export function buildWebUIHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>OpenCode2API Control Panel</title>
<style>
${THEME_TOKENS}
${WEBUI_STYLES}
</style>
</head>
<body>
${WEBUI_BODY}
<script>
${WEBUI_SCRIPT}
</script>
</body>
</html>
`;
}

// The WebUI document, built once at module load so the server can serve it
// without rebuilding it on every request.
export const WEBUI_HTML = buildWebUIHTML();
