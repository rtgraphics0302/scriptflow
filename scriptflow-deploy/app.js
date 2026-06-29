// ============================================================================
//  app.js — ScriptFlow studio (v2)
//  Boards, members + permissions, activity & notifications, profile photos,
//  media (links / thumbnails / voiceover), email invites, voice welcome.
// ============================================================================

import { pickStore, clientId } from "./store.js";
import { SEED_SCRIPTS } from "./seed-data.js";

const STAGES = [
  { key: "scripts",   label: "Scripts",   sub: "To record", color: "var(--stage-scripts)" },
  { key: "done",      label: "Done",      sub: "Recorded",  color: "var(--stage-done)" },
  { key: "editing",   label: "Editing",   sub: "In edit",   color: "var(--stage-editing)" },
  { key: "ready",     label: "Ready",     sub: "Approved",  color: "var(--stage-ready)" },
  { key: "delivered", label: "Delivered", sub: "Published", color: "var(--stage-delivered)" },
];
const STAGE = Object.fromEntries(STAGES.map((s) => [s.key, s]));
const stageIndex = (k) => STAGES.findIndex((s) => s.key === k);
// owner-customizable column names (fall back to the defaults above)
const stageLabel = (k) => (state.stageNames && state.stageNames[k]) || (STAGE[k] && STAGE[k].label) || k;
const fwdLabel = { scripts: "Mark Done", done: "Start Editing", editing: "Mark Ready", ready: "Deliver" };

const state = {
  scripts: [], me: null, view: "board", filterStage: null, search: "", openId: null, assigneeFilter: null,
  members: [], boards: [], board: "main",
  activity: [], unread: 0,
  perms: { edit: true, move: true, del: true, manage: true }, isOwner: false, ownerPinSet: false, newMemberAccess: "edit",
  logo: "", boardImage: "", passwordSet: false, stageNames: {},
  status: { mode: "local" },
};
const settings = {
  welcomeVoice: localStorage.getItem("sf:welcome") !== "0",
  notify: localStorage.getItem("sf:notify") !== "0",
  sound: localStorage.getItem("sf:sound") !== "0",
};
let store;
let spokeWelcome = false;
let pendingPhotoFile = null, pendingPhotoData = "";

// ---- helpers --------------------------------------------------------------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const esc = (s) => (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const uid = () => "s_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const initials = (n) => (n || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
const colorFor = (n) => { let h = 0; for (const c of n || "?") h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 60% 50%)`; };
function timeAgo(ts) { if (!ts) return "—"; const s = Math.floor((Date.now() - ts) / 1000); if (s < 45) return "just now"; if (s < 3600) return Math.floor(s / 60) + "m ago"; if (s < 86400) return Math.floor(s / 3600) + "h ago"; return Math.floor(s / 86400) + "d ago"; }
const isUrl = (s) => /^(https?:|\/media\/|data:)/.test(s || "");

function avatarHTML(name, photo, cls = "avatar") {
  if (photo) return `<span class="${cls} has-photo" title="${esc(name)}"><img src="${esc(photo)}" alt=""/></span>`;
  return `<span class="${cls}" style="background:${colorFor(name)}" title="${esc(name)}">${initials(name)}</span>`;
}

function toast(msg, kind = "") {
  const t = el("div", "toast " + kind, `<span>${esc(msg)}</span>`);
  $("#toasts").appendChild(t);
  setTimeout(() => { t.style.transition = "opacity .3s, transform .3s"; t.style.opacity = "0"; t.style.transform = "translateY(8px)"; }, 2600);
  setTimeout(() => t.remove(), 2950);
}

// resize an image File down to maxPx (keeps uploads small). Returns a File.
async function resizeImage(file, maxPx) {
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
    const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d").drawImage(img, 0, 0, w, h);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
    return new File([blob], (file.name || "img").replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch { return file; }
}

// ============================================================================
//  IDENTITY + PROFILE PHOTO
// ============================================================================
const loadMe = () => { try { return JSON.parse(localStorage.getItem("scriptflow:me")); } catch { return null; } };
const saveMe = (m) => localStorage.setItem("scriptflow:me", JSON.stringify(m));

function openIdentity() {
  const m = $("#identityModal"); m.classList.remove("hidden");
  if (state.me) {
    $("#nameInput").value = state.me.name;
    $$("#rolePick .role-card").forEach((b) => b.classList.toggle("active", b.dataset.role === state.me.role));
    if (state.me.photo) { $("#photoPreview").src = state.me.photo; $("#photoPick").classList.add("has-photo"); }
    pendingPhotoData = state.me.photo || "";
  }
  $("#nameInput").focus();
}

function setupIdentity() {
  let role = (state.me && state.me.role) || "owner";
  $("#rolePick").addEventListener("click", (e) => { const b = e.target.closest(".role-card"); if (!b) return; role = b.dataset.role; $$("#rolePick .role-card").forEach((x) => x.classList.toggle("active", x === b)); });
  $("#photoPick").addEventListener("click", () => $("#photoInput").click());
  $("#photoInput").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    pendingPhotoFile = await resizeImage(f, 200);
    pendingPhotoData = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(pendingPhotoFile); });
    $("#photoPreview").src = pendingPhotoData; $("#photoPick").classList.add("has-photo");
  });
  $("#saveIdentity").addEventListener("click", async () => {
    const name = $("#nameInput").value.trim(); if (!name) { $("#nameInput").focus(); return; }
    let photo = pendingPhotoData;
    if (pendingPhotoFile && store && store.caps.upload) { try { photo = await store.upload(pendingPhotoFile); } catch {} }
    state.me = { name, role, photo: photo || "" };
    saveMe(state.me);
    pendingPhotoFile = null;
    $("#identityModal").classList.add("hidden");
    renderMe();
    if (store) { store.setIdentity(state.me, state.me.pin); heartbeat(); await refreshPerms(); }
    maybeAskNotify();
    speakWelcome(true);
  });
  $("#identityBtn").addEventListener("click", openIdentity);
}

function renderMe() {
  if (!state.me) return;
  const a = $("#meAvatar");
  if (state.me.photo) { a.classList.add("has-photo"); a.innerHTML = `<img src="${esc(state.me.photo)}" alt=""/>`; }
  else { a.classList.remove("has-photo"); a.textContent = initials(state.me.name); a.style.background = colorFor(state.me.name); }
  a.title = `${state.me.name}`;
}

// ============================================================================
//  PERMISSIONS
// ============================================================================
async function refreshPerms() {
  if (!store.whoami) return;
  try {
    const w = await store.whoami();
    state.isOwner = !!w.isOwner;
    state.perms = w.perms || state.perms;
    state.ownerPinSet = !!w.ownerPinSet;
    state.newMemberAccess = w.newMemberAccess || "edit";
    state.passwordSet = !!w.passwordSet;
    state.logo = w.logo || "";
    state.boardImage = w.image || "";
    state.stageNames = w.stageNames || {};
    renderBranding();
    applyPerms();
  } catch {}
}
function renderBranding() {
  const mark = $(".brand-mark");
  if (mark) {
    if (state.logo) { mark.classList.add("has-logo"); mark.innerHTML = `<img src="${esc(state.logo)}" alt=""/>`; }
    else { mark.classList.remove("has-logo"); mark.textContent = "⚡"; }
  }
}
function applyPerms() {
  const p = state.perms;
  $("#newBtn").classList.toggle("no-perm", !p.edit);
  // owner-only menu items get rendered conditionally
  render();
}

// ============================================================================
//  PRESENCE / MEMBERS
// ============================================================================
function heartbeat() { if (state.me && store) store.setPresence(state.me); }
function renderPresence() {
  const wrap = $("#presence"); wrap.innerHTML = "";
  const online = state.members.filter((m) => m.online && m.id !== clientId());
  online.slice(0, 5).forEach((m) => { wrap.insertAdjacentHTML("beforeend", avatarHTML(m.name, m.photo, "avatar sm")); });
  if (online.length > 5) wrap.appendChild(el("span", "avatar sm", "+" + (online.length - 5)));
}

// ============================================================================
//  STATUS
// ============================================================================
function renderStatus() {
  const pill = $("#statusPill"), txt = $(".status-text", pill);
  pill.classList.remove("live", "connecting", "error");
  const m = state.status.mode;
  if (m === "live") { pill.classList.add("live"); txt.textContent = "Live"; }
  else if (m === "connecting") { pill.classList.add("connecting"); txt.textContent = "Connecting"; }
  else if (m === "error") { pill.classList.add("error"); txt.textContent = "Sync error"; }
  else txt.textContent = "On this device";
}

// ============================================================================
//  BOARDS
// ============================================================================
async function loadBoards() {
  if (!store.caps.boards) { $("#boardSwitch").classList.add("hidden"); return; }
  try { state.boards = await store.listBoards(); } catch { state.boards = []; }
  const cur = state.boards.find((b) => b.id === state.board) || state.boards[0];
  if (cur) { state.board = cur.id; $("#boardName").textContent = cur.name; }
}
function renderBoardMenu() {
  const menu = $("#boardMenu"); menu.innerHTML = "";
  state.boards.forEach((b) => {
    const it = el("button", "menu-item" + (b.id === state.board ? " active" : ""), `<span class="dotc" style="background:${b.id === state.board ? "var(--accent)" : "var(--faint)"}"></span>${esc(b.name)}`);
    it.addEventListener("click", () => { switchBoard(b.id); $("#boardMenu").classList.add("hidden"); });
    menu.appendChild(it);
  });
  menu.appendChild(el("div", "menu-sep"));
  const add = el("button", "menu-item menu-add", `<svg viewBox="0 0 24 24" class="ic"><path d="M12 5v14M5 12h14"/></svg> New channel board`);
  add.addEventListener("click", async () => {
    $("#boardMenu").classList.add("hidden");
    const name = prompt("Name this channel / board:", "My Channel"); if (!name) return;
    const r = await store.createBoard(name.trim());
    await loadBoards(); renderBoardMenu();
    switchBoard(r.id);
    toast(`Board “${name}” created`, "good");
  });
  menu.appendChild(add);
  if (state.isOwner) {
    const mm = el("button", "menu-item", `<svg viewBox="0 0 24 24" class="ic"><path d="M16 21v-2a4 4 0 0 0-8 0v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/></svg> Members & access`);
    mm.addEventListener("click", () => { $("#boardMenu").classList.add("hidden"); openMembers(); });
    menu.appendChild(mm);
  }
}
async function switchBoard(id) {
  state.board = id; state.activity = []; state.unread = 0; renderBell();
  const b = state.boards.find((x) => x.id === id); if (b) $("#boardName").textContent = b.name;
  await store.setBoard(id);
  await refreshPerms();
  heartbeat();
}

