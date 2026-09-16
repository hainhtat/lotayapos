#!/usr/bin/env bash
# Exercise each configured vhost through local nginx, with real TLS hostname
# verification. Public DNS/ISP availability is checked separately by operators.
set -euo pipefail
for hostname in lotaya.mmds.site lt.mmds.site; do
  for path in / /app/ /api/v1/health/ready; do
    response="$(curl --noproxy '*' --resolve "${hostname}:443:127.0.0.1" --fail --silent --show-error --max-time 10 "https://${hostname}${path}")"
    if [[ "${path}" == /api/v1/health/ready ]]; then
      printf '%s' "${response}" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{if(JSON.parse(s).success!==true)process.exit(1)}catch{process.exit(1)}})'
    else
      [[ "${response}" == *'<html'* || "${response}" == *'<HTML'* ]] || { echo "Expected HTML for ${hostname}${path}" >&2; exit 1; }
    fi
  done
  echo "HTTPS checks passed: ${hostname}"
done
