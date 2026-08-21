#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer with sudo: sudo bash deploy/install.sh"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SOURCE_DIR="${PACKAGE_DIR}/public"
BACKEND_DIR="${PACKAGE_DIR}/backend"
WEB_ROOT="/usr/share/nginx/html"
CONF_DIR="/etc/mana-english"
QUADLET_DIR="/etc/containers/systemd"
BACKUP_ROOT="/var/backups/mana-english"
STAMP="$(date +%Y%m%d-%H%M%S)"
IMAGE_NAME="localhost/mana-english-api:0.5.0"

for file in \
  "${SOURCE_DIR}/index.html" \
  "${SOURCE_DIR}/styles.css" \
  "${SOURCE_DIR}/app.js" \
  "${BACKEND_DIR}/Containerfile" \
  "${BACKEND_DIR}/requirements.txt" \
  "${BACKEND_DIR}/app/content/class3_week1.json" \
  "${SCRIPT_DIR}/nginx-api.conf"; do
  test -f "${file}"
done

dnf install -y podman nginx curl openssl policycoreutils-python-utils
systemctl enable --now firewalld nginx
firewall-cmd --permanent --add-service=http >/dev/null
firewall-cmd --permanent --add-service=https >/dev/null
firewall-cmd --reload >/dev/null

install -d -m 0755 "${WEB_ROOT}" "${BACKUP_ROOT}/${STAMP}" "${QUADLET_DIR}"
install -d -m 0700 "${CONF_DIR}"

for file in index.html styles.css app.js; do
  if [[ -f "${WEB_ROOT}/${file}" ]]; then
    cp -a "${WEB_ROOT}/${file}" "${BACKUP_ROOT}/${STAMP}/${file}"
  fi
  install -m 0644 "${SOURCE_DIR}/${file}" "${WEB_ROOT}/${file}"
done

if [[ -f /etc/nginx/default.d/mana-english-api.conf ]]; then
  cp -a /etc/nginx/default.d/mana-english-api.conf "${BACKUP_ROOT}/${STAMP}/"
fi
install -m 0644 "${SCRIPT_DIR}/nginx-api.conf" /etc/nginx/default.d/mana-english-api.conf

CREDENTIAL_FILE="${CONF_DIR}/demo-credentials"
if [[ ! -f "${CREDENTIAL_FILE}" ]]; then
  DB_PASSWORD="$(openssl rand -hex 24)"
  JWT_SECRET="$(openssl rand -hex 32)"
  STUDENT_PIN="$(shuf -i 1000-9999 -n 1)"
  TEACHER_PASSWORD="$(openssl rand -hex 8)"
  ADMIN_PASSWORD="$(openssl rand -hex 10)"
  umask 077
  {
    echo "DB_PASSWORD=${DB_PASSWORD}"
    echo "JWT_SECRET=${JWT_SECRET}"
    echo "STUDENT_SCHOOL_CODE=MANA001"
    echo "STUDENT_USERNAME=ANANYA03"
    echo "STUDENT_PIN=${STUDENT_PIN}"
    echo "TEACHER_SCHOOL_CODE=MANA001"
    echo "TEACHER_USERNAME=LAKSHMI"
    echo "TEACHER_PASSWORD=${TEACHER_PASSWORD}"
    echo "ADMIN_USERNAME=ADMIN"
    echo "ADMIN_PASSWORD=${ADMIN_PASSWORD}"
  } > "${CREDENTIAL_FILE}"
fi

# Values are generated as alphanumeric/hex strings and are safe to source.
source "${CREDENTIAL_FILE}"

umask 077
{
  echo "POSTGRES_DB=mana_english"
  echo "POSTGRES_USER=mana_app"
  echo "POSTGRES_PASSWORD=${DB_PASSWORD}"
} > "${CONF_DIR}/db.env"

{
  echo "DATABASE_URL=postgresql+psycopg://mana_app:${DB_PASSWORD}@mana-english-db:5432/mana_english"
  echo "JWT_SECRET=${JWT_SECRET}"
  echo "TOKEN_HOURS=8"
  echo "DEMO_SCHOOL_CODE=MANA001"
  echo "DEMO_STUDENT_PIN=${STUDENT_PIN}"
  echo "DEMO_TEACHER_PASSWORD=${TEACHER_PASSWORD}"
  echo "DEMO_ADMIN_PASSWORD=${ADMIN_PASSWORD}"
} > "${CONF_DIR}/api.env"
chmod 0600 "${CONF_DIR}"/*.env "${CREDENTIAL_FILE}"

podman build --pull=missing --tag "${IMAGE_NAME}" "${BACKEND_DIR}"

for quadlet in "${SCRIPT_DIR}"/quadlet/*; do
  install -m 0644 "${quadlet}" "${QUADLET_DIR}/$(basename "${quadlet}")"
done

restorecon -RF "${WEB_ROOT}" "${CONF_DIR}" "${QUADLET_DIR}" /etc/nginx/default.d
setsebool -P httpd_can_network_connect 1
nginx -t
systemctl daemon-reload
systemctl restart mana-english-db.service

for _ in $(seq 1 60); do
  if podman exec mana-english-db pg_isready -U mana_app -d mana_english >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
podman exec mana-english-db pg_isready -U mana_app -d mana_english

systemctl restart mana-english-api.service
for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
curl -fsS http://127.0.0.1:8000/api/health

systemctl reload nginx
curl -fsS http://localhost/api/health
curl -fsS http://localhost/ | grep -q "Mana English"

echo
echo "Mana English Phase 5 deployed successfully."
echo "Open: http://192.168.247.200"
echo
echo "Student login"
echo "  School code: ${STUDENT_SCHOOL_CODE}"
echo "  Student ID:  ${STUDENT_USERNAME}"
echo "  PIN:         ${STUDENT_PIN}"
echo
echo "Teacher login"
echo "  School code: ${TEACHER_SCHOOL_CODE}"
echo "  Username:    ${TEACHER_USERNAME}"
echo "  Password:    ${TEACHER_PASSWORD}"
echo
echo "Credentials are stored root-only at ${CREDENTIAL_FILE}"
echo "Backup of the previous interface: ${BACKUP_ROOT}/${STAMP}"