// ============================================================================
//  ACTIVITY + NOTIFICATIONS
// ============================================================================
function chime() {
  if (!settings.sound) return;
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain();
    o.connect(g); g.connect(ac.destination);
    o.frequency.value = 880; o.type = "sine";
    g.gain.setValueAtTime(0.0001, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.12, ac.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.35);
    o.start(); o.stop(ac.currentTime + 0.36);
  } catch {}
}
function maybeAskNotify() {
  if (settings.notify && "Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}
function notify(entry) {
  if (settings.notify && "Notification" in window && Notification.permission === "granted") {
    try { new Notification("ScriptFlow · Editing Hub", { body: `${entry.who} ${entry.action}${entry.title ? " — " + entry.title : ""}`, silent: true }); } catch {}
  }
  chime();
}
function onActivity(entry) {
  state.activity.unshift(entry);
  state.activity = state.activity.slice(0, 100);
  const mine = state.me && entry.who === state.me.name;
  if (!mine) {
    if ($("#activityPanel").classList.contains("hidden")) { state.unread++; }
    notify(entry);
  }
  renderBell();
  if (!$("#activityPanel").classList.contains("hidden")) renderActivityPanel();
}
function onActivityLog(list) {
  state.activity = (list || []).slice().reverse();
  renderBell();
}
function renderBell() {
  const badge = $("#bellBadge");
  if (state.unread > 0) { badge.textContent = state.unread > 99 ? "99+" : state.unread; badge.classList.remove("hidden"); }
  else badge.classList.add("hidden");
}
function renderActivityPanel() {
  const p = $("#activityPanel");
  let html = `<div class="activity-head"><b>Activity</b><button id="clearAct">Mark all read</button></div>`;
  if (state.activity.length === 0) html += `<div class="activity-empty">No activity yet.<br/>Changes by you and your editors show up here.</div>`;
  else html += state.activity.slice(0, 40).map((a) => {
    const mine = state.me && a.who === state.me.name;
    return `<div class="activity-item ${!mine ? "" : ""}">
      ${avatarHTML(a.who, memberPhoto(a.who), "mini-avatar")}
      <div><div class="txt"><b>${esc(a.who)}</b> ${esc(a.action)}${a.title ? ` <span style="color:var(--muted)">“${esc(a.title)}”</span>` : ""}</div>
      <div class="when">${timeAgo(a.ts)}</div></div></div>`;
  }).join("");
  p.innerHTML = html;
  const c = $("#clearAct", p); if (c) c.addEventListener("click", () => { state.unread = 0; renderBell(); });
}
function memberPhoto(name) { const m = state.members.find((x) => x.name === name); return m ? m.photo : ""; }

// ============================================================================
//  STATS / FILTER
// ============================================================================
function visibleScripts() {
  let arr = state.scripts.slice().sort((a, b) => (a.num || 9999) - (b.num || 9999) || (a.updatedAt || 0) - (b.updatedAt || 0));
  if (state.search) { const q = state.search.toLowerCase(); arr = arr.filter((s) => (s.title + " " + s.body).toLowerCase().includes(q)); }
  if (state.assigneeFilter) { const f = state.assigneeFilter; arr = arr.filter((s) => s.assignee === f.id || s.assigneeName === f.name); }
  return arr;
}
function renderStats() {
  const all = state.scripts;
  const counts = Object.fromEntries(STAGES.map((s) => [s.key, 0]));
  all.forEach((s) => { if (counts[s.stage] != null) counts[s.stage]++; });
  const total = all.length || 1;
  const segs = STAGES.map((s) => `<span style="width:${(counts[s.key] / total) * 100}%;background:${s.color}"></span>`).join("");
  const chips = STAGES.map((s) => `<button class="stat-chip ${state.filterStage === s.key ? "active" : ""}" data-stage="${s.key}"><span class="swatch" style="background:${s.color}"></span>${esc(stageLabel(s.key))} <b>${counts[s.key]}</b></button>`).join("");
  const af = state.assigneeFilter
    ? `<div class="assignee-banner">Showing scripts assigned to <b>${esc(state.assigneeFilter.name)}</b> <button id="clearAsg">✕ clear</button></div>` : "";
  $("#stats").innerHTML = `${af}
    <div class="progress-wrap"><div class="progress">${segs}</div><div class="progress-label"><b>${counts.delivered}</b>/${all.length} delivered</div></div>
    <div class="stat-chips"><button class="stat-chip ${!state.filterStage ? "active" : ""}" data-stage="">All <b>${all.length}</b></button>${chips}</div>`;
  $$("#stats .stat-chip").forEach((c) => c.addEventListener("click", () => { state.filterStage = c.dataset.stage || null; render(); }));
  const ca = $("#clearAsg"); if (ca) ca.addEventListener("click", () => { state.assigneeFilter = null; render(); });
}

// ============================================================================
//  CARD
// ============================================================================
function mediaTags(s) {
  const items = [
    { on: !!s.thumbnail, label: "Thumb", d: "M4 5h16v14H4zM4 15l5-4 4 3 3-2 4 3" },
    { on: !!s.videoLink, label: "Video", d: "M4 5h16v14H4zM10 9l5 3-5 3z" },
    { on: !!s.voiceover, label: "VO", d: "M12 3v12M9 6l3-3 3 3M5 12a7 7 0 0 0 14 0" },
    { on: !!s.scriptLink, label: "Doc", d: "M7 3h7l4 4v14H7zM14 3v5h5" },
  ];
  return `<div class="card-media-tags">${items.map((i) => `<span class="mtag ${i.on ? "has" : ""}"><svg viewBox="0 0 24 24" class="ic"><path d="${i.d}"/></svg>${i.label}</span>`).join("")}</div>`;
}
function dueChip(s) {
  if (!s.dueDate) return "";
  const d = new Date(s.dueDate + "T00:00:00"); if (isNaN(d)) return "";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((d - today) / 86400000);
  const overdue = days < 0 && s.stage !== "delivered";
  const soon = days >= 0 && days <= 2 && s.stage !== "delivered";
  const lbl = days === 0 ? "Today" : days === 1 ? "Tomorrow" : days < 0 ? `${-days}d late` : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `<span class="due-chip ${overdue ? "late" : soon ? "soon" : ""}"><svg viewBox="0 0 24 24" class="ic"><path d="M3 9h18M7 3v4M17 3v4M4 5h16v16H4z"/></svg>${lbl}</span>`;
}
function assigneeChip(s) {
  const name = s.assigneeName || (s.assignee && (state.members.find((m) => m.id === s.assignee) || {}).name) || "";
  if (!name) return "";
  const m = state.members.find((x) => x.name === name);
  return `<span class="asg-chip" title="Assigned to ${esc(name)}">${avatarHTML(name, m && m.photo, "mini-avatar")}${esc(name.split(/\s+/)[0])}</span>`;
}
function cardEl(s) {
  const st = STAGE[s.stage] || STAGE.scripts;
  const idx = stageIndex(s.stage);
  const card = el("div", "card-script"); card.style.setProperty("--c", st.color);
  card.draggable = state.perms.move; card.dataset.id = s.id;
  const by = s.updatedBy && s.updatedBy !== "System"
    ? `<span class="meta">${avatarHTML(s.updatedBy, memberPhoto(s.updatedBy), "mini-avatar")}${esc(s.updatedBy)}</span>` : `<span class="meta">·</span>`;
  const canMove = state.perms.move;
  card.innerHTML = `
    ${s.thumbnail ? `<img class="card-thumb" src="${esc(s.thumbnail)}" alt="" loading="lazy"/>` : ""}
    <div class="card-top"><span class="num-badge">${s.num ?? "+"}</span><span class="card-title">${esc(s.title)}</span></div>
    ${mediaTags(s)}
    ${(s.dueDate || s.assigneeName || s.assignee) ? `<div class="card-chips">${assigneeChip(s)}${dueChip(s)}</div>` : ""}
    <p class="card-preview">${esc(s.body).slice(0, 150)}</p>
    <div class="card-foot">${by}<span class="spacer"></span><span class="meta">${(s.chars || s.body.length)} ch</span><span class="meta">${timeAgo(s.updatedAt)}</span></div>
    <div class="card-actions">
      ${idx > 0 ? `<button class="move-btn back ${canMove ? "" : "no-perm"}" title="Move back">‹</button>` : ""}
      ${idx < STAGES.length - 1 ? `<button class="move-btn fwd ${canMove ? "" : "no-perm"}">${fwdLabel[s.stage]} ›</button>` : `<button class="move-btn" disabled>✓ Delivered</button>`}
    </div>`;
  card.addEventListener("click", (e) => { if (!e.target.closest(".move-btn")) openDrawer(s.id); });
  const fwd = $(".move-btn.fwd", card); if (fwd) fwd.addEventListener("click", (e) => { e.stopPropagation(); moveStage(s.id, +1); });
  const back = $(".move-btn.back", card); if (back) back.addEventListener("click", (e) => { e.stopPropagation(); moveStage(s.id, -1); });
  if (canMove) {
    card.addEventListener("dragstart", (e) => { card.classList.add("dragging"); e.dataTransfer.setData("text/plain", s.id); });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
  }
  return card;
}
function renderBoard() {
  const board = $("#board"); board.innerHTML = "";
  const items = visibleScripts();
  const stages = state.filterStage ? STAGES.filter((s) => s.key === state.filterStage) : STAGES;
  stages.forEach((st) => {
    const col = el("div", "column"); col.dataset.stage = st.key;
    const list = items.filter((s) => s.stage === st.key);
    const editable = state.isOwner ? `contenteditable="true" spellcheck="false" data-stage="${st.key}" title="Click to rename this column"` : "";
    col.innerHTML = `<div class="col-head"><span class="bar" style="background:${st.color}"></span><span class="title ${state.isOwner ? "editable" : ""}" ${editable}>${esc(stageLabel(st.key))}</span><span class="count">${list.length}</span></div><div class="col-body"></div>`;
    const body = $(".col-body", col);
    const titleEl = $(".col-head .title", col);
    if (state.isOwner && titleEl) {
      titleEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); titleEl.blur(); } });
      titleEl.addEventListener("blur", async () => {
        const name = titleEl.textContent.trim();
        if (!name || name === stageLabel(st.key)) { titleEl.textContent = stageLabel(st.key); return; }
        state.stageNames = { ...state.stageNames, [st.key]: name };
        try { await store.boardSettings({ stageNames: { [st.key]: name } }); toast(`Column renamed to “${name}”`, "good"); }
        catch { toast("Couldn't rename (owner only)"); titleEl.textContent = stageLabel(st.key); }
      });
    }
    if (list.length === 0) body.appendChild(el("div", "col-empty", st.key === "scripts" ? "No scripts here" : "Nothing yet"));
    else list.forEach((s) => body.appendChild(cardEl(s)));
    col.addEventListener("dragover", (e) => { if (state.perms.move) { e.preventDefault(); col.classList.add("drag-over"); } });
    col.addEventListener("dragleave", (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove("drag-over"); });
    col.addEventListener("drop", (e) => { e.preventDefault(); col.classList.remove("drag-over"); setStage(e.dataTransfer.getData("text/plain"), st.key); });
    board.appendChild(col);
  });
}
function renderList() {
  const root = $("#listview"); root.innerHTML = "";
  let items = visibleScripts(); if (state.filterStage) items = items.filter((s) => s.stage === state.filterStage);
  if (items.length === 0) { root.appendChild(el("div", "col-empty", "No scripts match.")); return; }
  items.forEach((s) => {
    const st = STAGE[s.stage] || STAGE.scripts;
    const row = el("div", "list-row"); row.style.setProperty("--c", st.color);
    row.innerHTML = `<span class="lnum">${s.num ?? "+"}</span><div><div class="ltitle">${esc(s.title)}</div><div class="lprev">${esc(s.body).slice(0, 120)}</div></div><span class="stage-badge">${esc(stageLabel(s.stage))}</span><span class="list-chars">${(s.chars || s.body.length)} ch</span>`;
    row.addEventListener("click", () => openDrawer(s.id));
    root.appendChild(row);
  });
}

