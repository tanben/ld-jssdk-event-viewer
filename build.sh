#!/usr/bin/env bash
#
# Build script for the LD SDK Event Viewer bookmarklet.
#
# Copies the extension's panel.js and the bookmarklet modules into
# docs/dist/v1/ so they can be served via GitHub Pages at a stable
# versioned path.
#
# Usage:
#   ./build.sh                   # builds to docs/dist/v1
#   ./build.sh v2                # builds to docs/dist/v2
#
set -euo pipefail

VERSION="${1:-v1}"
SRC_DIR="bookmarklet"
DIST_DIR="docs/dist/${VERSION}"

echo "==> Building bookmarklet assets into ${DIST_DIR}/"

rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}"

# Copy extension files (shared with bookmarklet at runtime)
for f in goalTracker-mod.js panel.js; do
  cp "${f}" "${DIST_DIR}/${f}" && chmod 644 "${DIST_DIR}/${f}"
  echo "    ${f} (extension)"
done

# Copy shared extension files (hot-linked by bookmarklet)
cp mystyle.css "${DIST_DIR}/mystyle.css" && chmod 644 "${DIST_DIR}/mystyle.css"
echo "    mystyle.css (extension)"
cp panel.html "${DIST_DIR}/panel.html" && chmod 644 "${DIST_DIR}/panel.html"
echo "    panel.html (extension)"

# Copy bookmarklet modules
for f in loader.js interceptors.js bookmarklet.js bookmarklet-overrides.css; do
  cp "${SRC_DIR}/${f}" "${DIST_DIR}/${f}" && chmod 644 "${DIST_DIR}/${f}"
  echo "    ${f}"
done

echo "==> Done. Assets available at ${DIST_DIR}/"
echo ""
echo "GitHub Pages URL pattern:"
echo "  https://<user>.github.io/<repo>/dist/${VERSION}/loader.js"
