// ============================================================================
//  store.js — data layer (v2)
//  Engines:
//    • ServerStore : live multi-board sync, members, permissions, activity,
//                    media uploads — via the bundled Python server (no accounts)
//    • LocalStore  : single board on this device (offline fallback)
//  The app talks to one interface; identity (memberId / member / pin) is set
//  by the app and attached to every write.
// ============================================================================

import { firebaseConfig, WORKSPACE_ID, isFirebaseConfigured } from "./firebase-config.js";

const FB_VER = "10.12.2";

function clientId() {
  let id = localStorage.getItem("scriptflow:clientId");
  if (!id) { id = "c_" + Math.random().toString(36).slice(2, 12); localStorage.setItem("scriptflow:clientId", id); }
  return id;
}

// ----------------------------------------------------------------------------
//  SERVER STORE (full-featured, live)
// ----------------------------------------------------------------------------
class ServerStore {
  constructor() {
    this.mode = "live";
    this.caps = { boards: true, members: true, activity: true, upload: true, perms: true };
    this.board = localStorage.getItem("scriptflow:board") || "main";
    this.identity = { memberId: clientId(), member: { name: "", role: "editor", photo: "" }, pin: "" };
    this.key = localStorage.getItem("sf:key:" + this.board) || "";
    this._handlers = {};
    this.es = null;
  }
  setIdentity(member, pin) {
    this.identity.member = member;
    if (pin != null) this.identity.pin = pin;
  }
  setKey(k) { this.key = k || ""; localStorage.setItem("sf:key:" + this.board, this.key); }
  async login(password) {
    const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ board: this.board, password }) });
    const j = await r.json().catch(() => ({}));
    if (j.ok) this.setKey(password);
    return !!j.ok;
  }
  // is this board password-protected, and do we already hold a valid key?
  async lockStatus() {
    try {
      const w = await this.whoami();
      const locked = !!w.passwordSet && !(this.key && await this.login(this.key));
      return { passwordSet: !!w.passwordSet, locked };
    } catch { return { passwordSet: false, locked: false }; }
  }
  async start(handlers) {
    this._handlers = handlers;
    handlers.onStatus && handlers.onStatus({ mode: "connecting" });
    await this._openStream();
  }
  async _openStream() {
    const h = this._handlers;
    const kq = this.key ? `&key=${encodeURIComponent(this.key)}` : "";
    try {
      const r = await fetch(`/api/state?board=${encodeURIComponent(this.board)}${kq}`);
      h.onScripts && h.onScripts(await r.json());
    } catch {}
    if (this.es) { try { this.es.close(); } catch {} }
    const es = new EventSource(`/api/events?board=${encodeURIComponent(this.board)}${kq}`);
    es.addEventListener("scripts", (e) => { h.onStatus && h.onStatus({ mode: "live" }); h.onScripts && h.onScripts(JSON.parse(e.data)); });
    es.addEventListener("members", (e) => h.onMembers && h.onMembers(JSON.parse(e.data)));
    es.addEventListener("activity", (e) => h.onActivity && h.onActivity(JSON.parse(e.data)));
    es.addEventListener("activity-log", (e) => h.onActivityLog && h.onActivityLog(JSON.parse(e.data)));
    es.onopen = () => h.onStatus && h.onStatus({ mode: "live" });
    es.onerror = () => h.onStatus && h.onStatus({ mode: "connecting" });
    this.es = es;
  }
  async setBoard(boardId) {
    this.board = boardId;
    localStorage.setItem("scriptflow:board", boardId);
    this.key = localStorage.getItem("sf:key:" + boardId) || "";
    await this._openStream();
  }
  async seedIfEmpty() {}                 // server seeds itself
  async _post(path, payload, tries = 4) {
    const body = JSON.stringify({ board: this.board, memberId: this.identity.memberId,
      member: this.identity.member, pin: this.identity.pin, key: this.key, ...payload });
    let lastErr;
    for (let i = 0; i < tries; i++) {
      try {
        const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body });
        if (r.status === 403) { const j = await r.json().catch(() => ({})); const e = new Error(j.error || "no permission"); e.forbidden = true; throw e; }
        if (r.ok) return r.json().catch(() => ({}));
        lastErr = new Error("HTTP " + r.status);
      } catch (e) { if (e.forbidden) throw e; lastErr = e; }
      await new Promise((res) => setTimeout(res, 150 * (i + 1)));
    }
    throw lastErr;
  }
  async upsert(script, action = "edit") { return this._post("/api/upsert", { script, action }); }
  async upsertPatch(id, patch, action = "edit") { return this._post("/api/upsert", { id, patch, action }); }
  async remove(id) { return this._post("/api/remove", { id }); }
  async setPresence(member) { try { await this._post("/api/presence", { member }, 2); } catch {} }
  async whoami() { return this._post("/api/whoami", {}, 2); }
  async claimOwner(opts) { return this._post("/api/claim-owner", opts, 1); }
  async setMember(targetId, change) { return this._post("/api/members", { targetId, ...change }, 1); }
  async boardSettings(change) { return this._post("/api/board-settings", change, 1); }
  async listBoards() { const r = await fetch("/api/boards"); return r.json(); }
  async createBoard(name) {
    const r = await fetch("/api/boards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    return r.json();
  }
  async upload(file) {
    const dataB64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
    const r = await fetch("/api/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name, dataB64 }) });
    if (!r.ok) throw new Error("upload failed");
    return (await r.json()).url;
  }
}

// ----------------------------------------------------------------------------
//  LOCAL STORE (offline fallback — single board, this device only)
// ----------------------------------------------------------------------------
class LocalStore {
  constructor() {
    this.mode = "local";
    this.caps = { boards: false, members: false, activity: false, upload: true, perms: false };
    this.board = "main";
    this.identity = { memberId: clientId(), member: { name: "", role: "owner", photo: "" }, pin: "" };
    this._key = "scriptflow:scripts:local";
  }
  setIdentity(member) { this.identity.member = member; }
  async start(handlers) {
    this._h = handlers;
    const raw = localStorage.getItem(this._key);
    this._scripts = raw ? JSON.parse(raw) : [];
    handlers.onStatus && handlers.onStatus({ mode: "local" });
    window.addEventListener("storage", (e) => { if (e.key === this._key) { this._scripts = e.newValue ? JSON.parse(e.newValue) : []; this._emit(); } });
    this._emit();
  }
  _emit() { this._h.onScripts && this._h.onScripts(this._scripts.slice()); }
  _save() { localStorage.setItem(this._key, JSON.stringify(this._scripts)); this._emit(); }
  async seedIfEmpty(seed) { if (this._scripts.length === 0) { this._scripts = seed.map((s) => ({ ...s, updatedAt: Date.now() })); this._save(); } }
  async upsert(script) { const i = this._scripts.findIndex((s) => s.id === script.id); if (i >= 0) this._scripts[i] = script; else this._scripts.push(script); this._save(); }
  async upsertPatch(id, patch) { const i = this._scripts.findIndex((s) => s.id === id); if (i >= 0) this._scripts[i] = { ...this._scripts[i], ...patch }; else this._scripts.push({ id, ...patch }); this._save(); }
  async remove(id) { this._scripts = this._scripts.filter((s) => s.id !== id); this._save(); }
  async setPresence() {}
  setKey() {}
  async login() { return true; }
  async lockStatus() { return { passwordSet: false, locked: false }; }
  async whoami() { return { isOwner: true, perms: { edit: true, move: true, del: true, manage: true }, ownerPinSet: false, newMemberAccess: "edit", passwordSet: false, logo: "", image: "" }; }
  async listBoards() { return [{ id: "main", name: "My Board" }]; }
  async upload(file) { return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); }); }
}

