#!/usr/bin/env bash
set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CREDENTIALS_DIR="${MOBILE_DIR}/credentials"
KEYSTORE="${CREDENTIALS_DIR}/lotaya-rider-upload.p12"
ENV_FILE="${MOBILE_DIR}/.env.release.local"

command -v keytool >/dev/null || { echo "A JDK with keytool is required." >&2; exit 1; }
[[ ! -e "${KEYSTORE}" && ! -e "${ENV_FILE}" ]] || { echo "Signing credentials already exist. Back them up; this script will not overwrite them." >&2; exit 1; }
mkdir -p "${CREDENTIALS_DIR}"
PASSWORD="$(openssl rand -hex 24)"
keytool -genkeypair -v -storetype PKCS12 -keystore "${KEYSTORE}" -storepass "${PASSWORD}" -keypass "${PASSWORD}" -alias lotaya-rider -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=LOTAYA Rider, O=LOTAYA, C=MM"
umask 077
printf "LOTAYA_ANDROID_KEYSTORE='%s'\nLOTAYA_ANDROID_STORE_PASSWORD='%s'\nLOTAYA_ANDROID_KEY_ALIAS='lotaya-rider'\nLOTAYA_ANDROID_KEY_PASSWORD='%s'\n" "${KEYSTORE}" "${PASSWORD}" "${PASSWORD}" > "${ENV_FILE}"
echo "Created the LOTAYA Rider signing key and local environment file."
echo "Back up both of these files securely before publishing:"
echo "  ${KEYSTORE}"
echo "  ${ENV_FILE}"
