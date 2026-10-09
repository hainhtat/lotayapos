#!/usr/bin/env bash
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE="$(mktemp -d)"
trap 'rm -rf "${FIXTURE}"' EXIT
mkdir -p "${FIXTURE}/current/assets" "${FIXTURE}/previous/assets" "${FIXTURE}/release"
printf 'new index' > "${FIXTURE}/current/index.html"
printf 'new chunk' > "${FIXTURE}/current/assets/batch-detail-new.js"
printf 'old chunk' > "${FIXTURE}/previous/assets/batch-detail-old.js"
printf 'expired chunk' > "${FIXTURE}/previous/assets/expired.js"
touch -t 202001010000 "${FIXTURE}/previous/assets/expired.js"

bash "${REPO}/deploy/stage-frontend-assets.sh" "${FIXTURE}/current" "${FIXTURE}/previous" "${FIXTURE}/release"

test -s "${FIXTURE}/release/index.html"
test -s "${FIXTURE}/release/assets/batch-detail-new.js"
test -s "${FIXTURE}/release/assets/batch-detail-old.js"
test ! -e "${FIXTURE}/release/assets/expired.js"
printf 'Frontend asset staging preserves chunks from the previous release.\n'
