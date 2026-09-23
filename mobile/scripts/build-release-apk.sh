#!/usr/bin/env bash
set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "${MOBILE_DIR}/.." && pwd)"
ENV_FILE="${MOBILE_DIR}/.env.release.local"
[[ -s "${ENV_FILE}" ]] || { echo "Missing ${ENV_FILE}. Run npm run signing:setup first." >&2; exit 1; }
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a
export NODE_ENV=production
for variable in LOTAYA_ANDROID_KEYSTORE LOTAYA_ANDROID_STORE_PASSWORD LOTAYA_ANDROID_KEY_ALIAS LOTAYA_ANDROID_KEY_PASSWORD; do
  [[ -n "${!variable:-}" ]] || { echo "${variable} is required in ${ENV_FILE}." >&2; exit 1; }
done
[[ -s "${LOTAYA_ANDROID_KEYSTORE}" ]] || { echo "Signing keystore not found: ${LOTAYA_ANDROID_KEYSTORE}" >&2; exit 1; }

cd "${MOBILE_DIR}"
CI=1 npx expo prebuild --clean --platform android
cd android
./gradlew app:assembleRelease

APK="${MOBILE_DIR}/android/app/build/outputs/apk/release/app-release.apk"
[[ -s "${APK}" ]] || { echo "Release APK was not produced." >&2; exit 1; }
mkdir -p "${REPO_DIR}/releases"
install -m 644 "${APK}" "${REPO_DIR}/releases/lotaya-rider.apk"
node -p "require('${MOBILE_DIR}/app.json').expo.version" > "${REPO_DIR}/releases/lotaya-rider.version"
echo "Signed Rider APK staged at ${REPO_DIR}/releases/lotaya-rider.apk"
