// @ts-check
/**
 * Custom Node entry for Next.js + WebSocket proxy to Gemini Live.
 *
 * The browser connects to `/ws` on this server; we open an upstream WSS to
 * Google with the server-side `GEMINI_API_KEY` so the key never leaves the
 * host. Client frames received before the upstream is `OPEN` are buffered and
 * flushed on the `open` event - without that, the setup frame race-loses the
 * connection ~50% of the time on cold start.
 */

const fs = require("fs");
const http = require("http");
const path = require("path");
const { parse } = require("url");
const next = require("next");
const { WebSocketServer, WebSocket } = require("ws");
const { handleSttClient } = require("./lib/server/cloud-stt-bridge");
const { handleSttStreamClient } = require("./lib/server/cloud-stt-stream");

// ----------------------------------------------------------------------------
// .env.local loader
// ----------------------------------------------------------------------------
// PowerShell `Set-Content` defaults to UTF-16 LE with BOM; `Out-File` also
// writes UTF-16. Either format breaks `dotenv`. We parse manually so the user
// can create the file with any common Windows tool.
function loadDotenv() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) {
    console.warn("[Env] No .env.local found, using process.env only");
    return;
  }
  const buf = fs.readFileSync(envPath);
  let raw;
  if (buf[0] === 0xff && buf[1] === 0xfe) {
    raw = buf.slice(2).toString("utf16le");
  } else if (buf[0] === 0xfe && buf[1] === 0xff) {
    raw = buf.slice(2).swap16().toString("utf16le");
  } else {
    raw = buf.toString("utf8").replace(/^﻿/, "");
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.trim().match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  console.log(
    "[Env] .env.local loaded, GEMINI_API_KEY present:",
    !!process.env.GEMINI_API_KEY,
  );
}
loadDotenv();

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------
const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3001", 10);
const hostname = process.env.HOSTNAME || "0.0.0.0";

const GEMINI_WS_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// ----------------------------------------------------------------------------
// Wire it up
// ----------------------------------------------------------------------------
// The old user-side HTTP Basic Auth gate (client requirement 2026-06-21 No.2)
// is REMOVED: mobile OSes suspend the tab and evict the Basic Auth credential,
// forcing a re-prompt on resume. Login sessions are handled in Next.js.
app.prepare().then(() => {
  const server = http.createServer((req, res) => {
    const parsed = parse(req.url || "/", true);
    const pathname = parsed.pathname || "/";
    // Liveness probe - always open. CI smoke tests and prod healthchecks hit
    // this without credentials, so it must answer immediately.
    if (pathname === "/healthz") {
      res.statusCode = 200;
      res.end("ok");
      return;
    }
    handle(req, res, parsed);
  });

  const wss = new WebSocketServer({ noServer: true });
  wss.on("connection", handleClient);

  // Separate WSS for Cloud STT so the two upgrade handlers don't share a
  // `connection` listener (different protocols, different teardown rules).
  const sttWss = new WebSocketServer({ noServer: true });
  sttWss.on("connection", handleSttClient);

  // v2 streaming STT bridge (案1 real-time interim + language auto-detect).
  const sttStreamWss = new WebSocketServer({ noServer: true });
  sttStreamWss.on("connection", handleSttStreamClient);

  // Only proxy /ws, /ws/stt, /ws/stt-v2; Next.js HMR upgrades fall through.
  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url || "/");
    if (pathname === "/ws/stt-v2") {
      sttStreamWss.handleUpgrade(req, socket, head, (ws) => {
        sttStreamWss.emit("connection", ws, req);
      });
    } else if (pathname === "/ws/stt") {
      sttWss.handleUpgrade(req, socket, head, (ws) => {
        sttWss.emit("connection", ws, req);
      });
    } else if (pathname === "/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    }
  });

  server.listen(port, hostname, () => {
    console.log(
      `[ai-assistant-web] ready on http://127.0.0.1:${port} (bind ${hostname})`,
    );
  });
});

/**
 * RFC 6455 reserves codes 1005 (no status), 1006 (abnormal closure), and 1015
 * (TLS handshake) - these MUST NOT appear on the wire. The browser may pass
 * them via `WebSocket.onclose`; `ws` will throw if we forward them to
 * `upstream.close()`. Fall back to 1000 ("normal").
 *
 * @param {number|undefined} code
 * @returns {number}
 */
function sanitizeCloseCode(code) {
  if (typeof code !== "number") return 1000;
  if (code < 1000 || code > 4999) return 1000;
  if (code === 1005 || code === 1006 || code === 1015) return 1000;
  return code;
}

/**
 * @param {import('ws').WebSocket} clientWs
 */
function handleClient(clientWs) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("[WsProxy] GEMINI_API_KEY not set - rejecting client");
    clientWs.close(1008, "Server not configured");
    return;
  }

  const upstream = new WebSocket(`${GEMINI_WS_URL}?key=${apiKey}`);

  // Buffer C->S frames received before upstream opens. The first frame is the
  // setup; if we drop it the server idles and eventually closes 1006.
  /** @type {Array<import('ws').RawData>} */
  const pending = [];

  upstream.on("open", () => {
    if (pending.length > 0) {
      console.log(
        `[WsProxy] upstream open, flushing ${pending.length} buffered frame(s)`,
      );
      for (const data of pending) upstream.send(data);
      pending.length = 0;
    }
  });

  clientWs.on("message", (data) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data);
    } else if (upstream.readyState === WebSocket.CONNECTING) {
      pending.push(data);
    }
  });

  upstream.on("message", (data) => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
  });

  clientWs.on("close", (code, reason) => {
    upstream.close(sanitizeCloseCode(code), reason.toString());
  });
  upstream.on("close", (code, reason) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(sanitizeCloseCode(code), reason.toString());
    }
  });

  clientWs.on("error", (err) => {
    console.error("[WsProxy] client error:", err.message);
    upstream.close();
  });
  upstream.on("error", (err) => {
    console.error("[WsProxy] upstream error:", err.message);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(1011, "Upstream error");
    }
  });
}
