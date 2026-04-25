# TizenTube Standalone

Standalone Samsung Tizen TV app that runs YouTube TV with ad-blocking, SponsorBlock, PiP, and more — powered by [TizenTube](https://github.com/reisxd/TizenTube).

No TizenBrew required. No `127.0.0.1` Host PC IP trick.

## How it works

Two components:

1. **`TizenTubeStandalone.wgt`** — minimal Tizen web app that opens `youtube.com/tv` directly
2. **Injection server** — connects to the TV via SDB, launches the app in debug mode, and injects the TizenTube userscript via Chrome DevTools Protocol

The server can run as a Docker container or a plain Node.js process.

---

## Install the TV app

### Prerequisites

- Samsung Smart TV, Tizen 5.5+ (2020+)
- TV and PC on the same network
- [Tizen Studio](https://developer.samsung.com/tizenstudio/welcome) installed (for signing)

### Step 1 — Download

Grab `TizenTubeStandalone.wgt` from [Releases](../../releases/latest).

### Step 2 — Create a Samsung developer certificate

Open **Tizen Studio → Tools → Certificate Manager**:

1. Click **+** → new profile (e.g. `mytv`)
2. **Author cert**: new Samsung cert, log in with Samsung account
3. **Distributor cert**: Samsung → Public → same account
4. Click **Finish**

### Step 3 — Sign the WGT

```bash
tizen package -t wgt -s mytv -- TizenTubeStandalone.wgt
```

### Step 4 — Enable Developer Mode on TV

1. **Settings → Support → About Smart TV** → press `1 2 3 4 5` on remote
2. Toggle **Developer Mode** ON
3. Set **Host PC IP** to your PC's LAN IP (e.g. `192.168.1.100`)
4. Restart TV

### Step 5 — Sideload

```bash
sdb connect <TV_IP>
sdb install TizenTubeStandalone.wgt
```

`sdb` lives in `~/tizen-studio/tools/`.

---

## Run the injection server

The server must be running whenever you use TizenTube. It connects to the TV via SDB, launches the app in debug mode, and injects the userscript.

### Option A — Docker (recommended)

**Prerequisites:** [Install Docker](https://docs.docker.com/get-docker/) for your OS.

Pull the latest image:

```bash
docker pull ghcr.io/edivad1999/tizentube-alone:latest
```

Run (exits when you close the terminal):

```bash
docker run --rm -p 3000:3000 \
  -e TV_IP=192.168.1.50 \
  -e HOST_IP=192.168.1.100 \
  ghcr.io/edivad1999/tizentube-alone
# pin a specific TizenTube version
docker run --rm -p 3000:3000 \
  -e TV_IP=192.168.1.50 \
  -e HOST_IP=192.168.1.100 \
  -e TIZENTUBE_VERSION=1.2.3 \
  ghcr.io/edivad1999/tizentube-alone
```

`TV_IP` is your Samsung TV's IP address. `HOST_IP` is your **PC's LAN IP** — the TV app calls this address to trigger injection.

Run as a persistent background service (auto-restarts on reboot):

```bash
docker run -d --restart unless-stopped --name tizentube \
  -p 3000:3000 \
  -e TV_IP=192.168.1.50 \
  -e HOST_IP=192.168.1.100 \
  ghcr.io/edivad1999/tizentube-alone
```

Or with Docker Compose — create a `compose.yml`:

```yaml
services:
  tizentube:
    image: ghcr.io/edivad1999/tizentube-alone:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      TV_IP: 192.168.1.50
      HOST_IP: 192.168.1.100   # your PC's LAN IP
      # TIZENTUBE_VERSION: "1.2.3"  # pin a version; omit to always pull latest
```

```bash
docker compose up -d
# update
docker compose pull && docker compose up -d
```

Update to latest userscript:

```bash
docker pull ghcr.io/edivad1999/tizentube-alone:latest
docker rm -f tizentube
docker run -d --restart unless-stopped --name tizentube \
  -e TV_IP=192.168.1.50 \
  ghcr.io/edivad1999/tizentube-alone
```

The image installs `@foxreis/tizentube@latest` at build time and is rebuilt on every push to main, so it always ships the current userscript.

### Option B — Node.js directly

```bash
# unzip TizenTubeServer.zip first (from the same release)
cd TizenTubeServer
npm install
node server/index.js <TV_IP> <HOST_IP>
# or
TV_IP=192.168.1.50 HOST_IP=192.168.1.100 node server/index.js
```

---

## Usage

1. Start the injection server with your TV's IP and **your PC's LAN IP** (`HOST_IP`)
2. Launch **TizenTube** from the TV's app list
3. **First run only**: a setup screen appears — use the TV remote to enter your PC's IP and press OK
4. The server launches TizenTube in debug mode and injects the userscript
5. YouTube TV loads with ads blocked, SponsorBlock active, PiP working

On subsequent launches the TV app remembers your PC's IP and triggers injection automatically.

**Forgot your PC's IP or it changed?** Hold the **red** button on the remote while on the TizenTube screen to reset and re-enter it.

---

## Updating

Download the new release, re-sign (Step 3), reinstall (Step 5). The Docker image and server bundle always pull the latest TizenTube userscript automatically.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `sdb connect` times out | Check TV IP, Developer Mode on, Host PC IP = your PC's IP |
| `sdb install` fails | Re-sign the wgt (Step 3) |
| Server: `SDB error: connection refused` | TV off or Developer Mode Host PC IP mismatch |
| Server: `No debugger URL` | App not in debug mode — wait and retry |
| TV shows "Could not reach server" | `HOST_IP` wrong or container not running; check `docker ps` |
| Setup screen appears every launch | `HOST_IP` unreachable so `fetch` fails; fix IP and hold red key to re-enter |
| Ads still showing | Ensure server is running and `HOST_IP` is correct before launching |
| YouTube shows "not available" | Network/DNS issue, unrelated to TizenTube |

---

## Building from source

```bash
# requires Node 20
bash build/wrap-tizen.sh
# output: release/TizenTubeStandalone.wgt
```

CI builds and publishes on every push to `main`. See [`.github/workflows/build-wgt.yml`](.github/workflows/build-wgt.yml).

---

## Credits

- [TizenTube](https://github.com/reisxd/TizenTube) by reisxd
- [TizenTube-Legacy](https://github.com/ThowZzy/TizenTube-Legacy) pattern by ThowZzy