// ============================================================================
//  MOVE / SAVE (permission-aware)
// ============================================================================
function touch(s) { return { ...s, updatedAt: Date.now(), updatedBy: (state.me && state.me.name) || "Someone" }; }
async function commit(script, action) {
  try { await store.upsert(script, action); if (action === "delete") {} }
  catch (e) { if (e && e.forbidden) toast("You don't have permission for that"); else toast("Couldn't save — retrying failed"); throw e; }
}
// Send ONLY the changed fields; the server merges them into the latest version
// so two quick saves (or two editors on different fields) never clobber.
async function patchScript(id, patch, action = "edit") {
  const meta = { updatedAt: Date.now(), updatedBy: (state.me && state.me.name) || "Someone" };
  try { await store.upsertPatch(id, { ...patch, ...meta }, action); }
  catch (e) { if (e && e.forbidden) toast("You don't have permission for that"); else toast("Couldn't save"); throw e; }
}
function moveStage(id, dir) { const s = state.scripts.find((x) => x.id === id); if (!s) return; const i = Math.max(0, Math.min(STAGES.length - 1, stageIndex(s.stage) + dir)); setStage(id, STAGES[i].key); }
async function setStage(id, key) {
  const s = state.scripts.find((x) => x.id === id); if (!s || s.stage === key) return;
  if (!state.perms.move) { toast("You don't have permission to move scripts"); return; }
  try { await patchScript(id, { stage: key }, "move"); toast(`“${s.title.slice(0, 24)}…” → ${STAGE[key].label}`, key === "delivered" ? "good" : "info"); } catch {}
}

