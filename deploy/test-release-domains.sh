#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
scratch="$(mktemp -d)"
trap 'rm -rf "${scratch}"' EXIT
mkdir -p "${scratch}/bin"
# Stub only the network boundary; exercise the real response validation.
cat >"${scratch}/bin/curl" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"${CALL_LOG}"
if [[ "${FAIL_ALIAS:-0}" == 1 && "$*" == *'https://lt.mmds.site/'* ]]; then exit 22; fi
if [[ "$*" == *'/health/ready'* ]]; then
  printf '%s' "${READY_BODY:-{\"success\":true}}"
else
  printf '<html>LOTAYA</html>'
fi
SH
chmod +x "${scratch}/bin/curl"
export PATH="${scratch}/bin:${PATH}" CALL_LOG="${scratch}/calls"
bash "${REPO}/deploy/check-release-domains.sh" >/dev/null
[[ "$(wc -l <"${CALL_LOG}" | tr -d ' ')" == 6 ]]
if FAIL_ALIAS=1 bash "${REPO}/deploy/check-release-domains.sh" >/dev/null 2>&1; then echo "Alternate-host failure was accepted" >&2; exit 1; fi
if READY_BODY='<html>wrong upstream</html>' bash "${REPO}/deploy/check-release-domains.sh" >/dev/null 2>&1; then echo "HTML health response was accepted" >&2; exit 1; fi
echo "Both-domain response/failure checks passed."
