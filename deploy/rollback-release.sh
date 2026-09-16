#!/usr/bin/env bash
# Sourced by deploy.sh. Only restore the Lotaya paths supplied by that script.
restore_lotaya_release() {
  local root="$1" previous="$2" backup="$3" nginx_site="$4" unit_file="$5" config_changed="$6" switched="$7" enabled="$8"
  if [[ "${config_changed}" -eq 1 ]]; then
    if [[ -f "${backup}/nginx.conf" ]]; then cp -p "${backup}/nginx.conf" "${nginx_site}" || return 1
    else rm -f -- "${nginx_site}" || return 1; fi
    if [[ -f "${backup}/lotaya-api.service" ]]; then cp -p "${backup}/lotaya-api.service" "${unit_file}" || return 1
    else
      systemctl stop lotaya-api || return 1
      rm -f -- "${unit_file}" || return 1
    fi
    rm -f -- "${enabled}" || return 1
    if [[ -e "${backup}/nginx-enabled" || -L "${backup}/nginx-enabled" ]]; then cp -P "${backup}/nginx-enabled" "${enabled}" || return 1; fi
    systemctl daemon-reload || return 1
  fi
  if [[ "${switched}" -eq 1 && -n "${previous}" && -s "${previous}/backend/dist/server.js" ]]; then
    ln -sfn "${previous}" "${root}/current.next" || return 1
    mv -Tf "${root}/current.next" "${root}/current" || return 1
    systemctl restart lotaya-api || return 1
  fi
  nginx -t && systemctl reload nginx
}
