#!/usr/bin/env python3
# ============================================================================
#  ScriptFlow live sync server  (v2)
#  Pure Python standard library — no pip installs, no accounts, no cloud.
#
#  Adds: multiple boards (channels), members + per-editor permissions,
#  activity log + notifications, profile pictures, and media uploads
#  (thumbnails / voiceovers / links) — all saved on this PC.
#
#  Reliability rule: the lock guards ONLY quick in-memory updates. Disk and
#  network writes happen outside the lock so nothing can freeze the board.
# ============================================================================

import json, os, threading, queue, time, socket, webbrowser, sys, base64, re, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(ROOT, "boards.json")
LEGACY_FILE = os.path.join(ROOT, "data.json")          # v1 single board
SEED_FILE = os.path.join(ROOT, "seed-data.json")
MEDIA_DIR = os.path.join(ROOT, "media")
PORT = int(os.environ.get("PORT", "8765"))

# ---- storage backend -------------------------------------------------------
# "file"     : save to boards.json on this PC (local double-click use)
# "firebase" : save to a Firebase Realtime Database in the cloud (always-on host)
DATA_BACKEND = os.environ.get("DATA_BACKEND", "file").lower()
FB_DB_URL = os.environ.get("FIREBASE_DB_URL", "").rstrip("/")
FB_AUTH = os.environ.get("FIREBASE_SECRET", "")
FB_PATH = os.environ.get("FIREBASE_PATH", "scriptflow")
USING_CLOUD = DATA_BACKEND == "firebase" and bool(FB_DB_URL)
# in the cloud, uploaded files live inline with the data (so they're durable too)
MAX_UPLOAD = (3 if USING_CLOUD else 25) * 1024 * 1024

LOCK = threading.Lock()
SAVE_LOCK = threading.Lock()
DIRTY = threading.Event()              # cloud writes are debounced via this flag
STATE = {"boards": {}}                 # boardId -> board dict
CLIENTS = []                           # list of (boardId, Queue)

DEFAULT_PERMS_EDIT = {"edit": True, "move": True, "del": False, "manage": False}
DEFAULT_PERMS_VIEW = {"edit": False, "move": False, "del": False, "manage": False}
OWNER_PERMS = {"edit": True, "move": True, "del": True, "manage": True}


# ---------------------------------------------------------------- persistence
def new_board(bid, name, scripts=None):
    return {
        "id": bid, "name": name,
        "ownerPin": "", "ownerName": "",
        "logo": "", "image": "", "password": "",
        "stageNames": {},
        "newMemberAccess": "edit",
        "scripts": scripts or {},
        "members": {},
        "activity": [],
    }


def board_unlocked(b, key):
    """A board with no password is always open; otherwise the key must match."""
    pw = (b or {}).get("password", "")
    return (not pw) or (str(key or "") == str(pw))


def _fb_url():
    import urllib.parse
    u = f"{FB_DB_URL}/{FB_PATH}.json"
    if FB_AUTH:
        u += "?auth=" + urllib.parse.quote(FB_AUTH)
    return u


def cloud_load():
    """Return the saved STATE dict from Firebase, or None if empty/unreachable."""
    import urllib.request
    with urllib.request.urlopen(_fb_url(), timeout=20) as r:
        raw = r.read()
    return json.loads(raw) if raw and raw != b"null" else None


