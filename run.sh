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

# --- Detecter Python 3 ---
if command -v python3 >/dev/null 2>&1; then
  PY="python3"
elif command -v python >/dev/null 2>&1 && python --version 2>&1 | grep -q "Python 3"; then
  PY="python"
else
  echo "Erreur : Python 3 est requis pour lancer le serveur local."
  exit 1
fi

# --- Adresse reseau local (pour tester sur telephone) ---
detect_lan_ip() {
  local ip=""
  # Linux (iproute2) : adresse source de la route par defaut
  if command -v ip >/dev/null 2>&1; then
    ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')"
    [ -n "$ip" ] && { printf '%s' "$ip"; return 0; }
  fi
  # Linux (hostname -I, pas toujours supporte)
  if command -v hostname >/dev/null 2>&1; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')" || true
    [ -n "$ip" ] && { printf '%s' "$ip"; return 0; }
  fi
  # macOS
  if command -v ipconfig >/dev/null 2>&1; then
    ip="$(ipconfig getifaddr en0 2>/dev/null)" || true
    [ -n "$ip" ] && { printf '%s' "$ip"; return 0; }
  fi
  printf '%s' ""
}
LAN_IP="$(detect_lan_ip)"

echo ""
echo "============================================================"
echo "  Questionnaires 2nde - serveur de test local"
echo "============================================================"
echo "  Dossier : $DIR"
echo "  Local   : http://localhost:$PORT/"
if [ -n "$LAN_IP" ]; then
echo "  Reseau  : http://$LAN_IP:$PORT/   (meme Wi-Fi, telephone)"
fi
echo "  Arret   : Ctrl+C"
echo "============================================================"
echo ""

# --- Ouvrir le navigateur (au choix) ---
if [ "$OPEN_BROWSER" -eq 1 ]; then
  (
    sleep 1
    URL="http://localhost:$PORT/"
    if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 || true
    elif command -v open >/dev/null 2>&1; then open "$URL" >/dev/null 2>&1 || true
    elif command -v start >/dev/null 2>&1; then start "$URL" >/dev/null 2>&1 || true
    fi
  ) &
fi

# --- Serveur Python (no-cache) ---
exec "$PY" - "$PORT" "$DIR" <<'PYEOF'
import http.server
import socketserver
import sys
import os

try:
    port = int(sys.argv[1])
except (IndexError, ValueError):
    port = 8000
directory = sys.argv[2] if len(sys.argv) > 2 else os.getcwd()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=directory, **kwargs)

    def end_headers(self):
        # Empeche le navigateur de mettre en cache pendant les tests
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
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
        print("  Serveur actif sur le port %d  (Ctrl+C pour arreter)\n" % port)
        httpd.serve_forever()
except KeyboardInterrupt:
    print("\n  Serveur arrete.")
except OSError as exc:
    print("\n  Impossible de demarrer le serveur : %s" % exc)
    if getattr(exc, "errno", None) in (48, 98):
        print("  Le port %d est deja utilise. Essayez : ./run.sh 8001" % port)
    sys.exit(1)
PYEOF
