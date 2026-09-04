#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT
APP_DIR="${TMP}/app"
FIXTURE="${TMP}/repo"
mkdir -p "${APP_DIR}" "${FIXTURE}/deploy/app" "${FIXTURE}/mobile/assets" "${FIXTURE}/releases"
mkdir -p "${TMP}/bin"
cat > "${TMP}/bin/aapt" <<'EOF'
#!/usr/bin/env bash
if [[ "${AAPT_MODE:-valid}" == wrong ]]; then echo "package: name='com.attacker.app' versionCode='2' versionName='0.1.1'";else echo "package: name='com.lotaya.rider' versionCode='2' versionName='0.1.1'";fi
EOF
cat > "${TMP}/bin/apksigner" <<'EOF'
#!/usr/bin/env bash
echo "Verifies"
if [[ "${APKSIGNER_DEBUG:-0}" == 1 ]]; then echo "Signer #1 certificate DN: CN=Android Debug, O=Android";else echo "Signer #1 certificate DN: CN=LOTAYA Release, O=LOTAYA";fi
EOF
chmod +x "${TMP}/bin/aapt" "${TMP}/bin/apksigner"
export PATH="${TMP}/bin:${PATH}"
cp "${REPO}/deploy/app/index.html" "${FIXTURE}/deploy/app/index.html"
cp "${REPO}/mobile/assets/icon.png" "${FIXTURE}/mobile/assets/icon.png"
cp "${REPO}/mobile/app.json" "${FIXTURE}/mobile/app.json"
printf '%s' old-apk > "${APP_DIR}/lotaya-rider.apk"
printf '%s' '{"version":"0.1.0"}' > "${APP_DIR}/version.json"
printf '%s' new-apk > "${FIXTURE}/releases/lotaya-rider.apk"
printf '%s' wrong-version > "${FIXTURE}/releases/lotaya-rider.version"
bash "${REPO}/deploy/publish-rider-app.sh" "${FIXTURE}" "${APP_DIR}"
[[ "$(cat "${APP_DIR}/lotaya-rider.apk")" == old-apk ]]
grep -q '"version":"0.1.0"' "${APP_DIR}/version.json"
grep -q 'lotaya-rider.apk' "${APP_DIR}/index.html"
node -p "require('${FIXTURE}/mobile/app.json').expo.version" > "${FIXTURE}/releases/lotaya-rider.version"
AAPT_MODE=wrong bash "${REPO}/deploy/publish-rider-app.sh" "${FIXTURE}" "${APP_DIR}" >/dev/null 2>&1 && { echo "wrong APK package was accepted" >&2;exit 1; }
[[ "$(cat "${APP_DIR}/lotaya-rider.apk")" == old-apk ]]
APKSIGNER_DEBUG=1 bash "${REPO}/deploy/publish-rider-app.sh" "${FIXTURE}" "${APP_DIR}" >/dev/null 2>&1 && { echo "debug-signed APK was accepted" >&2;exit 1; }
[[ "$(cat "${APP_DIR}/lotaya-rider.apk")" == old-apk ]]
bash "${REPO}/deploy/publish-rider-app.sh" "${FIXTURE}" "${APP_DIR}"
[[ "$(cat "${APP_DIR}/lotaya-rider.apk")" == new-apk ]]
node -e "const fs=require('fs'),v=JSON.parse(fs.readFileSync(process.argv[1]));if(v.version!=='0.1.1'||v.sizeBytes!==7||!/^[a-f0-9]{64}$/.test(v.sha256))process.exit(1)" "${APP_DIR}/version.json"
echo "Rider publication contract passed."
