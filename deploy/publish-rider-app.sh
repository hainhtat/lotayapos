#!/usr/bin/env bash
set -euo pipefail

REPO="${1:?repository path required}"
APP_DIR="${2:?published app directory required}"
mkdir -p "${APP_DIR}"
install -m 644 "${REPO}/deploy/app/index.html" "${APP_DIR}/index.html"
install -m 644 "${REPO}/mobile/assets/icon.png" "${APP_DIR}/icon.png"

VERSION="$(node -p "require('${REPO}/mobile/app.json').expo.version")"
APK="${REPO}/releases/lotaya-rider.apk"
RELEASE_VERSION_FILE="${REPO}/releases/lotaya-rider.version"
if [[ ! -f "${APK}" ]] || [[ ! -f "${RELEASE_VERSION_FILE}" ]] || [[ "$(tr -d '[:space:]' < "${RELEASE_VERSION_FILE}")" != "${VERSION}" ]]; then
  echo "No version-matched Rider APK in releases; keeping the currently published APK and metadata."
  exit 0
fi

EXPECTED_PACKAGE="$(node -p "require('${REPO}/mobile/app.json').expo.android.package")"
EXPECTED_VERSION_CODE="$(node -p "require('${REPO}/mobile/app.json').expo.android.versionCode")"
if command -v aapt >/dev/null 2>&1; then
  BADGING="$(aapt dump badging "${APK}")" || { echo "APK manifest inspection failed; retaining published APK." >&2; exit 1; }
  ACTUAL_PACKAGE="$(printf '%s\n' "${BADGING}" | sed -n "s/^package: name='\([^']*\)'.*/\1/p")"
  ACTUAL_VERSION_CODE="$(printf '%s\n' "${BADGING}" | sed -n "s/^package: .*versionCode='\([^']*\)'.*/\1/p")"
  ACTUAL_VERSION_NAME="$(printf '%s\n' "${BADGING}" | sed -n "s/^package: .*versionName='\([^']*\)'.*/\1/p")"
elif command -v apkanalyzer >/dev/null 2>&1; then
  ACTUAL_PACKAGE="$(apkanalyzer manifest application-id "${APK}")"
  ACTUAL_VERSION_CODE="$(apkanalyzer manifest version-code "${APK}")"
  ACTUAL_VERSION_NAME="$(apkanalyzer manifest version-name "${APK}")"
else
  echo "aapt or apkanalyzer is required to verify Rider APK metadata; retaining published APK." >&2; exit 1
fi
[[ "${ACTUAL_PACKAGE}" == "${EXPECTED_PACKAGE}" && "${ACTUAL_VERSION_CODE}" == "${EXPECTED_VERSION_CODE}" && "${ACTUAL_VERSION_NAME}" == "${VERSION}" ]] || { echo "Rider APK manifest does not match package/version configuration; retaining published APK." >&2; exit 1; }
command -v apksigner >/dev/null 2>&1 || { echo "apksigner is required to verify Rider APK signing; retaining published APK." >&2; exit 1; }
SIGNATURE="$(apksigner verify --verbose --print-certs "${APK}")" || { echo "Rider APK signature verification failed; retaining published APK." >&2; exit 1; }
printf '%s\n' "${SIGNATURE}" | grep -qi "Signer #1 certificate DN:" || { echo "Rider APK has no verified signer identity; retaining published APK." >&2; exit 1; }
if printf '%s\n' "${SIGNATURE}" | grep -qiE "Android Debug|CN=Android Debug"; then echo "Debug-signed Rider APK rejected; retaining published APK." >&2; exit 1; fi

APK_TEMP="${APP_DIR}/.lotaya-rider.apk.$$"
install -m 644 "${APK}" "${APK_TEMP}"
APK_SIZE="$(wc -c < "${APK}" | tr -d '[:space:]')"
if command -v sha256sum >/dev/null 2>&1; then APK_SHA256="$(sha256sum "${APK}" | cut -d ' ' -f1)"; else APK_SHA256="$(shasum -a 256 "${APK}" | cut -d ' ' -f1)"; fi
METADATA_TEMP="${APP_DIR}/.version.json.$$"
cat > "${METADATA_TEMP}" <<EOF
{"version":"${VERSION}","apkUrl":"https://lotaya.mmds.site/app/lotaya-rider.apk","sizeBytes":${APK_SIZE},"sha256":"${APK_SHA256}"}
EOF
mv -f "${APK_TEMP}" "${APP_DIR}/lotaya-rider.apk"
mv -f "${METADATA_TEMP}" "${APP_DIR}/version.json"