// ============================================================================
//  DRAWER (read / edit + media)
// ============================================================================
function openDrawer(id) { state.openId = id; renderDrawer(); $("#drawerOverlay").classList.remove("hidden"); $("#drawer").classList.remove("hidden"); document.body.style.overflow = "hidden"; }
function closeDrawer() { state.openId = null; $("#drawerOverlay").classList.add("hidden"); $("#drawer").classList.add("hidden"); document.body.style.overflow = ""; }

// owner can reassign via a dropdown of members; everyone else sees who it's on.
function assigneeControl(s) {
  const cur = s.assignee || "";
  if (!state.isOwner) {
    const m = state.members.find((x) => x.id === cur || x.name === cur);
    const name = m ? m.name : (cur || "");
    return `<div class="assignee-static">${name ? avatarHTML(name, m && m.photo, "mini-avatar") + esc(name) : "<span style='color:var(--muted)'>Unassigned</span>"}</div>`;
  }
  const opts = state.members.map((m) => `<option value="${esc(m.id)}" ${m.id === cur ? "selected" : ""}>${esc(m.name)}${m.role === "owner" ? " (owner)" : ""}</option>`).join("");
  return `<select id="dAssignee"><option value="">— Unassigned —</option>${opts}</select>`;
}

function mediaField(icon, label, key, val, kind) {
  const preview = kind === "image" && isUrl(val) ? `<img class="thumb-preview" src="${esc(val)}" alt=""/>`
    : kind === "audio" && isUrl(val) ? `<audio class="audio-preview" controls src="${esc(val)}"></audio>`
    : isUrl(val) ? `<a class="open-link" href="${esc(val)}" target="_blank" rel="noopener">Open link ↗</a>` : "";
  const up = kind !== "link" ? `<button class="btn sm" data-upload="${key}" data-kind="${kind}">Upload</button>` : "";
  return `<div class="media-field" data-mf="${key}">
    <div class="mf-head"><svg viewBox="0 0 24 24" class="ic"><path d="${icon}"/></svg>${label}</div>
    <div class="media-input"><input data-mkey="${key}" type="text" placeholder="Paste a link…" value="${esc(val || "")}"/>${up}</div>
    <div class="mf-preview">${preview}</div></div>`;
}

