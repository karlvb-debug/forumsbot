#!/bin/bash

# Go to the Forum project folder
cd "$(dirname "$0")"

echo "=============================="
echo "  Forum — Electron Builder"
echo "=============================="
echo ""

# ── Locate Node/npm ──────────────────────────────────────────────────────────
if ! command -v npm >/dev/null 2>&1; then
  for dir in /opt/homebrew/bin /usr/local/bin "$HOME/.volta/bin" "$HOME/.asdf/shims"; do
    [ -d "$dir" ] && PATH="$dir:$PATH"
  done
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    export NVM_DIR="$HOME/.nvm"
    . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
    nvm use default >/dev/null 2>&1 || nvm use node >/dev/null 2>&1
  fi
  if ! command -v npm >/dev/null 2>&1 && [ -d "$HOME/.nvm/versions/node" ]; then
    newest="$(ls -1 "$HOME/.nvm/versions/node" 2>/dev/null | sort -V | tail -1)"
    [ -n "$newest" ] && PATH="$HOME/.nvm/versions/node/$newest/bin:$PATH"
  fi
  if ! command -v npm >/dev/null 2>&1 && command -v fnm >/dev/null 2>&1; then
    eval "$(fnm env)" >/dev/null 2>&1
  fi
  export PATH
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: Could not find 'npm'. Node.js is either not installed, or it's in"
  echo "a location this script doesn't know about."
  echo ""
  echo "Fix: install Node from https://nodejs.org (the macOS .pkg installer puts"
  echo "npm on the default PATH), then run this script again."
  echo ""
  echo "Press any key to close."
  read -n 1 -s
  exit 1
fi

echo "Node: $(node --version)   npm: $(npm --version)"
echo ""

# ── Pull latest from GitHub ──────────────────────────────────────────────────
echo "Fetching latest code from GitHub (main)..."
if git fetch origin main; then
  git checkout main 2>/dev/null
  git reset --hard origin/main
  echo "Up to date with origin/main."
else
  echo "WARNING: Could not reach GitHub — building from local copy."
fi
echo ""

# ── Install dependencies ─────────────────────────────────────────────────────
echo "Installing dependencies..."
npm install
echo ""

# ── Vite production build ────────────────────────────────────────────────────
echo "Building frontend (Vite)..."
npm run build
if [ $? -ne 0 ]; then
  echo ""
  echo "ERROR: Vite build failed. Fix the errors above and try again."
  echo ""
  echo "Press any key to close."
  read -n 1 -s
  exit 1
fi
echo ""

# ── macOS build (dmg) ────────────────────────────────────────────────────────
echo "=============================="
echo "  Building macOS app (dmg)..."
echo "=============================="
npx electron-builder --mac
MAC_STATUS=$?
echo ""

# ── Windows build (nsis) ─────────────────────────────────────────────────────
echo "=============================="
echo "  Building Windows app (exe)..."
echo "=============================="
echo ""
echo "NOTE: Building Windows installers from macOS requires Wine."
echo "If Wine is not installed, this step will fail — that is expected."
echo "Install Wine via Homebrew:  brew install --cask wine-stable"
echo ""
npx electron-builder --win
WIN_STATUS=$?
echo ""

# ── Summary ──────────────────────────────────────────────────────────────────
echo "=============================="
echo "  Build complete"
echo "=============================="
echo ""

if [ $MAC_STATUS -eq 0 ]; then
  echo "  macOS:   release/ (dmg)  ✓"
else
  echo "  macOS:   FAILED (exit $MAC_STATUS)"
fi

if [ $WIN_STATUS -eq 0 ]; then
  echo "  Windows: release/ (exe)  ✓"
else
  echo "  Windows: FAILED (exit $WIN_STATUS)"
  echo "           (Wine not installed = expected on a fresh Mac)"
fi

echo ""
echo "Output files are in the 'release/' folder next to this script."
echo ""

# Open the release folder in Finder if it exists
if [ -d "release" ]; then
  open release/
fi

echo "Press any key to close."
read -n 1 -s
