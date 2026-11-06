#!/usr/bin/env bash
# ============================================================
# run.sh - Lance un serveur local pour tester le portail
#          (site + donnees JSON + PWA / offline).
#
# Usage :
#   ./run.sh                 # port 8000, ouvre le navigateur
#   ./run.sh 9000            # port personnalise
#   ./run.sh 9000 --no-open  # sans ouvrir le navigateur
#
# Le serveur envoie des en-tetes "no-cache" pour que vous voyiez
# toujours la derniere version des fichiers pendant les tests.
# ============================================================

set -euo pipefail

PORT="8000"
OPEN_BROWSER=1

for arg in "$@"; do
  case "$arg" in
    --no-open|-n) OPEN_BROWSER=0 ;;
    ''|*[!0-9]*)  echo "Argument ignore : $arg" ;;
    *)            PORT="$arg" ;;
  esac
done

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Lancer le serveur JavaScript (Node.js) ---
if command -v node >/dev/null 2>&1; then
  exec node "$DIR/server.js" "$PORT"
fi

# --- Replit de secours Python si Node.js n'est pas installé ---
if command -v python3 >/dev/null 2>&1; then
  PY="python3"
elif command -v python >/dev/null 2>&1 && python --version 2>&1 | grep -q "Python 3"; then
  PY="python"
else
  echo "Erreur : Node.js (recommandé) ou Python 3 est requis pour lancer le serveur local."
  exit 1
fi

exec "$PY" - "$PORT" "$DIR" <<'PYEOF'
import http.server
import socketserver
import sys
import os
import json
import time
import threading
import urllib.parse

try:
    port = int(sys.argv[1])
except (IndexError, ValueError):
    port = 8000
directory = sys.argv[2] if len(sys.argv) > 2 else os.getcwd()

# Relais LAN en mémoire pour le multijoueur local (100% hors-ligne)
RELAY_STORE = {}
RELAY_LOCK = threading.Lock()
RELAY_NOTIFY = threading.Condition(RELAY_LOCK)
RELAY_MSG_ID = 0

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=directory, **kwargs)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Cache-Control")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def do_POST(self):
        global RELAY_MSG_ID
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path.startswith("/api/relay/"):
            topic = path[len("/api/relay/"):].strip("/")
            content_length = int(self.headers.get("Content-Length", 0))
            body_bytes = self.rfile.read(content_length)
            body_str = body_bytes.decode("utf-8", errors="replace")

            with RELAY_NOTIFY:
                RELAY_MSG_ID += 1
                msg_entry = {
                    "id": str(RELAY_MSG_ID),
                    "time": time.time(),
                    "message": body_str
                }
                if topic not in RELAY_STORE:
                    RELAY_STORE[topic] = []
                RELAY_STORE[topic].append(msg_entry)
                if len(RELAY_STORE[topic]) > 200:
                    RELAY_STORE[topic] = RELAY_STORE[topic][-200:]
                RELAY_NOTIFY.notify_all()

            resp = json.dumps({"ok": True, "id": str(RELAY_MSG_ID)}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(resp)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(resp)
            return

        super().do_POST()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/relay/ping" or path == "/api/relay":
            resp = json.dumps({"ok": True, "server": "qfr2-lan-relay"}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(resp)
            return

        if path.startswith("/api/relay/"):
            subpath = path[len("/api/relay/"):].strip("/")
            is_sse = subpath.endswith("/sse")
            topic = subpath[:-4] if is_sse else subpath

            if is_sse:
                # Mode Server-Sent Events (SSE)
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                self.send_header("Cache-Control", "no-cache, no-transform")
                self.send_header("Connection", "keep-alive")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()

                last_seen_id = 0
                now = time.time()
                with RELAY_LOCK:
                    msgs = [m for m in RELAY_STORE.get(topic, []) if now - m["time"] < 120]
                    if msgs:
                        last_seen_id = int(msgs[-1]["id"])

                try:
                    for m in msgs:
                        payload = json.dumps({"event": "message", "id": m["id"], "message": m["message"]})
                        self.wfile.write(f"data: {payload}\n\n".encode("utf-8"))
                        self.wfile.flush()

                    while True:
                        new_msgs = []
                        with RELAY_NOTIFY:
                            RELAY_NOTIFY.wait(timeout=10.0)
                            all_t = RELAY_STORE.get(topic, [])
                            new_msgs = [m for m in all_t if int(m["id"]) > last_seen_id]
                            if new_msgs:
                                last_seen_id = int(new_msgs[-1]["id"])

                        if new_msgs:
                            for m in new_msgs:
                                payload = json.dumps({"event": "message", "id": m["id"], "message": m["message"]})
                                self.wfile.write(f"data: {payload}\n\n".encode("utf-8"))
                                self.wfile.flush()
                        else:
                            self.wfile.write(b": keepalive\n\n")
                            self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError, OSError):
                    pass
                return

            else:
                # Mode polling JSON
                query = urllib.parse.parse_qs(parsed.query)
                since_id = int(query.get("since", [0])[0]) if query.get("since") else 0
                with RELAY_LOCK:
                    msgs = [m for m in RELAY_STORE.get(topic, []) if int(m["id"]) > since_id]
                resp = json.dumps({"messages": msgs}).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(resp)
                return

        super().do_GET()

    def end_headers(self):
        # Empeche le navigateur de mettre en cache pendant les tests
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # N'affiche pas les pings de relais pour garder la console lisible
        if "/api/relay/" in (args[0] if args else ""):
            return
        sys.stderr.write("  " + (fmt % args) + "\n")


Handler.extensions_map.update({
    ".json": "application/json",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".svg": "image/svg+xml",
    ".webmanifest": "application/manifest+json",
})


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


try:
    with Server(("", port), Handler) as httpd:
        print("  Serveur actif sur le port %d  (Ctrl+C pour arreter)" % port)
        print("  Relais multijoueur LAN actif sur /api/relay/\n")
        httpd.serve_forever()
except KeyboardInterrupt:
    print("\n  Serveur arrete.")
except OSError as exc:
    print("\n  Impossible de demarrer le serveur : %s" % exc)
    if getattr(exc, "errno", None) in (48, 98):
        print("  Le port %d est deja utilise. Essayez : ./run.sh 8001" % port)
    sys.exit(1)
PYEOF
