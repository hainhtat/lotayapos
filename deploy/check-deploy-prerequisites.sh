#!/usr/bin/env bash
set -euo pipefail
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
