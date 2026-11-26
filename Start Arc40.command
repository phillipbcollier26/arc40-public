#!/bin/bash
# Double-click this file in Finder to start Arc40.
# It installs/updates what it needs, starts the app, and opens your browser.
# To stop Arc40: close this Terminal window (or press Control+C in it).

cd "$(dirname "$0")" || exit 1
PORT="${ARC40_PORT:-4040}"
URL="http://127.0.0.1:${PORT}"

pause_and_exit() {
  echo ""
  read -n 1 -s -r -p "Press any key to close this window."
  exit 1
}

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install the LTS version from https://nodejs.org, then try again."
  pause_and_exit
fi

# Already running? Just open the browser.
if curl -fsS "${URL}/api/health" 2>/dev/null | grep -q '"arc40"'; then
  echo "Arc40 is already running. Opening your browser..."
  open "${URL}"
  exit 0
fi

# Install packages the first time, and again whenever package-lock.json changes.
STAMP="node_modules/.arc40-lock-hash"
LOCK_HASH="$(shasum package-lock.json | cut -d ' ' -f 1)"
if [ ! -f "${STAMP}" ] || [ "$(cat "${STAMP}")" != "${LOCK_HASH}" ]; then
  echo "Installing Arc40's packages (first run or after an update). This can take a minute..."
  npm ci --no-audit --no-fund || pause_and_exit
  echo "${LOCK_HASH}" > "${STAMP}"
fi

# Rebuild the web page when its source has changed since the last build.
if [ ! -f web/dist/index.html ] || \
   [ -n "$(find web/src web/index.html web/public vite.config.ts -newer web/dist/index.html -print -quit)" ]; then
  echo "Building the Arc40 interface..."
  npm run build --silent || pause_and_exit
fi

# Open the browser as soon as the server answers.
(
  for _ in $(seq 1 60); do
    if curl -fsS "${URL}/api/health" >/dev/null 2>&1; then
      open "${URL}"
      exit 0
    fi
    sleep 0.5
  done
) &

npm start --silent || pause_and_exit
