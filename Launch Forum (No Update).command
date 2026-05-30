#!/bin/bash

# Go to the Forum project folder
cd "$(dirname "$0")"

echo "=============================="
echo "  Forum Bot Launcher"
echo "  (No Update — local copy)"
echo "=============================="
echo ""

# NOTE: This launcher does NOT touch git. It runs whatever is currently
# checked out, without fetching, pulling, or resetting. Use it when working
# offline or when you don't want your local branch changed.

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
