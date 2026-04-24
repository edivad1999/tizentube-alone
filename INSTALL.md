# Installing TizenTube Standalone on your Samsung TV

## Prerequisites

- A Samsung Smart TV running **Tizen 5.5 or newer** (2020+)
- **Tizen Studio** installed on your PC — download from [developer.samsung.com/tizenstudio](https://developer.samsung.com/tizenstudio/welcome)
- TV and PC on the same local network

---

## Step 1 — Download the unsigned WGT

Download `TizenTubeStandalone.wgt` from the [latest GitHub Release](../../releases/latest).

---

## Step 2 — Create a Samsung developer certificate

Open **Tizen Studio → Tools → Certificate Manager**, then:

1. Click **+** to create a new certificate profile (name it e.g. `mytv`).
2. When asked for an **Author certificate**: create a new Samsung certificate and log in with your Samsung account (free).
3. When asked for a **Distributor certificate**: choose **Samsung** → **Public** (sufficient for Developer Mode installs). Log in with the same account.
4. Click **Finish**. Your profile `mytv` is now available in Certificate Manager.

> **Note:** The Public distributor certificate allows installation only on TVs with Developer Mode enabled. This is the expected mode for self-installs.

---

## Step 3 — Re-sign the WGT with your certificate

Open a terminal and run:

```bash
tizen package -t wgt -s mytv -- /path/to/TizenTubeStandalone.wgt
```

Replace `mytv` with your certificate profile name. This produces a signed `TizenTubeStandalone.wgt` in the same directory.

If the above syntax is not accepted by your Tizen CLI version, try:

```bash
tizen package --type wgt --sign mytv -- /path/to/TizenTubeStandalone.wgt
```

---

## Step 4 — Enable Developer Mode on your TV

1. On your TV, open **Settings → Support → About Smart TV** (or **Settings → General → About This TV**).
2. Press the number buttons **1 2 3 4 5** in sequence on the remote to open the Developer Mode dialog.
3. Toggle **Developer Mode** to **ON**.
4. Enter the **Host PC IP** as the IP address of your PC on the local network (e.g. `192.168.1.100`).
5. Confirm and **restart the TV** when prompted.

> **Important:** The Host PC IP is used for installation only. Once TizenTube is installed, you can disable Developer Mode and the app keeps running without it.

---

## Step 5 — Connect and install via SDB

```bash
# Connect to your TV (replace with your TV's IP)
sdb connect 192.168.1.50

# Verify connection
sdb devices

# Install the signed WGT
sdb install /path/to/TizenTubeStandalone.wgt
```

`sdb` is in `~/tizen-studio/tools/`. Add it to your PATH if needed.

---

## Step 6 — Launch TizenTube

Find **TizenTube** in your TV's app list (Recent Apps or the full app grid). Launch it — a loading screen appears while the local proxy service starts, then YouTube TV loads with ads blocked and SponsorBlock active.

---

## Step 7 — (Optional) Disable Developer Mode

After installation you no longer need Developer Mode. Disable it in Settings to restore normal TV behavior. TizenTube will continue running on every launch.

---

## How it works

TizenTube Standalone runs a local HTTP proxy on the TV that:
1. Fetches YouTube TV (`youtube.com/tv`) on demand
2. Strips YouTube's Content Security Policy headers
3. Injects the TizenTube userscript (ad-block, SponsorBlock, PiP, etc.) into every page load
4. Serves the modified page to the Tizen webview at `http://127.0.0.1:8085/`

All traffic stays on the device. No external server, no Dev Mode loopback trick, no ongoing PC connection required.

### Signing in to YouTube

If you have previously used the Samsung YouTube app on this TV, your login cookies are stored in the TV's browser store and will be picked up automatically by TizenTube Standalone.

If you need to sign in fresh, do so via the built-in Samsung YouTube app first, then launch TizenTube — the session will carry over.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `sdb install` fails with "certificate error" | You forgot to re-sign (Step 3). |
| `sdb connect` times out | Check TV IP, same network, Developer Mode on. |
| App launches but shows blank screen | Service may be slow to start — wait 10 s and relaunch. |
| YouTube shows "not available" | TV may be geo-restricted. Try a different DNS. |
| Ads still appearing | Check that the service is running (no crash). Force-close and relaunch. |

---

## Updating

Download the new unsigned `.wgt` from Releases, re-sign (Step 3), and reinstall (Step 5). The `sdb install` command updates in-place.
