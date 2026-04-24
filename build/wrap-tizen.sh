#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$REPO_ROOT/dist"
TIZEN_APP_DIR="$REPO_ROOT/tizen-app"
RELEASE_DIR="$REPO_ROOT/release"

# Locate or clone TizenTube source
if [ -d "$REPO_ROOT/.references/TizenTube" ]; then
    TIZENTUBE_SRC="$REPO_ROOT/.references/TizenTube"
elif [ -n "${TIZENTUBE_SRC_DIR:-}" ] && [ -d "$TIZENTUBE_SRC_DIR" ]; then
    TIZENTUBE_SRC="$TIZENTUBE_SRC_DIR"
else
    CLONE_DIR="/tmp/tizentube-src-$$"
    echo "Cloning TizenTube..."
    git clone --depth=1 https://github.com/reisxd/TizenTube "$CLONE_DIR"
    TIZENTUBE_SRC="$CLONE_DIR"
fi

echo "Using TizenTube source: $TIZENTUBE_SRC"

# Build userScript
echo "Building userScript..."
cd "$TIZENTUBE_SRC/mods"
npm ci --prefer-offline
npm run build
cd "$REPO_ROOT"

# Build service (using our modified service.js)
echo "Building service..."
cp "$REPO_ROOT/service/service.js" "$TIZENTUBE_SRC/service/service.js"
cd "$TIZENTUBE_SRC/service"
npm ci --prefer-offline
npx rollup -c rollup.config.js
cd "$REPO_ROOT"

# Gather built artifacts
mkdir -p "$DIST_DIR"
cp "$TIZENTUBE_SRC/dist/userScript.js" "$DIST_DIR/userScript.js"
cp "$TIZENTUBE_SRC/dist/service.js"    "$DIST_DIR/service.js"

# Populate tizen-app with built artifacts
mkdir -p "$TIZEN_APP_DIR/service"
cp "$DIST_DIR/userScript.js" "$TIZEN_APP_DIR/userScript.js"
cp "$DIST_DIR/service.js"    "$TIZEN_APP_DIR/service/service.js"

# Copy TizenBrew icon if no local icon exists
if [ ! -f "$TIZEN_APP_DIR/icon.png" ]; then
    if [ -f "$REPO_ROOT/.references/TizenBrew/tizenbrew-app/TizenBrew/icon.png" ]; then
        cp "$REPO_ROOT/.references/TizenBrew/tizenbrew-app/TizenBrew/icon.png" "$TIZEN_APP_DIR/icon.png"
    else
        echo "WARNING: No icon.png found. Add tizen-app/icon.png (120x120 PNG) before packaging."
    fi
fi

# Build with Tizen CLI if available
if command -v tizen &>/dev/null; then
    echo "Running tizen build-web..."
    tizen build-web \
        -e ".*" \
        -e "node_modules/*" \
        -e "package*.json" \
        -- "$TIZEN_APP_DIR"

    mkdir -p "$RELEASE_DIR"
    echo "Packaging .wgt (unsigned)..."
    cd "$TIZEN_APP_DIR/.buildResult"
    zip -r "$RELEASE_DIR/TizenTubeStandalone.wgt" .
    cd "$REPO_ROOT"
    echo "Done: $RELEASE_DIR/TizenTubeStandalone.wgt"
else
    # Fallback: zip tizen-app directly (skips tizen build-web validation)
    mkdir -p "$RELEASE_DIR"
    echo "tizen CLI not found — zipping tizen-app directly (unsigned, unvalidated)..."
    cd "$TIZEN_APP_DIR"
    zip -r "$RELEASE_DIR/TizenTubeStandalone.wgt" . \
        --exclude ".*" \
        --exclude "node_modules/*" \
        --exclude "package*.json" \
        --exclude ".buildResult/*"
    cd "$REPO_ROOT"
    echo "Done: $RELEASE_DIR/TizenTubeStandalone.wgt (run 'tizen build-web' + re-zip for validated build)"
fi
