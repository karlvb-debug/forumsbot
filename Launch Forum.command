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
