#!/bin/bash
# Double-click on macOS to start ScriptFlow. (You may need: right-click → Open the first time.)
cd "$(dirname "$0")"
if command -v python3 >/dev/null 2>&1; then
  python3 server.py
else
  echo "Python 3 not found. Install it from https://www.python.org/downloads/ and try again."
  read -n 1 -s -r -p "Press any key to close..."
fi