function renderDrawer() {
  const s = state.scripts.find((x) => x.id === state.openId); if (!s) return closeDrawer();
  const st = STAGE[s.stage] || STAGE.scripts; const d = $("#drawer"); d.style.setProperty("--c", st.color);
  const canEdit = state.perms.edit, canDel = state.perms.del, canMove = state.perms.move;
  const tl = STAGES.map((stg, i) => { const cur = stg.key === s.stage, done = i <= stageIndex(s.stage); return `<div class="node ${done ? "done" : ""} ${cur ? "current" : ""}" style="--c:${stg.color}"><span class="dot2"></span><small>${esc(stageLabel(stg.key))}</small></div>`; }).join("");
  const moveBtns = STAGES.map((stg) => `<button class="${stg.key === s.stage ? "is-current" : ""} ${canMove ? "" : "no-perm"}" style="--c:${stg.color}" data-key="${stg.key}"><span class="sw" style="background:${stg.color}"></span>${esc(stageLabel(stg.key))}</button>`).join("");

  d.innerHTML = `
    <div class="drawer-head">
      <span class="num-badge">${s.num ?? "+"}</span>
      <div style="flex:1;min-width:0">
        <h2 ${canEdit ? 'contenteditable="true"' : ""} id="dTitle" spellcheck="false">${esc(s.title)}</h2>
        <div class="dh-meta"><span class="stage-badge" style="--c:${st.color}">${esc(stageLabel(s.stage))}</span><span>${(s.chars || s.body.length)} chars</span><span>edited ${timeAgo(s.updatedAt)}${s.updatedBy && s.updatedBy !== "System" ? " by " + esc(s.updatedBy) : ""}</span></div>
      </div>
      <button class="icon-btn drawer-close" id="dClose"><svg viewBox="0 0 24 24" class="ic"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <div class="drawer-body">
      <div class="timeline">${tl}</div>
      <div><div class="section-label">Move to stage</div><div class="move-grid" id="dMoves">${moveBtns}</div></div>

      <div>
        <div class="section-label">Assign & schedule</div>
        <div class="assign-grid">
          <div class="assign-field">
            <div class="mf-head"><svg viewBox="0 0 24 24" class="ic"><path d="M16 21v-2a4 4 0 0 0-8 0v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/></svg>Assigned editor</div>
            ${assigneeControl(s)}
          </div>
          <div class="assign-field">
            <div class="mf-head"><svg viewBox="0 0 24 24" class="ic"><path d="M3 9h18M7 3v4M17 3v4M4 5h16v16H4z"/></svg>Due date</div>
            <input type="date" id="dDue" value="${esc(s.dueDate || "")}" min="2025-01-01" max="2035-12-31" ${canEdit ? "" : "disabled"} />
          </div>
        </div>
      </div>

      <div>
        <div class="section-label">Media & links</div>
        <div class="media-grid">
          ${mediaField("M4 5h16v14H4zM4 15l5-4 4 3 3-2 4 3", "Thumbnail", "thumbnail", s.thumbnail, "image")}
          ${mediaField("M4 5h16v14H4zM10 9l5 3-5 3z", "Video link", "videoLink", s.videoLink, "link")}
          ${mediaField("M12 3v12M9 6l3-3 3 3M5 12a7 7 0 0 0 14 0", "Voiceover", "voiceover", s.voiceover, "audio")}
          ${mediaField("M7 3h7l4 4v14H7zM14 3v5h5", "Script doc link", "scriptLink", s.scriptLink, "link")}
        </div>
      </div>

      <div>
        <div class="section-label" style="display:flex;justify-content:space-between;align-items:center"><span>Script</span>
          <span style="display:flex;gap:8px"><button class="btn sm ghost" id="dCopy">Copy</button><button class="btn sm ghost" id="dTele">▶ Teleprompter</button>${canEdit ? `<button class="btn sm" id="dEdit">Edit</button>` : ""}</span></div>
        <div class="reader"><div class="rtext" id="dBody">${esc(s.body)}</div></div>
        <div class="charcount hidden" id="dCount"></div>
      </div>

      <div class="field"><span>Editor notes</span><textarea id="dNotes" ${canEdit ? "" : "disabled"} placeholder="Add notes for the team…">${esc(s.notes || "")}</textarea></div>
    </div>
    <div class="drawer-foot">
      ${canDel ? `<button class="btn danger" id="dDelete">Delete</button>` : ""}
      <span class="spacer"></span><button class="btn" id="dCancel">Close</button>${canEdit ? `<button class="btn primary hidden" id="dSave">Save changes</button>` : ""}
    </div>`;

  $("#dClose", d).addEventListener("click", closeDrawer);
  $("#dCancel", d).addEventListener("click", closeDrawer);
  $$("#dMoves button", d).forEach((b) => b.addEventListener("click", () => { if (state.perms.move) setStage(s.id, b.dataset.key); else toast("No permission to move"); }));
  $("#dCopy", d).addEventListener("click", () => { navigator.clipboard.writeText(s.body); toast("Script copied", "good"); });
  $("#dTele", d).addEventListener("click", () => openTeleprompter(s.body));
  const del = $("#dDelete", d); if (del) del.addEventListener("click", async () => { if (confirm(`Delete “${s.title}”?`)) { try { await store.remove(s.id); closeDrawer(); toast("Deleted"); } catch (e) { toast(e.forbidden ? "No permission to delete" : "Delete failed"); } } });

  // assign + schedule wiring
  const asg = $("#dAssignee", d);
  if (asg) asg.addEventListener("change", async () => {
    const m = state.members.find((x) => x.id === asg.value);
    try { await patchScript(s.id, { assignee: asg.value, assigneeName: m ? m.name : "" }); toast(asg.value ? `Assigned to ${m ? m.name : "editor"}` : "Unassigned", "good"); } catch {}
  });
  const due = $("#dDue", d);
  if (due) {
    // open the native calendar (with month + year navigation) on a single click anywhere on the field
    const pop = () => { try { due.showPicker(); } catch {} };
    due.addEventListener("click", pop);
    due.addEventListener("focus", pop);
    due.addEventListener("change", async () => {
      if (!canEdit) return;
      const v = due.value;
      // guard against bad years (e.g. typing "26" → 0026); calendar picks are always valid
      if (v) { const y = +v.slice(0, 4); if (y < 2025 || y > 2035) { toast("Pick a date from the calendar (tap the field)"); due.value = s.dueDate || ""; return; } }
      try { await patchScript(s.id, { dueDate: v }); toast(v ? "Due date set" : "Due date cleared", "good"); } catch {}
    });
  }

  // media wiring
  $$(".media-input input", d).forEach((inp) => inp.addEventListener("change", async () => {
    if (!canEdit) { toast("No permission to edit"); renderDrawer(); return; }
    const key = inp.dataset.mkey; try { await patchScript(s.id, { [key]: inp.value.trim() }); toast("Saved", "good"); } catch {}
  }));
  $$("[data-upload]", d).forEach((btn) => btn.addEventListener("click", () => {
    if (!canEdit) { toast("No permission to edit"); return; }
    const key = btn.dataset.upload, kind = btn.dataset.kind;
    const inp = el("input"); inp.type = "file"; inp.accept = kind === "image" ? "image/*" : kind === "audio" ? "audio/*" : "*/*";
    inp.addEventListener("change", async () => {
      let f = inp.files[0]; if (!f) return;
      toast("Uploading…"); if (kind === "image") f = await resizeImage(f, 800);
      try { const url = await store.upload(f); await patchScript(s.id, { [key]: url }); toast("Uploaded", "good"); } catch { toast("Upload failed"); }
    });
    inp.click();
  }));

  if (canEdit) {
    const body = $("#dBody", d), title = $("#dTitle", d), count = $("#dCount", d), notes = $("#dNotes", d), reader = $(".reader", d), editBtn = $("#dEdit", d), saveBtn = $("#dSave", d);
    const refreshCount = () => count.textContent = body.textContent.length + " characters";
    editBtn.addEventListener("click", () => { body.contentEditable = "true"; reader.classList.add("edit"); body.focus(); count.classList.remove("hidden"); refreshCount(); editBtn.textContent = "Editing…"; saveBtn.classList.remove("hidden"); });
    body.addEventListener("input", refreshCount);
    const saveAll = async (silent) => { const nb = body.innerText.trim(), nt = title.innerText.trim() || s.title; try { await patchScript(s.id, { title: nt, body: nb, chars: nb.length, notes: notes.value }); if (!silent) toast("Saved", "good"); } catch {} };
    saveBtn.addEventListener("click", async () => { await saveAll(); closeDrawer(); });
    notes.addEventListener("change", () => saveAll(true));
    title.addEventListener("blur", () => { if (title.innerText.trim() !== s.title) saveAll(true); });
  }
}

