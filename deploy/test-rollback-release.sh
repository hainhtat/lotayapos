#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
scratch="$(mktemp -d)"
trap 'rm -rf "${scratch}"' EXIT
source "${REPO}/deploy/rollback-release.sh"
# Stub service boundaries only. Exercise actual file/symlink restoration.
systemctl() { printf '%s\n' "$*" >>"${scratch}/services"; }
nginx() { [[ "$1" == -t ]]; }
# macOS has no GNU mv -T; emulate the exact replacement for this test host.
if [[ "$(uname)" == Darwin ]]; then
  mv() { if [[ "$1" == -Tf ]]; then command mv -fh "$2" "$3"; else command mv "$@"; fi; }
fi
mkdir -p "${scratch}/old/backend/dist" "${scratch}/new" "${scratch}/backup" "${scratch}/enabled"
printf 'server' >"${scratch}/old/backend/dist/server.js"
printf 'old config' >"${scratch}/backup/nginx.conf"
printf 'old unit' >"${scratch}/backup/lotaya-api.service"
printf 'new config' >"${scratch}/nginx.conf"
printf 'new unit' >"${scratch}/api.service"
printf 'other site' >"${scratch}/unrelated.conf"
ln -s "${scratch}/nginx.conf" "${scratch}/backup/nginx-enabled"
ln -s "${scratch}/nginx.conf" "${scratch}/enabled/lotaya.conf"
ln -s "${scratch}/new" "${scratch}/current"
restore_lotaya_release "${scratch}" "${scratch}/old" "${scratch}/backup" "${scratch}/nginx.conf" "${scratch}/api.service" 1 1 "${scratch}/enabled/lotaya.conf"
[[ "$(readlink "${scratch}/current")" == "${scratch}/old" ]]
[[ "$(cat "${scratch}/nginx.conf")" == 'old config' ]]
[[ "$(cat "${scratch}/api.service")" == 'old unit' ]]
[[ "$(cat "${scratch}/unrelated.conf")" == 'other site' ]]
grep -q '^restart lotaya-api$' "${scratch}/services"
mkdir "${scratch}/empty-backup"
restore_lotaya_release "${scratch}" '' "${scratch}/empty-backup" "${scratch}/nginx.conf" "${scratch}/api.service" 1 0 "${scratch}/enabled/lotaya.conf"
[[ ! -e "${scratch}/nginx.conf" && ! -e "${scratch}/api.service" && ! -L "${scratch}/enabled/lotaya.conf" ]]
[[ "$(cat "${scratch}/unrelated.conf")" == 'other site' ]]
grep -q '^stop lotaya-api$' "${scratch}/services"
echo "Existing-release and first-install rollback checks passed."
