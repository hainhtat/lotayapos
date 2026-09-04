#!/usr/bin/env bash
# Deploys Lotaya to lotaya.mmds.site only.
# Never edits nginx sites for pos.mmds.site, snmd, delilist, or other vhosts.
set -euo pipefail

ROOT=/opt/lotaya
REPO="${ROOT}/repo"
SHARED="${ROOT}/shared"
BRANCH="${LOTAYA_BRANCH:-main}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo ./deploy.sh" >&2
  exit 1
fi

bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy/check-deploy-prerequisites.sh"

mkdir -p "${SHARED}" "${ROOT}/deployments"
if [[ ! -d "${REPO}/.git" ]]; then
  echo "Clone the repo to ${REPO} first." >&2
  exit 1
fi

cd "${REPO}"
git fetch origin
git checkout "${BRANCH}"
git pull --ff-only origin "${BRANCH}"

# Re-run the prerequisite policy from the release that is actually about to be
# deployed. The pre-pull check is only a bootstrap guard for the currently
# installed script; this check enforces any stricter requirements introduced by
# the newly checked-out release before builds or migrations can run.
bash "${REPO}/deploy/check-deploy-prerequisites.sh"

RELEASE_ID="$(date -u +%Y%m%d%H%M%S)-$(git rev-parse --short HEAD)"
RELEASE="${ROOT}/deployments/${RELEASE_ID}"
PREVIOUS_RELEASE="$(readlink -f "${ROOT}/current" 2>/dev/null || true)"
if [[ -e "${ROOT}/current" ]] && [[ ! -L "${ROOT}/current" ]]; then
  echo "${ROOT}/current must be a release symlink. Move the legacy deployment aside before using atomic deploys." >&2
  exit 1
fi
mkdir -p "${RELEASE}/backend" "${RELEASE}/frontend/dist" "${RELEASE}/app"
if [[ -n "${PREVIOUS_RELEASE}" && -d "${PREVIOUS_RELEASE}/app" ]]; then rsync -a "${PREVIOUS_RELEASE}/app/" "${RELEASE}/app/"; fi

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
npx tsc -p tsconfig.build.json
rsync -a --delete --exclude node_modules --exclude .env dist package.json package-lock.json prisma assets "${RELEASE}/backend/"
mkdir -p "${RELEASE}/backend/node_modules"
rsync -a node_modules/ "${RELEASE}/backend/node_modules/"
install -m 600 "${SHARED}/lotaya.env" "${RELEASE}/backend/.env"

cd "${REPO}/frontend"
export VITE_API_BASE_URL="${VITE_API_BASE_URL:-https://lotaya.mmds.site/api/v1}"
export VITE_RIDER_ANDROID_DOWNLOAD_URL="${VITE_RIDER_ANDROID_DOWNLOAD_URL:-https://lotaya.mmds.site/app/lotaya-rider.apk}"
npm ci --include=dev
npx vite build
rsync -a --delete dist/ "${RELEASE}/frontend/dist/"

bash "${REPO}/deploy/publish-rider-app.sh" "${REPO}" "${RELEASE}/app"
[[ -s "${RELEASE}/backend/dist/server.js" && -s "${RELEASE}/frontend/dist/index.html" && -s "${RELEASE}/app/index.html" ]] || { echo "Staged release validation failed before migration." >&2; exit 1; }

# All install/build validation is complete before this production state change.
cd "${REPO}/backend"
MIGRATE_URL="${DIRECT_DATABASE_URL:-$DATABASE_URL}"
DATABASE_URL="$MIGRATE_URL" npx prisma migrate deploy --schema prisma/schema.postgresql.prisma

chown -R www-data:www-data "${RELEASE}"
chmod 640 "${SHARED}/lotaya.env"
NGINX_SITE=/etc/nginx/sites-available/lotaya.mmds.site.conf
install -m 644 "${REPO}/deploy/nginx/lotaya.mmds.site.conf" "${NGINX_SITE}"
ln -sfn "${NGINX_SITE}" /etc/nginx/sites-enabled/lotaya.mmds.site.conf
install -m 644 "${REPO}/deploy/systemd/lotaya-api.service" /etc/systemd/system/lotaya-api.service
nginx -t
systemctl daemon-reload
systemctl enable lotaya-api
ln -sfn "${RELEASE}" "${ROOT}/current.next"
mv -Tf "${ROOT}/current.next" "${ROOT}/current"
if ! systemctl restart lotaya-api || ! curl --fail --silent --show-error --max-time 15 http://127.0.0.1:4010/api/v1/health/ready >/dev/null; then
  echo "Release readiness failed; rolling application files back. Database migrations are forward-only and are not automatically reversed." >&2
  if [[ -n "${PREVIOUS_RELEASE}" && -d "${PREVIOUS_RELEASE}" ]]; then ln -sfn "${PREVIOUS_RELEASE}" "${ROOT}/current.next";mv -Tf "${ROOT}/current.next" "${ROOT}/current";systemctl restart lotaya-api;else unlink "${ROOT}/current";fi
  exit 1
fi
systemctl reload nginx
echo "Lotaya deploy complete."