def cloud_save(state):
    import urllib.request
    body = json.dumps(state, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(_fb_url(), data=body, method="PUT",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        r.read()


def _seed_state():
    """Build the first board from a v1 data.json or the 21 seed scripts."""
    scripts = {}
    if os.path.exists(LEGACY_FILE):
        try:
            with open(LEGACY_FILE, encoding="utf-8") as f:
                scripts = json.load(f)
        except Exception:
            scripts = {}
    if not scripts and os.path.exists(SEED_FILE):
        with open(SEED_FILE, encoding="utf-8") as f:
            scripts = json.load(f)
        now = int(time.time() * 1000)
        for s in scripts.values():
            s["updatedAt"] = now
    return {"boards": {"main": new_board("main", "Editing Hub", scripts)}}


def load_data():
    global STATE
    if USING_CLOUD:
        try:
            cloud = cloud_load()
        except Exception as e:
            sys.stderr.write(f"[cloud load failed, retrying from seed] {e}\n")
            cloud = None
        if cloud and isinstance(cloud, dict) and cloud.get("boards"):
            STATE = cloud
            STATE.setdefault("boards", {})
        else:
            # nothing in the cloud yet — seed it once (prefer local boards.json if present)
            if os.path.exists(DATA_FILE):
                try:
                    with open(DATA_FILE, encoding="utf-8") as f:
                        STATE = json.load(f); STATE.setdefault("boards", {})
                except Exception:
                    STATE = _seed_state()
            else:
                STATE = _seed_state()
            try:
                cloud_save(STATE)
            except Exception as e:
                sys.stderr.write(f"[cloud seed failed] {e}\n")
        return
    # ---- local file backend ----
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, encoding="utf-8") as f:
                STATE = json.load(f)
            STATE.setdefault("boards", {})
            return
        except Exception:
            pass
    STATE = _seed_state()
    save_data(snapshot_state())


def snapshot_state():
    with LOCK:
        return json.loads(json.dumps(STATE))   # deep copy


def save_data(state):
    with SAVE_LOCK:
        try:
            tmp = DATA_FILE + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(state, f, ensure_ascii=False)
            os.replace(tmp, DATA_FILE)
        except Exception as e:
            sys.stderr.write(f"[save warning] {e}\n")


def persist():
    if USING_CLOUD:
        DIRTY.set()                 # flushed by cloud_writer (debounced)
    else:
        save_data(snapshot_state())


def cloud_writer():
    """Batch rapid edits and push the whole state to Firebase every ~1.5s."""
    while True:
        DIRTY.wait()
        time.sleep(1.5)
        DIRTY.clear()
        try:
            cloud_save(snapshot_state())
        except Exception as e:
            sys.stderr.write(f"[cloud save warning] {e}\n")
            DIRTY.set()             # retry on next loop
            time.sleep(3)


# ------------------------------------------------------------------ broadcast
def board_scripts(b):
    return list(b["scripts"].values())


def online_members(b):
    now = time.time()
    out = []
    for mid, m in b["members"].items():
        online = now - m.get("lastSeen", 0) < 35
        out.append({"id": mid, "name": m.get("name"), "role": m.get("role"),
                    "photo": m.get("photo", ""), "perms": m.get("perms", {}),
                    "online": online})
    return out


def broadcast(board_id, event, payload):
    msg = f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
    with LOCK:
        targets = [q for (bid, q) in CLIENTS if bid == board_id]
    dead = []
    for q in targets:
        try:
            q.put_nowait(msg)
        except Exception:
            dead.append(q)
    if dead:
        with LOCK:
            CLIENTS[:] = [(bid, q) for (bid, q) in CLIENTS if q not in dead]


def push_scripts(board_id):
    with LOCK:
        b = STATE["boards"].get(board_id)
        snap = board_scripts(b) if b else []
    broadcast(board_id, "scripts", snap)


def push_members(board_id):
    with LOCK:
        b = STATE["boards"].get(board_id)
        snap = online_members(b) if b else []
    broadcast(board_id, "members", snap)


def log_activity(board_id, who, action, title="", scriptId=""):
    entry = {"id": uuid.uuid4().hex[:10], "ts": int(time.time() * 1000),
             "who": who, "action": action, "title": title, "scriptId": scriptId}
    with LOCK:
        b = STATE["boards"].get(board_id)
        if not b:
            return
        b["activity"].append(entry)
        b["activity"] = b["activity"][-100:]
    broadcast(board_id, "activity", entry)


def reaper():
    while True:
        time.sleep(12)
        try:
            with LOCK:
                ids = list(STATE["boards"].keys())
            for bid in ids:
                push_members(bid)
        except Exception:
            pass


# --------------------------------------------------------------- permissions
def resolve_member(b, member_id, member_obj, pin):
    """Ensure the member exists in the board registry; return (member, isOwner)."""
    m = b["members"].get(member_id)
    if m is None and member_obj:
        access = b.get("newMemberAccess", "edit")
        m = {"name": member_obj.get("name", "Someone"),
             "role": "editor" if access == "edit" else "viewer",
             "photo": member_obj.get("photo", ""),
             "perms": dict(DEFAULT_PERMS_EDIT if access == "edit" else DEFAULT_PERMS_VIEW),
             "lastSeen": time.time()}
        # First member ever on a board with no owner set becomes the owner.
        if not b.get("ownerName"):
            b["ownerName"] = m["name"]
            m["role"] = "owner"
            m["perms"] = dict(OWNER_PERMS)
        b["members"][member_id] = m
    is_owner = False
    if m:
        if m.get("role") == "owner":
            is_owner = True
        if pin and b.get("ownerPin") and pin == b["ownerPin"]:
            is_owner = True
    elif pin and b.get("ownerPin") and pin == b["ownerPin"]:
        is_owner = True
    return m, is_owner


def can(b, member_id, member_obj, pin, need):
    m, is_owner = resolve_member(b, member_id, member_obj, pin)
    if is_owner:
        return True
    if not m:
        return False
    return bool(m.get("perms", {}).get(need))


# ---------------------------------------------------------------- HTTP server
class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _send(self, code, body=b"", ctype="application/json"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        try:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Connection", "close")
            self.end_headers()
            if body:
                self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass

    def _json(self, code, obj):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def _body(self):
        n = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(n) or b"{}")

    def _query(self):
        if "?" not in self.path:
            return {}
        q = {}
        for pair in self.path.split("?", 1)[1].split("&"):
            if "=" in pair:
                k, v = pair.split("=", 1)
                q[k] = v
        return q

    def do_OPTIONS(self):
        self._send(204)

    # ---- GET ----
    def do_GET(self):
        try:
            path = self.path.split("?")[0]
            if path == "/api/ping":
                return self._json(200, {"ok": True, "app": "scriptflow", "v": 2})
            if path == "/api/boards":
                with LOCK:
                    lst = [{"id": b["id"], "name": b["name"]} for b in STATE["boards"].values()]
                return self._json(200, lst)
            if path == "/api/state":
                q = self._query()
                bid = q.get("board", "main")
                with LOCK:
                    b = STATE["boards"].get(bid)
                    if b and not board_unlocked(b, q.get("key", "")):
                        return self._json(401, {"error": "locked"})
                    snap = board_scripts(b) if b else []
                return self._json(200, snap)
            if path == "/api/activity":
                q = self._query()
                bid = q.get("board", "main")
                with LOCK:
                    b = STATE["boards"].get(bid)
                    if b and not board_unlocked(b, q.get("key", "")):
                        return self._json(401, {"error": "locked"})
                    snap = list(b["activity"]) if b else []
                return self._json(200, snap)
            if path == "/api/events":
                return self._sse()
            return self._serve_static(path)
        except Exception as e:
            sys.stderr.write(f"[GET error] {e}\n")
            self._send(500, b'{"error":"server"}')

    # ---- POST ----
    def do_POST(self):
        try:
            path = self.path.split("?")[0]
            data = self._body()
            bid = data.get("board", "main")

            if path == "/api/upload":
                return self._upload(data)

            if path == "/api/boards":
                name = (data.get("name") or "New Channel").strip()[:60]
                new_id = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or ("b" + uuid.uuid4().hex[:6])
                with LOCK:
                    if new_id in STATE["boards"]:
                        new_id += "-" + uuid.uuid4().hex[:4]
                    STATE["boards"][new_id] = new_board(new_id, name)
                persist()
                return self._json(200, {"ok": True, "id": new_id, "name": name})

            with LOCK:
                b = STATE["boards"].get(bid)
            if not b:
                return self._json(404, {"error": "no such board"})

            mid = data.get("memberId", "")
            mobj = data.get("member")
            pin = data.get("pin", "")
            key = data.get("key", "")

            # password gate (only when a board password is set). whoami + login
            # stay open so a newcomer can discover the gate and unlock it.
            if path not in ("/api/login", "/api/whoami"):
                with LOCK:
                    if not board_unlocked(b, key):
                        return self._json(401, {"error": "locked"})

            if path == "/api/login":
                with LOCK:
                    ok = board_unlocked(b, data.get("password", ""))
                return self._json(200 if ok else 403, {"ok": ok})

            if path == "/api/presence":
                with LOCK:
                    resolve_member(b, mid, mobj, pin)
                    m = b["members"].get(mid)
                    if m:
                        m["lastSeen"] = time.time()
                        if mobj:
                            if mobj.get("name"): m["name"] = mobj["name"]
                            if mobj.get("photo") is not None: m["photo"] = mobj["photo"]
                push_members(bid)
                return self._json(200, {"ok": True})

            if path == "/api/whoami":
                with LOCK:
                    m, is_owner = resolve_member(b, mid, mobj, pin)
                persist()
                return self._json(200, {
                    "isOwner": is_owner,
                    "role": (m or {}).get("role", "viewer"),
                    "perms": OWNER_PERMS if is_owner else (m or {}).get("perms", DEFAULT_PERMS_VIEW),
                    "ownerPinSet": bool(b.get("ownerPin")),
                    "ownerName": b.get("ownerName", ""),
                    "newMemberAccess": b.get("newMemberAccess", "edit"),
                    "passwordSet": bool(b.get("password")),
                    "logo": b.get("logo", ""),
                    "image": b.get("image", ""),
                    "boardName": b.get("name", ""),
                    "stageNames": b.get("stageNames", {}),
                })

            if path == "/api/upsert":
                s = data.get("script") or {}
                patch = data.get("patch")
                sid = data.get("id") or s.get("id")
                action = data.get("action", "edit")
                need = "move" if action == "move" else "edit"
                with LOCK:
                    allowed = can(b, mid, mobj, pin, need)
                if not allowed:
                    return self._json(403, {"error": "no permission"})
                if not sid:
                    return self._json(400, {"error": "no id"})
                with LOCK:
                    if patch:
                        # field-level merge into the latest version (no clobber)
                        cur = b["scripts"].get(sid) or {"id": sid}
                        cur.update(patch)
                        b["scripts"][sid] = cur
                        title = cur.get("title", "")
                    else:
                        b["scripts"][sid] = s
                        title = s.get("title", "")
                persist()
                push_scripts(bid)
                who = (mobj or {}).get("name") or (patch or s).get("updatedBy") or "Someone"
                verb = {"move": "moved", "create": "added", "edit": "updated"}.get(action, "updated")
                log_activity(bid, who, f"{verb} a script", title, sid)
                return self._json(200, {"ok": True})

            if path == "/api/remove":
                with LOCK:
                    allowed = can(b, mid, mobj, pin, "del")
                    title = b["scripts"].get(data.get("id"), {}).get("title", "")
                if not allowed:
                    return self._json(403, {"error": "no permission"})
                with LOCK:
                    b["scripts"].pop(data.get("id"), None)
                persist()
                push_scripts(bid)
                log_activity(bid, (mobj or {}).get("name", "Someone"), "deleted a script", title)
                return self._json(200, {"ok": True})

            if path == "/api/claim-owner":
                with LOCK:
                    if not b.get("ownerPin"):
                        b["ownerPin"] = str(data.get("newPin", "")).strip()
                        b["ownerName"] = (mobj or {}).get("name", b.get("ownerName", "Owner"))
                        if mid:
                            m, _ = resolve_member(b, mid, mobj, "")
                            if m: m["role"] = "owner"; m["perms"] = dict(OWNER_PERMS)
                        ok = True
                    else:
                        ok = (str(data.get("pin", "")).strip() == b["ownerPin"])
                        if ok and mid:
                            m, _ = resolve_member(b, mid, mobj, "")
                            if m: m["role"] = "owner"; m["perms"] = dict(OWNER_PERMS)
                if ok:
                    persist(); push_members(bid)
                return self._json(200 if ok else 403, {"ok": ok})

            if path == "/api/members":
                # owner-only: set a member's perms / role
                with LOCK:
                    _, is_owner = resolve_member(b, mid, mobj, pin)
                    if not is_owner:
                        return self._json(403, {"error": "owner only"})
                    tgt = data.get("targetId")
                    tm = b["members"].get(tgt)
                    if tm:
                        if "perms" in data: tm["perms"] = data["perms"]
                        if "role" in data:
                            tm["role"] = data["role"]
                            if data["role"] == "owner": tm["perms"] = dict(OWNER_PERMS)
                            elif data["role"] == "viewer": tm["perms"] = dict(DEFAULT_PERMS_VIEW)
                            elif data["role"] == "manager": tm["perms"] = {"edit": True, "move": True, "del": True, "manage": False}
                            elif data["role"] == "editor": tm["perms"] = dict(DEFAULT_PERMS_EDIT)
                persist(); push_members(bid)
                return self._json(200, {"ok": True})

            if path == "/api/board-settings":
                with LOCK:
                    m, is_owner = resolve_member(b, mid, mobj, pin)
                    if not is_owner:
                        return self._json(403, {"error": "owner only"})
                    if "name" in data: b["name"] = str(data["name"])[:60]
                    if "newMemberAccess" in data: b["newMemberAccess"] = data["newMemberAccess"]
                    if "ownerPin" in data: b["ownerPin"] = str(data["ownerPin"]).strip()
                    if "logo" in data: b["logo"] = str(data["logo"])
                    if "image" in data: b["image"] = str(data["image"])
                    if "password" in data: b["password"] = str(data["password"]).strip()
                    if "stageNames" in data and isinstance(data["stageNames"], dict):
                        sn = b.setdefault("stageNames", {})
                        for k, v in data["stageNames"].items():
                            sn[str(k)] = str(v)[:24]
                    if "ownerName" in data:
                        nm = str(data["ownerName"]).strip()[:40]
                        if nm:
                            b["ownerName"] = nm
                            # rename the owner's own member record so it shows everywhere
                            om = b["members"].get(mid)
                            if om and om.get("role") == "owner":
                                om["name"] = nm
                persist()
                return self._json(200, {"ok": True, "logo": b.get("logo", ""), "image": b.get("image", "")})

            return self._json(404, {"error": "not found"})
        except Exception as e:
            sys.stderr.write(f"[POST error] {e}\n")
            self._json(400, {"error": "bad request"})

    # ---- file upload (base64 JSON) ----
    def _upload(self, data):
        try:
            raw_full = data.get("dataB64", "")
            raw = raw_full
            if "," in raw and raw.strip().startswith("data:"):
                raw = raw.split(",", 1)[1]
            blob = base64.b64decode(raw)
            if len(blob) > MAX_UPLOAD:
                return self._json(413, {"error": f"file too large (max {MAX_UPLOAD // (1024*1024)}MB)"})
            # In the cloud, store the file inline as a data URL so it lives in the
            # database (durable) instead of on the host's temporary disk.
            if USING_CLOUD:
                url = raw_full if raw_full.startswith("data:") else "data:application/octet-stream;base64," + raw
                return self._json(200, {"ok": True, "url": url})
            os.makedirs(MEDIA_DIR, exist_ok=True)
            name = data.get("name", "file")
            ext = os.path.splitext(name)[1].lower()
            if not re.match(r"^\.[a-z0-9]{1,5}$", ext):
                ext = ".bin"
            fn = uuid.uuid4().hex[:16] + ext
            with open(os.path.join(MEDIA_DIR, fn), "wb") as f:
                f.write(blob)
            return self._json(200, {"ok": True, "url": "/media/" + fn})
        except Exception as e:
            sys.stderr.write(f"[upload error] {e}\n")
            return self._json(400, {"error": "upload failed"})

    # ---- SSE ----
    def _sse(self):
        q = self._query()
        bid = q.get("board", "main")
        with LOCK:
            b0 = STATE["boards"].get(bid)
            locked = bool(b0) and not board_unlocked(b0, q.get("key", ""))
        if locked:
            return self._json(401, {"error": "locked"})
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
        except (BrokenPipeError, ConnectionResetError, OSError):
            return
        q = queue.Queue(maxsize=300)
        with LOCK:
            b = STATE["boards"].get(bid)
            if b:
                try:
                    q.put_nowait(f"event: scripts\ndata: {json.dumps(board_scripts(b), ensure_ascii=False)}\n\n")
                    q.put_nowait(f"event: members\ndata: {json.dumps(online_members(b), ensure_ascii=False)}\n\n")
                    q.put_nowait(f"event: activity-log\ndata: {json.dumps(list(b['activity']), ensure_ascii=False)}\n\n")
                except Exception:
                    pass
            CLIENTS.append((bid, q))
        try:
            while True:
                try:
                    msg = q.get(timeout=15)
                    self.wfile.write(msg.encode("utf-8")); self.wfile.flush()
                except queue.Empty:
                    self.wfile.write(b": ping\n\n"); self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            with LOCK:
                CLIENTS[:] = [(x, y) for (x, y) in CLIENTS if y is not q]

    def _serve_static(self, path):
        if path == "/":
            path = "/index.html"
        safe = os.path.normpath(path).lstrip("\\/")
        full = os.path.join(ROOT, safe)
        if not full.startswith(ROOT) or not os.path.isfile(full):
            return self._send(404, b"Not found", "text/plain")
        ext = os.path.splitext(full)[1].lower()
        ctype = {
            ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
            ".svg": "image/svg+xml", ".ico": "image/x-icon", ".png": "image/png",
            ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
            ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".ogg": "audio/ogg",
        }.get(ext, "application/octet-stream")
        try:
            with open(full, "rb") as f:
                body = f.read()
            self._send(200, body, ctype)
        except Exception:
            self._send(404, b"Not found", "text/plain")


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80)); ip = s.getsockname()[0]; s.close()
        return ip
    except Exception:
        return "127.0.0.1"


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 128


def main():
    load_data()
    os.makedirs(MEDIA_DIR, exist_ok=True)
    threading.Thread(target=reaper, daemon=True).start()
    if USING_CLOUD:
        threading.Thread(target=cloud_writer, daemon=True).start()
    httpd = Server(("0.0.0.0", PORT), Handler)
    ip = lan_ip(); bar = "=" * 56
    print("\n" + bar)
    print("   ScriptFlow is LIVE")
    print(bar)
    print(f"  On THIS computer : http://localhost:{PORT}")
    print(f"  Phone / editor   : http://{ip}:{PORT}")
    print("                     (same Wi-Fi - share this link)")
    print(bar)
    print("  Boards, members & media save to boards.json + /media.")
    print("  Close this window to stop the server.")
    print(bar + "\n")
    if "--no-open" not in sys.argv:
        try: webbrowser.open(f"http://localhost:{PORT}")
        except Exception: pass
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")


if __name__ == "__main__":
    main()
