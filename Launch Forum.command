#!/bin/bash

# Go to the Forum project folder
cd "$(dirname "$0")"

echo "=============================="
echo "  Forum Bot Launcher"
echo "=============================="
echo ""

# Refresh main from GitHub (hard-reset so a server-side merge / diverged
# history never stalls the launch the way a plain `git pull` would).
echo "Refreshing main from GitHub..."
if git fetch origin main; then
  git checkout main 2>/dev/null
  git reset --hard origin/main
  echo "main is up to date with origin."
else
  echo "WARNING: could not reach GitHub — launching with the local copy."
fi
echo ""

# ── Locate Node/npm ──────────────────────────────────────────────────────────
# A .command file launched from Finder runs in a non-login, non-interactive
# shell that does NOT read ~/.zshrc or ~/.zprofile — so PATH additions from
# nvm / Homebrew / fnm / Volta / asdf are missing and `npm` isn't found (while
# `git`, in /usr/bin, still works). Re-create the parts of those setups we need.
if ! command -v npm >/dev/null 2>&1; then
  # Static install locations: Homebrew (arm64 + intel), official .pkg, Volta, asdf.
  for dir in /opt/homebrew/bin /usr/local/bin "$HOME/.volta/bin" "$HOME/.asdf/shims"; do
    [ -d "$dir" ] && PATH="$dir:$PATH"
  done
  # nvm: source it and select the default (or newest) version.
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    export NVM_DIR="$HOME/.nvm"
    . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
    nvm use default >/dev/null 2>&1 || nvm use node >/dev/null 2>&1
  fi
  # nvm fallback (no sourcing): add the newest installed version's bin directly.
  if ! command -v npm >/dev/null 2>&1 && [ -d "$HOME/.nvm/versions/node" ]; then
    newest="$(ls -1 "$HOME/.nvm/versions/node" 2>/dev/null | sort -V | tail -1)"
    [ -n "$newest" ] && PATH="$HOME/.nvm/versions/node/$newest/bin:$PATH"
  fi
  # fnm: load its environment if the binary is now reachable.
  if ! command -v npm >/dev/null 2>&1 && command -v fnm >/dev/null 2>&1; then
    eval "$(fnm env)" >/dev/null 2>&1
  fi
  export PATH
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: Could not find 'npm'. Node.js is either not installed, or it's in"
  echo "a location this launcher doesn't know about."
  echo ""
  echo "Fix: install Node from https://nodejs.org (the macOS .pkg installer puts"
  echo "npm on the default PATH), then run this launcher again."
  echo ""
  echo "If npm DOES work in your normal Terminal, run this there and tell me the output:"
  echo "    which node npm"
  echo ""
  echo "Press any key to close."
  read -n 1 -s
  exit 1
fi

# Install any new dependencies
echo "Checking dependencies..."
npm install --silent
echo ""

# Start the API server in the background
echo "Starting API server..."
npm run start &
SERVER_PID=$!

# Give the server a moment to start
sleep 2

# Start Vite dev server in the background
echo "Starting frontend..."
npm run dev &
VITE_PID=$!

# Give Vite a moment to start
sleep 3

# Open the browser
echo ""
echo "Opening browser..."
open http://localhost:5173

echo ""
echo "=============================="
echo "  Forum is running!"
echo "  http://localhost:5173"
echo ""
echo "  Close this window to stop."
echo "=============================="

# Wait — keep window open so servers stay alive
# Closing the Terminal window will stop both servers
wait