// ============================================================================
//  NEW SCRIPT
// ============================================================================
async function newScript() {
  if (!state.perms.edit) { toast("You don't have permission to add scripts"); return; }
  const maxNum = state.scripts.reduce((m, s) => Math.max(m, s.num || 0), 0);
  const s = { id: uid(), num: maxNum + 1, title: "Untitled script", body: "", chars: 0, stage: "scripts", notes: "", scriptLink: "", videoLink: "", thumbnail: "", voiceover: "", updatedAt: Date.now(), updatedBy: (state.me && state.me.name) || "Someone" };
  try { await store.upsert(s, "create"); setTimeout(() => openDrawer(s.id), 80); toast("New script added", "good"); }
  catch (e) { toast(e.forbidden ? "No permission" : "Couldn't add"); }
}

// ============================================================================
//  MEMBERS & ACCESS (owner)
// ============================================================================
function openMembers() {
  if (!state.isOwner) { toast("Only the owner can manage access"); return; }
  $("#membersHint").textContent = `Give or remove access for each editor on “${$("#boardName").textContent}”.`;
  $$("#defaultAccess button").forEach((b) => b.classList.toggle("active", b.dataset.acc === state.newMemberAccess));
  renderMembersList();
  $("#membersModal").classList.remove("hidden");
}
function renderMembersList() {
  const root = $("#membersList"); root.innerHTML = "";
  if (state.members.length === 0) { root.innerHTML = `<div class="activity-empty">No one has joined yet. Share the board link to invite editors.</div>`; return; }
  state.members.forEach((m) => {
    const row = el("div", "member-row");
    const role = m.role || "editor";
    const count = state.scripts.filter((s) => s.assignee === m.id || s.assigneeName === m.name).length;
    row.innerHTML = `${avatarHTML(m.name, m.photo, "avatar")}
      <div class="member-main" title="See scripts assigned to ${esc(m.name)}"><div class="mname">${esc(m.name)} ${m.id === clientId() ? '<span class="role-tag">you</span>' : ""}</div>
      <div class="msub"><span class="online-dot ${m.online ? "" : "off"}"></span>${m.online ? "online" : "offline"} · ${role} · <b>${count}</b> assigned</div></div>
      <select ${role === "owner" ? "disabled" : ""} data-id="${m.id}">
        ${["viewer", "editor", "manager", "owner"].map((r) => `<option value="${r}" ${r === role ? "selected" : ""}>${r === "viewer" ? "View only" : r === "editor" ? "Editor" : r === "manager" ? "Manager" : "Owner"}</option>`).join("")}
      </select>`;
    $("select", row).addEventListener("change", async (e) => { try { await store.setMember(m.id, { role: e.target.value }); toast(`${m.name} → ${e.target.value}`, "good"); } catch { toast("Couldn't update"); } });
    $(".member-main", row).addEventListener("click", () => { state.assigneeFilter = { id: m.id, name: m.name }; $("#membersModal").classList.add("hidden"); render(); toast(`Showing ${m.name}'s scripts`, "info"); });
    root.appendChild(row);
  });
}

