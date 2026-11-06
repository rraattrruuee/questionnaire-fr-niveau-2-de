#!/usr/bin/env node
/* ============================================================
   server.js — Serveur local 100% JavaScript (Node.js pur, 0 dépendance)
   Sert les fichiers du site et intègre le relais LAN multijoueur.
   Usage : node server.js [port]
   ============================================================ */

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const os = require("os");

const PORT = parseInt(process.argv[2] || process.env.PORT || "8000", 10);
const ROOT_DIR = __dirname;

// In-memory relay store for LAN multiplayer
// topic -> [{ id, time, message }]
const RELAY_STORE = new Map();
let RELAY_MSG_ID = 0;
// topic -> Set of response objects (SSE)
const SSE_CLIENTS = new Map();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json"
};

function getLanIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "";
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Cache-Control");
  res.setHeader("Access-Control-Max-Age", "86400");
}

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  let pathname = decodeURIComponent(parsedUrl.pathname);

  // Preflight CORS
  if (req.method === "OPTIONS") {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // --- API RELAIS LAN (100% JavaScript) ---
  if (pathname === "/api/relay/ping" || pathname === "/api/relay") {
    setCorsHeaders(res);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, server: "qfr2-node-relay" }));
    return;
  }

  if (pathname.startsWith("/api/relay/")) {
    setCorsHeaders(res);
    const subpath = pathname.slice("/api/relay/".length).replace(/\/+$/, "");
    const isSse = subpath.endsWith("/sse");
    const topic = isSse ? subpath.slice(0, -4) : subpath;

    if (req.method === "POST") {
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", () => {
        RELAY_MSG_ID++;
        const entry = { id: String(RELAY_MSG_ID), time: Date.now(), message: body };
        if (!RELAY_STORE.has(topic)) RELAY_STORE.set(topic, []);
        const list = RELAY_STORE.get(topic);
        list.push(entry);
        if (list.length > 200) list.shift();

        // Broadcast aux clients SSE abonnés
        const clients = SSE_CLIENTS.get(topic);
        if (clients && clients.size > 0) {
          const payload = JSON.stringify({ event: "message", id: entry.id, message: entry.message });
          const rawSse = `data: ${payload}\n\n`;
          for (const clientRes of clients) {
            try { clientRes.write(rawSse); } catch (e) {}
          }
        }

        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, id: String(RELAY_MSG_ID) }));
      });
      return;
    }

    if (req.method === "GET") {
      if (isSse) {
        // Mode Server-Sent Events (SSE)
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive"
        });

        if (!SSE_CLIENTS.has(topic)) SSE_CLIENTS.set(topic, new Set());
        const clients = SSE_CLIENTS.get(topic);
        clients.add(res);

        // Envoyer les messages récents (2 dernières minutes)
        const recent = (RELAY_STORE.get(topic) || []).filter(m => Date.now() - m.time < 120000);
        for (const m of recent) {
          const payload = JSON.stringify({ event: "message", id: m.id, message: m.message });
          res.write(`data: ${payload}\n\n`);
        }

        // Keepalive toutes les 15s
        const pingInterval = setInterval(() => {
          try { res.write(": keepalive\n\n"); } catch (e) {}
        }, 15000);

        req.on("close", () => {
          clearInterval(pingInterval);
          clients.delete(res);
          if (clients.size === 0) SSE_CLIENTS.delete(topic);
        });
        return;
      } else {
        // Mode Polling HTTP
        const sinceId = parseInt(parsedUrl.query.since || "0", 10);
        const all = RELAY_STORE.get(topic) || [];
        const msgs = all.filter(m => parseInt(m.id, 10) > sinceId);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ messages: msgs }));
        return;
      }
    }
  }

  // --- SERVEUR DE FICHIERS STATIQUES ---
  if (pathname === "/") pathname = "/index.html";
  const filePath = path.join(ROOT_DIR, pathname);

  // Sécurité traversée de dossier
  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403);
    res.end("403 Interdit");
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Non trouvé");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Pragma": "no-cache",
      "Expires": "0"
    });

    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  const lanIp = getLanIp();
  console.log("");
  console.log("============================================================");
  console.log("  Serveur Web & Relais Multijoueur LAN (100% JavaScript)");
  console.log("============================================================");
  console.log(`  Local   : http://localhost:${PORT}/`);
  if (lanIp) {
    console.log(`  Réseau  : http://${lanIp}:${PORT}/   (Wi-Fi, smartphone)`);
  }
  console.log(`  Relais  : http://localhost:${PORT}/api/relay/`);
  console.log("  Arrêt   : Ctrl+C");
  console.log("============================================================\n");
});
