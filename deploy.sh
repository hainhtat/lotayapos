#!/usr/bin/env bash
# Deploys Lotaya to lotaya.mmds.site only.
# Never edits nginx sites for pos.mmds.site, snmd, delilist, or other vhosts.
set -euo pipefail

ROOT=/opt/lotaya
REPO="${ROOT}/repo"
SHARED="${ROOT}/shared"
APP_DIR="${ROOT}/app"
BRANCH="${LOTAYA_BRANCH:-main}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo ./deploy.sh" >&2
  exit 1
fi

mkdir -p "${SHARED}" "${APP_DIR}" "${ROOT}/frontend" "${ROOT}/backend"
if [[ ! -d "${REPO}/.git" ]]; then
  echo "Clone the repo to ${REPO} first." >&2
  exit 1
fi

cd "${REPO}"
git fetch origin
git checkout "${BRANCH}"
git pull --ff-only origin "${BRANCH}"

if [[ ! -f "${SHARED}/lotaya.env" ]]; then
  echo "Missing ${SHARED}/lotaya.env" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
source "${SHARED}/lotaya.env"
set +a

export NODE_ENV=production
export DATABASE_PROVIDER=postgresql

cd "${REPO}/backend"
npm ci --include=dev
DATABASE_PROVIDER=postgresql npx prisma generate --schema prisma/schema.postgresql.prisma
npx prisma migrate deploy --schema prisma/schema.postgresql.prisma
rm -rf dist
npx tsc -p tsconfig.build.json
rsync -a --delete --exclude node_modules --exclude .env dist package.json package-lock.json prisma "${ROOT}/backend/"
mkdir -p "${ROOT}/backend/node_modules"
rsync -a node_modules/ "${ROOT}/backend/node_modules/"
install -m 600 "${SHARED}/lotaya.env" "${ROOT}/backend/.env"

cd "${REPO}/frontend"
export VITE_API_BASE_URL="${VITE_API_BASE_URL:-https://lotaya.mmds.site/api/v1}"
export VITE_RIDER_ANDROID_DOWNLOAD_URL="${VITE_RIDER_ANDROID_DOWNLOAD_URL:-https://lotaya.mmds.site/app/lotaya-rider.apk}"
npm ci --include=dev
npx vite build
rsync -a --delete dist/ "${ROOT}/frontend/dist/"

if [[ -f "${REPO}/releases/lotaya-rider.apk" ]]; then
  install -m 644 "${REPO}/releases/lotaya-rider.apk" "${APP_DIR}/lotaya-rider.apk"
fi
VERSION="$(node -p "require('${REPO}/mobile/app.json').expo.version")"
cat > "${APP_DIR}/version.json" <<EOF
{"version":"${VERSION}","apkUrl":"https://lotaya.mmds.site/app/lotaya-rider.apk"}
EOF

chown -R www-data:www-data "${ROOT}/backend" "${ROOT}/frontend" "${APP_DIR}"
chmod 640 "${SHARED}/lotaya.env"
NGINX_SITE=/etc/nginx/sites-available/lotaya.mmds.site.conf
if [[ -f "${NGINX_SITE}" ]] && grep -q "listen 443" "${NGINX_SITE}"; then
  echo "Keeping existing TLS nginx site ${NGINX_SITE}"
else
  install -m 644 "${REPO}/deploy/nginx/lotaya.mmds.site.conf" "${NGINX_SITE}"
fi
ln -sfn "${NGINX_SITE}" /etc/nginx/sites-enabled/lotaya.mmds.site.conf
install -m 644 "${REPO}/deploy/systemd/lotaya-api.service" /etc/systemd/system/lotaya-api.service
nginx -t
systemctl daemon-reload
systemctl enable --now lotaya-api
systemctl restart lotaya-api
systemctl reload nginx
echo "Lotaya deploy complete."
