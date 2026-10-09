#!/usr/bin/env bash
# Keep recently deployed hashed chunks available to already-open browser tabs.
set -euo pipefail

CURRENT_DIST="$1"
PREVIOUS_DIST="$2"
RELEASE_DIST="$3"

mkdir -p "${RELEASE_DIST}"
rsync -a --delete "${CURRENT_DIST}/" "${RELEASE_DIST}/"
if [[ -n "${PREVIOUS_DIST}" && -d "${PREVIOUS_DIST}/assets" ]]; then
  mkdir -p "${RELEASE_DIST}/assets"
  rsync -a --ignore-existing "${PREVIOUS_DIST}/assets/" "${RELEASE_DIST}/assets/"
fi
# Old browser tabs get the recovery screen after this window.
find "${RELEASE_DIST}/assets" -type f -mtime +30 -delete
