#!/bin/sh
# Runs at container start (nginx image runs every script in /docker-entrypoint.d/).
# Writes /config.js so the browser knows where the API is:
#   API_BASE=""                       -> same origin (default; ALB routes /api/* to api-gateway)
#   API_BASE="http://localhost:8080"  -> local testing against a gateway on another port
set -eu

TARGET=/usr/share/nginx/html/config.js
# Escape \ and " so the value is a safe JavaScript string.
ESCAPED=$(printf '%s' "${API_BASE:-}" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')
printf 'window.PAYLAB_API_BASE = "%s";\n' "$ESCAPED" > "$TARGET"

echo "$0: wrote $TARGET (API_BASE=\"${API_BASE:-}\")"
