#!/usr/bin/env python3
# One-time migration: copies your current boards.json up into Firebase so the
# always-on server starts with all your real data (scripts, team, password).
#
# Usage (PowerShell):
#   $env:FIREBASE_DB_URL="https://your-db.firebaseio.com"
#   $env:FIREBASE_SECRET="your-database-secret"
#   python seed-firebase.py
import json, os, sys, urllib.request, urllib.parse

DB = os.environ.get("FIREBASE_DB_URL", "").rstrip("/")
AUTH = os.environ.get("FIREBASE_SECRET", "")
PATH = os.environ.get("FIREBASE_PATH", "scriptflow")
HERE = os.path.dirname(os.path.abspath(__file__))

if not DB:
    sys.exit("Set FIREBASE_DB_URL (and FIREBASE_SECRET) first.")

with open(os.path.join(HERE, "boards.json"), encoding="utf-8") as f:
    state = json.load(f)

url = f"{DB}/{PATH}.json"
if AUTH:
    url += "?auth=" + urllib.parse.quote(AUTH)

body = json.dumps(state, ensure_ascii=False).encode("utf-8")
req = urllib.request.Request(url, data=body, method="PUT",
                            headers={"Content-Type": "application/json"})
with urllib.request.urlopen(req, timeout=30) as r:
    r.read()

boards = state.get("boards", {})
total = sum(len(b.get("scripts", {})) for b in boards.values())
print(f"Uploaded {len(boards)} board(s), {total} scripts to Firebase. Done.")
