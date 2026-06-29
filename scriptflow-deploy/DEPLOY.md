# 🌍 Put ScriptFlow online — permanent link, data saved in the cloud

This makes your board run **24/7 on the internet** with a **fixed link that never
changes**, and all your data saved in **Firebase** (Google's free cloud database).
Everything works even when your PC is off.

You'll create **two free accounts** (no credit card): **Firebase** (data) and
**Render** (the always-on host). If you don't already have a GitHub account you'll
make that too — also free, also no card. I do all the wiring; you just click.

---

## Step 1 — Firebase (your cloud database)  ~5 min
1. Go to **https://console.firebase.google.com** and sign in with your Google account.
2. Click **Add project** → name it `editing-hub` → keep clicking **Continue**
   (you can turn **off** Google Analytics) → **Create project**.
3. In the left menu open **Build → Realtime Database** → **Create Database**.
   - Pick a location → choose **Start in test mode** → **Enable**.
4. Copy the database **URL** at the top — it looks like
   `https://editing-hub-default-rtdb.firebaseio.com`.
5. Get a secret so only our app can write:
   **⚙ (gear) → Project settings → Service accounts → Database secrets →
   Show → copy** the secret string.

➡️ **Send me those two things:** the **database URL** and the **secret**.
   I'll load all your current data (your 22 scripts, your team, your password)
   straight into it and test it.

---

## Step 2 — Put the code on GitHub  ~5 min
(You only upload files in the browser — no commands.)
1. Go to **https://github.com** → sign up (free) if you don't have an account.
2. Click **+ → New repository** → name it `scriptflow` → keep it **Private** →
   **Create repository**.
3. On the new repo page click **uploading an existing file**.
4. Drag in **everything from the `scriptflow-deploy.zip` I prepared** (unzip first),
   then **Commit changes**.

➡️ Tell me your GitHub username + repo name and I'll double-check it.

---

## Step 3 — Render (the always-on host)  ~5 min
1. Go to **https://render.com** → **Get Started** → sign up with your GitHub account.
2. Click **New + → Blueprint**.
3. Connect/pick your **scriptflow** repo → Render reads `render.yaml` automatically.
4. It will ask for two secret values — paste:
   - **FIREBASE_DB_URL** = the database URL from Step 1
   - **FIREBASE_SECRET** = the secret from Step 1
5. Click **Apply / Create**. Wait ~2–3 minutes for it to build.
6. Render gives you a permanent link like **`https://scriptflow-xxxx.onrender.com`**.

➡️ Send me that link — I'll open it, log in, and confirm all your scripts, team,
   media, dates, columns, and password are there and working.

---

## Good to know
- **Free tier sleep:** after ~15 min with nobody on it, the site naps. The next
  person to open it waits ~30–50 seconds while it wakes, then it's fast for everyone.
  (Upgrading Render to the $7/mo plan removes the nap — optional, any time.)
- **Your data is safe in Firebase**, not on the host, so redeploys never lose it.
- **The old PC links** (`localhost` / the trycloudflare link) keep working too —
  but once you're on the Render link, share **that** one; it's the permanent one.
- **Uploaded images** (thumbnails, logos, photos) are saved inside the database so
  they're permanent. For big audio voiceovers, paste a link (Drive/Dropbox) instead
  of uploading, to keep things fast.
