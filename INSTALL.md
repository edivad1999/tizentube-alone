# Installing TizenTube Standalone on your Samsung TV

## How it works

TizenTube Standalone consists of two parts:

1. **`TizenTubeStandalone.wgt`** — a minimal Tizen app that registers remote keys and navigates directly to `youtube.com/tv`
2. **`TizenTubeServer`** — a Node.js script running on your PC that connects to the TV via SDB, launches the app in debug mode, and injects the TizenTube userscript (ad-block, SponsorBlock, PiP, etc.) via Chrome DevTools Protocol

No `127.0.0.1` Host PC IP trick required. Normal developer mode setup with your PC's IP works.

---

## Prerequisites

- Samsung Smart TV running **Tizen 5.5+** (2020+), on the same network as your PC
- **Tizen Studio** installed — [developer.samsung.com/tizenstudio](https://developer.samsung.com/tizenstudio/welcome)
- **Node.js 18+** on your PC

---

## Step 1 — Download the release files

From [GitHub Releases](../../releases/latest) download:

- `TizenTubeStandalone.wgt`
- `TizenTubeServer.zip`

Unzip `TizenTubeServer.zip` — it contains `server/index.js`, `server/package.json`, and `dist/userScript.js`.

---

## Step 2 — Create a Samsung developer certificate

Open **Tizen Studio → Tools → Certificate Manager**:

1. Click **+**, create a new profile (name it e.g. `mytv`)
2. **Author cert**: create new Samsung certificate, log in with your Samsung account
3. **Distributor cert**: Samsung → **Public** → same account
4. Click **Finish**

---

## Step 3 — Re-sign the WGT

```bash
tizen package -t wgt -s mytv -- /path/to/TizenTubeStandalone.wgt
```

---

## Step 4 — Enable Developer Mode on your TV

1. **Settings → Support → About Smart TV** → press `1 2 3 4 5` on remote
2. Toggle **Developer Mode** to **ON**
3. Set **Host PC IP** to **your PC's LAN IP** (e.g. `192.168.1.100`)  
   *(This is the normal setting — NOT 127.0.0.1)*
4. Restart the TV when prompted

---

## Step 5 — Install the WGT

```bash
sdb connect <TV_IP>         # e.g. sdb connect 192.168.1.50
sdb devices                  # verify connection
sdb install TizenTubeStandalone.wgt
```

`sdb` is in `~/tizen-studio/tools/`. After installation, Developer Mode can be left on or off — the app keeps running either way.

---

## Step 6 — Run the PC injection server

In the directory where you unzipped `TizenTubeServer.zip`:

```bash
npm install
node server/index.js <TV_IP>
# e.g. node server/index.js 192.168.1.50
```

Keep this running in a terminal whenever you use TizenTube.

---

## Step 7 — Launch TizenTube on your TV

Find **TizenTube** in your TV's app list and launch it.

The PC server will:
1. Detect the app launch
2. Connect via SDB → launch in debug mode
3. Wait for the YouTube TV context to load
4. Inject the userscript (ads blocked, SponsorBlock active)

You'll see `userScript injected successfully.` in the server terminal.

---

## Updating

Download the new release, re-sign (Step 3), reinstall (Step 5). The server auto-picks up the new `dist/userScript.js`.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `sdb connect` times out | Check TV IP, Developer Mode on, Host PC IP = your PC's IP |
| `sdb install` fails | Re-sign the wgt (Step 3) |
| Server: `SDB error: connection refused` | TV is off or Host PC IP mismatch |
| Server: `No debugger URL` | App not in debug mode — wait and retry, or use kill method |
| Ads still showing | Server must be running BEFORE you launch the TV app |
| YouTube shows "not available" | Network/DNS issue, not related to TizenTube |
