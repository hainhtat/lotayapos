#!/usr/bin/env bash
set -euo pipefail
command -v node >/dev/null || { echo "Node.js 22 is required to deploy Lotaya." >&2; exit 1; }
NODE_VERSION="${LOTAYA_NODE_VERSION:-$(node -p 'process.versions.node')}"
IFS=. read -r NODE_MAJOR NODE_MINOR _NODE_PATCH <<< "${NODE_VERSION}"
if [[ "${NODE_MAJOR}" -ne 22 || "${NODE_MINOR}" -lt 13 ]]; then
  echo "Node.js 22.13 or newer (but below 23) is required; found ${NODE_VERSION}. Run 'nvm install 22 && nvm use 22' before deploying." >&2
  exit 1
fi
CERT_DIR="${LOTAYA_CERT_DIR:-/etc/letsencrypt/live/lotaya.mmds.site}"
LOTAYA_HOSTNAMES="${LOTAYA_HOSTNAMES:-lotaya.mmds.site lt.mmds.site}"
for file in fullchain.pem privkey.pem; do
  [[ -s "${CERT_DIR}/${file}" ]] || { echo "Missing TLS prerequisite: ${CERT_DIR}/${file}. Provision a valid lotaya.mmds.site certificate before deploying." >&2; exit 1; }
done
command -v openssl >/dev/null || { echo "openssl is required to validate TLS certificates" >&2; exit 1; }
openssl x509 -in "${CERT_DIR}/fullchain.pem" -checkend 86400 -noout >/dev/null || { echo "TLS certificate is invalid or expires within 24 hours" >&2; exit 1; }
for hostname in ${LOTAYA_HOSTNAMES}; do
  openssl x509 -in "${CERT_DIR}/fullchain.pem" -noout -checkhost "${hostname}" >/dev/null || { echo "TLS certificate does not cover ${hostname}" >&2; exit 1; }
done
command -v curl >/dev/null || { echo "curl is required for readiness checks" >&2; exit 1; }
echo "Deployment prerequisites passed."
