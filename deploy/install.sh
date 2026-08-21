#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer with sudo: sudo bash deploy/install.sh"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SOURCE_DIR="${PACKAGE_DIR}/public"
WEB_ROOT="/usr/share/nginx/html"
BACKUP_ROOT="/var/backups/mana-english"
STAMP="$(date +%Y%m%d-%H%M%S)"

test -f "${SOURCE_DIR}/index.html"
test -f "${SOURCE_DIR}/styles.css"
test -f "${SOURCE_DIR}/app.js"

install -d -m 0755 "${WEB_ROOT}" "${BACKUP_ROOT}/${STAMP}"

for file in index.html styles.css app.js; do
  if [[ -f "${WEB_ROOT}/${file}" ]]; then
    cp -a "${WEB_ROOT}/${file}" "${BACKUP_ROOT}/${STAMP}/${file}"
  fi
  install -m 0644 "${SOURCE_DIR}/${file}" "${WEB_ROOT}/${file}"
done

restorecon -RF "${WEB_ROOT}"
nginx -t
systemctl reload nginx

if curl -fsS http://localhost/ | grep -q "Mana English"; then
  echo "Mana English MVP deployed successfully."
  echo "Open: http://192.168.247.200"
  echo "Backup: ${BACKUP_ROOT}/${STAMP}"
else
  echo "Deployment validation failed."
  exit 1
fi
