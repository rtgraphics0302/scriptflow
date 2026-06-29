# ⚡ ScriptFlow — Reel Script Studio

A professional workflow app for your Facebook Reel scripts. Each script moves
through a pipeline — **Scripts → Done → Editing → Ready → Delivered** — with
colors changing as it progresses. Works on **phone and PC**, and it's **live**:
when you mark something, your editor sees it on their screen instantly.

Your 21 scripts from `Facebook_Reel_Scripts.docx` are already loaded.

---

## 🚀 Start it (one step)

**Windows:** double-click **`start.bat`**
**Mac:** double-click **`start.command`** (first time: right-click → Open)

A window opens and your browser launches the app. That window is your live
server — leave it running. It will print two web addresses:

```
On THIS computer : http://localhost:8765
Phone / editor   : http://192.168.x.x:8765      <- share this one
```

That's it. No sign-ups, no accounts, no installs, nothing in the cloud. Your
scripts are saved on your own PC in `data.json`.

> Needs Python (already on most PCs). If `start.bat` says it's missing, install
> it once from https://www.python.org/downloads/ (tick **“Add to PATH”**) and
> double-click again.

---

## 📱 Let your editor watch — live

While the server window is running:

1. Make sure your editor's phone/PC is on the **same Wi-Fi** as your PC.
2. Send them the **`http://192.168.x.x:8765`** address it printed.
3. They open it in any browser.

Now the board is shared. You hit **Mark Done** → it turns blue and jumps to the
editor's lane **on their screen the same second**. They move it through
**Editing → Ready → Delivered**, and you see every change live. The status pill
at the top shows a green **“Live.”**

Each person types their **name + role** the first time, so every change is
labelled with who did it, and you can see who's online.

---

## 🌍 Make it PUBLIC — invite anyone, anywhere

**Double-click `start-public.bat`.** It starts the server AND creates a public
internet link for you (using the bundled `cloudflared.exe` — no account needed).

A black window opens and prints a line like:
```
https://something-something.trycloudflare.com
```
Copy that whole address and send it to anyone — your editor, your team, any
country. They open it in a browser and they're on your live board. ✅

**Keep that window open** while people use the board.

**Two things to know about this free link:**
1. It only works while your PC is on and that window is open.
2. The link **changes each time** you restart `start-public.bat`, so you send a
   fresh link each session.

### Want a PERMANENT link that's always on (even when your PC is off)?
That's the cloud version — **Firebase** (free). It gives a fixed address like
`https://your-name.web.app` that never changes and runs 24/7. Setup is a few
clicks in the Firebase console + pasting keys into `firebase-config.js` (steps
are in that file). Once keys are in, deploy the folder and you're done.

The app picks the best available automatically — **local live server → Firebase
→ this-device-only** — so it always works.

---

## ✨ Features

**Workflow**
- **Kanban board**, 5 colored stages — drag a card or tap its button to advance it.
- **Mark Done / Start Editing / Mark Ready / Deliver** on every card.
- **Add scripts** with **+ New Script** (or press `N`); edit titles & text inline.
- **Editor notes**, **teleprompter mode**, **search**, **list view**, progress bar.

**Media on every script** (open a card → “Media & links”)
- **Thumbnail** — upload an image or paste a link (shows on the card).
- **Video link**, **Script doc link**, and **Voiceover** — upload an audio file or paste a link (plays inline).

**Assign & schedule** (open a card → “Assign & schedule”)
- **Assign an editor** to each script (owner picks from the team). Click any member in **Members & Access** to see *just* the scripts assigned to them.
- **Due date** — pick a date; the card shows it and turns amber when it's soon, red when it's late.

**Make it yours** (Settings → owner section)
- **Change the owner name**, upload a **logo** (replaces the ⚡ mark) and a **board image**.
- **Personalized voice welcome** — greets each person by name: “Welcome &lt;name&gt;, to Editing Hub Agency”.

**Private board / login** (Settings → **Board password**)
- Set a password and anyone opening the link must enter it first — leave it blank for an open board. The owner stays unlocked, and the email invite reminds you to share the password separately.

**Team & channels**
- **Multiple boards** — one per channel. Top-left board switcher → “New channel board”.
- **Profile pictures** — each person adds a photo; it shows live next to their changes and in presence.
- **Invite by email** — the ✉ button opens your email app with the board link ready to send.
- **Live presence** — see who's online, with their photos.

**Notifications**
- **Activity feed** (🔔 bell) logs every change with who/what/when, and an unread badge.
- **Desktop notifications** + a **soft chime** when an editor does something (toggle in Settings).

**Access control** (owner only — Settings → set an **Owner PIN**, then board menu → **Members & access**)
- Set each editor to **View only / Editor / Manager / Owner**.
- Choose what a brand-new editor can do by default (**edit right away** or **view only**).
- Enforced on the server — a “View only” editor genuinely cannot change anything.
- Unlock owner powers on any device by entering your PIN (Settings → “I'm the owner”).

**Other**
- **Light / dark theme**, fully responsive, **copy to clipboard**.

---

## 🔁 Separate boards
Want a different board (another channel/client)? In `firebase-config.js` change
`WORKSPACE_ID`. For the local server, just keep a second copy of the folder — its
own `data.json` is its own board.

---

## 🗂 Files
| File | What it is |
|------|------------|
| `start.bat` / `start.command` | Launch on your own network (Wi-Fi) |
| `start-public.bat` | Launch + create a public link for anyone, anywhere |
| `server.py` | The live sync server (pure Python, no installs) |
| `cloudflared.exe` | Creates the public tunnel link (no account) |
| `index.html` | App shell |
| `app.css` | Styling / themes |
| `app.js` | App logic (board, drawer, teleprompter, moves) |
| `store.js` | Data layer — auto-picks live server / Firebase / local |
| `firebase-config.js` | Optional cloud sync keys |
| `seed-data.json` / `seed-data.js` | Your 21 starter scripts |
| `boards.json` | Your live saved data — all boards, scripts, members, activity |
| `media/` | Uploaded thumbnails, voiceovers, and profile photos |

No build step, no dependencies to install. It just runs.
