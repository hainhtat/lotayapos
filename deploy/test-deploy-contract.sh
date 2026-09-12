#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)";trap 'rm -rf "${TMP}"' EXIT
if LOTAYA_CERT_DIR="${TMP}/missing" bash "${REPO}/deploy/check-deploy-prerequisites.sh" >/dev/null 2>&1; then echo "missing TLS certificate was accepted" >&2;exit 1;fi
mkdir -p "${TMP}/cert"
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj '/CN=lotaya.mmds.site' -addext 'subjectAltName=DNS:lotaya.mmds.site' -keyout "${TMP}/cert/privkey.pem" -out "${TMP}/cert/fullchain.pem" >/dev/null 2>&1
LOTAYA_CERT_DIR="${TMP}/cert" bash "${REPO}/deploy/check-deploy-prerequisites.sh" >/dev/null
grep -q 'listen 443 ssl;' "${REPO}/deploy/nginx/lotaya.mmds.site.conf"
grep -q 'http2 on;' "${REPO}/deploy/nginx/lotaya.mmds.site.conf"
if grep -q 'listen .*http2' "${REPO}/deploy/nginx/lotaya.mmds.site.conf"; then echo "deprecated listen http2 syntax remains" >&2;exit 1;fi
grep -q 'return 308 https://' "${REPO}/deploy/nginx/lotaya.mmds.site.conf"
grep -q '/opt/lotaya/current/backend' "${REPO}/deploy/systemd/lotaya-api.service"
grep -q 'PREVIOUS_RELEASE=' "${REPO}/deploy.sh"
grep -q 'ln -sfn.*current.next' "${REPO}/deploy.sh"
grep -q 'curl.*health' "${REPO}/deploy.sh"
grep -q 'for _attempt in {1..30}' "${REPO}/deploy.sh"
grep -q 'dist/scripts/audit-os-cutover.js' "${REPO}/deploy.sh"
grep -q 'No previous atomic release exists; retaining' "${REPO}/deploy.sh"
PULL_LINE="$(grep -n 'git pull --ff-only' "${REPO}/deploy.sh" | cut -d: -f1)"
RELEASE_CHECK_LINE="$(grep -n 'bash "${REPO}/deploy/check-deploy-prerequisites.sh"' "${REPO}/deploy.sh" | tail -n 1 | cut -d: -f1)"
BUILD_LINE="$(grep -n 'npm ci --include=dev' "${REPO}/deploy.sh" | head -n 1 | cut -d: -f1)"
[[ "${PULL_LINE}" -lt "${RELEASE_CHECK_LINE}" && "${RELEASE_CHECK_LINE}" -lt "${BUILD_LINE}" ]] || {
  echo "checked-out release prerequisites are not enforced after pull and before build" >&2
  exit 1
}
echo "Deployment TLS/staging contract passed."