// ============================================================================
//  SHARE (email invite)
// ============================================================================
function boardLink() {
  const base = location.origin + location.pathname;
  return store.caps.boards ? `${base}?board=${encodeURIComponent(state.board)}` : base;
}
function openShare() {
  $("#shareLink").value = boardLink();
  // owner picks how newcomers join; non-owners just see the link
  const ir = $("#inviteRole");
  ir.classList.toggle("hidden", !state.isOwner);
  $$("#inviteRole button").forEach((b) => b.classList.toggle("active", b.dataset.acc === state.newMemberAccess));
  if (state.passwordSet) $("#sharePwNote").classList.remove("hidden"); else $("#sharePwNote").classList.add("hidden");
  $("#shareModal").classList.remove("hidden");
}
function setupShare() {
  $("#shareBtn").addEventListener("click", openShare);
  $("#copyLink").addEventListener("click", () => { navigator.clipboard.writeText($("#shareLink").value); toast("Link copied", "good"); });
  $("#inviteRole").addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    $$("#inviteRole button").forEach((x) => x.classList.toggle("active", x === b));
    state.newMemberAccess = b.dataset.acc;
    try { await store.boardSettings({ newMemberAccess: b.dataset.acc }); toast(b.dataset.acc === "edit" ? "New editors can edit right away" : "New people join as view-only", "good"); }
    catch { toast("Owner only"); }
  });
  $("#sendInvite").addEventListener("click", () => {
    const email = $("#inviteEmail").value.trim();
    const link = $("#shareLink").value;
    const roleWord = state.newMemberAccess === "view" ? "viewer (you can promote them later)" : "an editor";
    const pwLine = state.passwordSet ? `\n\nThis board is password-protected — I'll share the password with you separately.` : "";
    const subject = encodeURIComponent("Join my ScriptFlow board — Editing Hub Agency");
    const body = encodeURIComponent(`Hi,\n\nYou're invited to collaborate on my reel-script board on ScriptFlow as ${roleWord}.\n\nOpen this link on your phone or computer to join live:\n${link}${pwLine}\n\nSee you there!\n— ${state.me ? state.me.name : "Editing Hub"}`);
    window.location.href = `mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`;
    toast("Opening your email app…", "info");
  });
}

// ============================================================================
//  SETTINGS
// ============================================================================
function setupSettings() {
  $("#settingsBtn").addEventListener("click", () => {
    $("#welcomeToggle").checked = settings.welcomeVoice;
    $("#notifyToggle").checked = settings.notify;
    $("#soundToggle").checked = settings.sound;
    $("#ownerSettings").classList.toggle("hidden", !state.isOwner);
    $("#unlockOwnerBtn").classList.toggle("hidden", state.isOwner || !store.caps.perms);
    if (state.isOwner) {
      $("#boardNameInput").value = $("#boardName").textContent;
      $("#ownerNameInput").value = (state.me && state.me.name) || "";
      $("#boardPwInput").value = "";
      $("#boardPwInput").placeholder = state.passwordSet ? "•••••• (set — type to change)" : "No password — type one to lock";
      $("#logoPreview").src = state.logo || "";
      $("#logoPreview").classList.toggle("hidden", !state.logo);
      $("#imagePreview").src = state.boardImage || "";
      $("#imagePreview").classList.toggle("hidden", !state.boardImage);
    }
    $("#settingsModal").classList.remove("hidden");
  });
  // logo / board image uploads (owner)
  const uploadInto = async (file, field, maxPx, okMsg) => {
    if (!file) return;
    toast("Uploading…");
    try {
      const f = await resizeImage(file, maxPx);
      const url = await store.upload(f);
      await store.boardSettings({ [field]: url });
      if (field === "logo") { state.logo = url; renderBranding(); $("#logoPreview").src = url; $("#logoPreview").classList.remove("hidden"); }
      else { state.boardImage = url; $("#imagePreview").src = url; $("#imagePreview").classList.remove("hidden"); }
      toast(okMsg, "good");
    } catch { toast("Couldn't save (owner only?)"); }
  };
  $("#logoBtn").addEventListener("click", () => $("#logoInput").click());
  $("#logoInput").addEventListener("change", (e) => uploadInto(e.target.files[0], "logo", 240, "Logo updated"));
  $("#imageBtn").addEventListener("click", () => $("#imageInput").click());
  $("#imageInput").addEventListener("change", (e) => uploadInto(e.target.files[0], "image", 1200, "Board image updated"));
  $("#welcomeToggle").addEventListener("change", (e) => { settings.welcomeVoice = e.target.checked; localStorage.setItem("sf:welcome", e.target.checked ? "1" : "0"); if (e.target.checked) speakWelcome(true); });
  $("#notifyToggle").addEventListener("change", (e) => { settings.notify = e.target.checked; localStorage.setItem("sf:notify", e.target.checked ? "1" : "0"); if (e.target.checked) maybeAskNotify(); });
  $("#soundToggle").addEventListener("change", (e) => { settings.sound = e.target.checked; localStorage.setItem("sf:sound", e.target.checked ? "1" : "0"); if (e.target.checked) chime(); });
  $("#saveOwnerSettings").addEventListener("click", async () => {
    const change = { name: $("#boardNameInput").value.trim() };
    const pin = $("#ownerPinInput").value.trim(); if (pin) change.ownerPin = pin;
    const oname = $("#ownerNameInput").value.trim(); if (oname) change.ownerName = oname;
    const pw = $("#boardPwInput").value.trim(); if (pw) change.password = pw;
    try {
      await store.boardSettings(change);
      if (pin) { state.me.pin = pin; store.setIdentity(state.me, pin); }
      if (oname && state.me) { state.me.name = oname; saveMe(state.me); store.setIdentity(state.me, state.me.pin); renderMe(); }
      if (pw) { store.setKey(pw); state.passwordSet = true; }   // owner keeps access
      $("#boardName").textContent = change.name; await loadBoards();
      toast("Board settings saved", "good"); $("#settingsModal").classList.add("hidden");
    }
    catch { toast("Couldn't save (owner only)"); }
  });
  $("#unlockOwnerBtn").addEventListener("click", async () => {
    const pin = prompt("Enter the owner PIN to unlock manage access:"); if (!pin) return;
    try { const r = await store.claimOwner({ pin: pin.trim() }); if (r.ok) { state.me.pin = pin.trim(); store.setIdentity(state.me, pin.trim()); await refreshPerms(); toast("Owner access unlocked", "good"); $("#settingsModal").classList.add("hidden"); } else toast("Wrong PIN"); }
    catch { toast("Couldn't verify PIN"); }
  });
  $("#defaultAccess").addEventListener("click", async (e) => { const b = e.target.closest("button"); if (!b) return; $$("#defaultAccess button").forEach((x) => x.classList.toggle("active", x === b)); state.newMemberAccess = b.dataset.acc; try { await store.boardSettings({ newMemberAccess: b.dataset.acc }); toast("Default access updated", "good"); } catch { toast("Owner only"); } });
}

// ============================================================================
//  VOICE WELCOME
// ============================================================================
function speakWelcome(force) {
  if (!settings.welcomeVoice) return;
  if (spokeWelcome && !force) return;
  spokeWelcome = true;
  const who = (state.me && state.me.name ? state.me.name.split(/\s+/)[0] : "").trim();
  const phrase = who ? `Welcome ${who}, to Editing Hub Agency` : "Welcome to Editing Hub Agency";
  try {
    const say = () => { const u = new SpeechSynthesisUtterance(phrase); u.rate = 0.95; u.pitch = 1.0; u.volume = 1; window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); };
    if (window.speechSynthesis.getVoices().length) say(); else { window.speechSynthesis.onvoiceschanged = say; setTimeout(say, 250); }
  } catch {}
}