// ----------------------------------------------------------------------------
//  FIREBASE STORE — basic single-board live (used only if keys set & no server)
// ----------------------------------------------------------------------------
class FirebaseStore extends LocalStore {
  // Firebase path keeps the simple board behaviour; the rich collaborative
  // features (boards/members/perms) run through the bundled server.
  constructor() { super(); this.mode = "live"; this.caps = { boards: false, members: false, activity: false, upload: true, perms: false }; }
  async start(handlers) {
    this._h = handlers;
    handlers.onStatus && handlers.onStatus({ mode: "connecting" });
    const appMod = await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-app.js`);
    const fs = await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-firestore.js`);
    this.fs = fs;
    const app = appMod.initializeApp(firebaseConfig);
    this.db = fs.getFirestore(app);
    this.col = fs.collection(this.db, "workspaces", WORKSPACE_ID, "scripts");
    fs.onSnapshot(this.col, (snap) => { const arr = []; snap.forEach((d) => arr.push({ id: d.id, ...d.data() })); handlers.onStatus({ mode: "live" }); handlers.onScripts(arr); },
      (err) => handlers.onStatus({ mode: "error", message: err.message }));
  }
  async seedIfEmpty(seed) { const snap = await this.fs.getDocs(this.col); if (snap.empty) await Promise.all(seed.map((s) => this.fs.setDoc(this.fs.doc(this.col, s.id), { ...s, updatedAt: Date.now() }))); }
  async upsert(script) { await this.fs.setDoc(this.fs.doc(this.col, script.id), script); }
  async upsertPatch(id, patch) { await this.fs.setDoc(this.fs.doc(this.col, id), patch, { merge: true }); }
  async remove(id) { await this.fs.deleteDoc(this.fs.doc(this.col, id)); }
}

// ---- detect bundled live server -------------------------------------------
async function serverAvailable() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch("/api/ping", { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return false;
    const j = await r.json();
    return j && j.app === "scriptflow";
  } catch { return false; }
}

export async function pickStore() {
  if (location.protocol.startsWith("http") && (await serverAvailable())) return new ServerStore();
  if (isFirebaseConfigured()) return new FirebaseStore();
  return new LocalStore();
}

export { clientId };