// ============================================================================
//  LOGIN GATE (board password)
// ============================================================================
function showLogin() {
  return new Promise((resolve) => {
    const m = $("#loginModal"); m.classList.remove("hidden");
    const inp = $("#loginPw"), btn = $("#loginBtn"), err = $("#loginErr");
    inp.value = ""; err.classList.add("hidden");
    setTimeout(() => inp.focus(), 50);
    const submit = async () => {
      const pw = inp.value.trim(); if (!pw) return;
      btn.disabled = true; btn.textContent = "Checking…";
      let ok = false; try { ok = await store.login(pw); } catch {}
      btn.disabled = false; btn.textContent = "Enter";
      if (ok) { m.classList.add("hidden"); resolve(); }
      else { err.classList.remove("hidden"); inp.select(); }
    };
    btn.onclick = submit;
    inp.onkeydown = (e) => { if (e.key === "Enter") submit(); };
  });
}

// ============================================================================
//  TELEPROMPTER
// ============================================================================
let tp = { raf: null, pos: 0, speed: 0, playing: false };
function openTeleprompter(text) {
  const root = $("#teleprompter"), inner = $("#tpInner"); inner.textContent = text; root.classList.remove("hidden");
  tp.pos = 0; tp.speed = 1.1; tp.playing = false; inner.style.transform = "translateY(0)"; $("#tpPlay").textContent = "▶ Play";
  const step = () => { if (tp.playing) { tp.pos += tp.speed; inner.style.transform = `translateY(${-tp.pos}px)`; if (tp.pos > inner.scrollHeight) { tp.playing = false; $("#tpPlay").textContent = "▶ Play"; } } tp.raf = requestAnimationFrame(step); };
  cancelAnimationFrame(tp.raf); step();
}
function closeTeleprompter() { tp.playing = false; cancelAnimationFrame(tp.raf); $("#teleprompter").classList.add("hidden"); }
function setupTeleprompter() {
  $("#tpClose").addEventListener("click", closeTeleprompter);
  $("#tpPlay").addEventListener("click", () => { tp.playing = !tp.playing; $("#tpPlay").textContent = tp.playing ? "⏸ Pause" : "▶ Play"; });
  $("#tpFaster").addEventListener("click", () => tp.speed = Math.min(6, tp.speed + 0.4));
  $("#tpSlower").addEventListener("click", () => tp.speed = Math.max(0.3, tp.speed - 0.4));
  $("#tpFont").addEventListener("input", (e) => $("#tpInner").style.fontSize = e.target.value + "px");
}

// ============================================================================
//  RENDER ROOT
// ============================================================================
function render() {
  renderStats();
  if (state.view === "board") { $("#board").classList.remove("hidden"); $("#listview").classList.add("hidden"); renderBoard(); }
  else { $("#board").classList.add("hidden"); $("#listview").classList.remove("hidden"); renderList(); }
  if (state.openId) renderDrawer();
}

// ============================================================================
//  CONTROLS
// ============================================================================
function closeMenus() { $("#boardMenu").classList.add("hidden"); $("#activityPanel").classList.add("hidden"); }
function setupControls() {
  $("#newBtn").addEventListener("click", newScript);
  $("#drawerOverlay").addEventListener("click", closeDrawer);
  $("#searchInput").addEventListener("input", (e) => { state.search = e.target.value; render(); });
  $("#viewToggle").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; state.view = b.dataset.view; $$("#viewToggle button").forEach((x) => x.classList.toggle("active", x === b)); render(); });
  $("#themeBtn").addEventListener("click", () => { const h = document.documentElement; const n = h.dataset.theme === "dark" ? "light" : "dark"; h.dataset.theme = n; localStorage.setItem("scriptflow:theme", n); });
  $("#boardBtn").addEventListener("click", (e) => { e.stopPropagation(); renderBoardMenu(); $("#activityPanel").classList.add("hidden"); $("#boardMenu").classList.toggle("hidden"); });
  $("#bellBtn").addEventListener("click", (e) => { e.stopPropagation(); $("#boardMenu").classList.add("hidden"); const p = $("#activityPanel"); const open = p.classList.contains("hidden"); if (open) { renderActivityPanel(); p.classList.remove("hidden"); state.unread = 0; renderBell(); } else p.classList.add("hidden"); });
  document.addEventListener("click", (e) => { if (!e.target.closest(".board-switch") && !e.target.closest(".bell-wrap")) closeMenus(); });
  $$("[data-close]").forEach((b) => b.addEventListener("click", () => $("#" + b.dataset.close).classList.add("hidden")));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { if (!$("#teleprompter").classList.contains("hidden")) closeTeleprompter(); else if (state.openId) closeDrawer(); else closeMenus(); }
    if (e.key === "n" && !/input|textarea|select/i.test(e.target.tagName) && !e.target.isContentEditable) newScript();
  });
  // speak welcome on first interaction if it was blocked on load
  window.addEventListener("pointerdown", () => speakWelcome(false), { once: true });
}

// ============================================================================
//  BOOT
// ============================================================================
async function boot() {
  const savedTheme = localStorage.getItem("scriptflow:theme"); if (savedTheme) document.documentElement.dataset.theme = savedTheme;
  // board from invite link
  const urlBoard = new URLSearchParams(location.search).get("board"); if (urlBoard) { state.board = urlBoard; localStorage.setItem("scriptflow:board", urlBoard); }

  state.me = loadMe();
  setupIdentity(); setupControls(); setupTeleprompter(); setupShare(); setupSettings();
  renderMe();

  store = await pickStore();
  if (state.me) store.setIdentity(state.me, state.me.pin);

  // password gate — if this board is locked, ask before loading anything
  try {
    const ls = await store.lockStatus();
    if (ls.locked) await showLogin();
  } catch {}

  await store.start({
    onScripts: (s) => { state.scripts = s; render(); },
    onStatus: (st) => { state.status = st; renderStatus(); },
    onMembers: (m) => { state.members = m; renderPresence(); if (!$("#membersModal").classList.contains("hidden")) renderMembersList(); },
    onActivity: (a) => onActivity(a),
    onActivityLog: (l) => onActivityLog(l),
  });
  await store.seedIfEmpty(SEED_SCRIPTS);
  await loadBoards();
  renderStatus();

  if (!store.caps.members) { $("#presence").classList.add("hidden"); $("#bellBtn").parentElement.classList.add("hidden"); }

  if (!state.me) openIdentity();
  else { heartbeat(); await refreshPerms(); maybeAskNotify(); speakWelcome(false); }
  setInterval(heartbeat, 20000);
}
boot();
