#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/rotate-demo-credentials.sh"
  exit 1
fi

CONF_DIR="/etc/mana-english"
CREDENTIAL_FILE="${CONF_DIR}/demo-credentials"
API_ENV="${CONF_DIR}/api.env"

test -f "${CREDENTIAL_FILE}"
test -f "${API_ENV}"
systemctl is-active --quiet mana-english-db.service
systemctl is-active --quiet mana-english-api.service

# The installer generates only hex/numeric credential values, so sourcing this
# root-owned file does not interpret arbitrary user input.
source "${CREDENTIAL_FILE}"

NEW_STUDENT_PIN="$(shuf -i 1000-9999 -n 1)"
NEW_TEACHER_PASSWORD="$(openssl rand -hex 12)"
NEW_ADMIN_PASSWORD="$(openssl rand -hex 14)"

umask 077
TEMP_CREDENTIAL_FILE="$(mktemp "${CONF_DIR}/demo-credentials.XXXXXX")"
TEMP_API_ENV="$(mktemp "${CONF_DIR}/api.env.XXXXXX")"
cleanup() {
  rm -f "${TEMP_CREDENTIAL_FILE}" "${TEMP_API_ENV}"
}
trap cleanup EXIT

{
  echo "DB_PASSWORD=${DB_PASSWORD}"
  echo "JWT_SECRET=${JWT_SECRET}"
  echo "STUDENT_SCHOOL_CODE=${STUDENT_SCHOOL_CODE:-MANA001}"
  echo "STUDENT_USERNAME=${STUDENT_USERNAME:-ANANYA03}"
  echo "STUDENT_PIN=${NEW_STUDENT_PIN}"
  echo "TEACHER_SCHOOL_CODE=${TEACHER_SCHOOL_CODE:-MANA001}"
  echo "TEACHER_USERNAME=${TEACHER_USERNAME:-LAKSHMI}"
  echo "TEACHER_PASSWORD=${NEW_TEACHER_PASSWORD}"
  echo "ADMIN_USERNAME=${ADMIN_USERNAME:-ADMIN}"
  echo "ADMIN_PASSWORD=${NEW_ADMIN_PASSWORD}"
} > "${TEMP_CREDENTIAL_FILE}"

{
  echo "DATABASE_URL=postgresql+psycopg://mana_app:${DB_PASSWORD}@mana-english-db:5432/mana_english"
  echo "JWT_SECRET=${JWT_SECRET}"
  echo "TOKEN_HOURS=8"
  echo "DEMO_SCHOOL_CODE=MANA001"
  echo "DEMO_STUDENT_PIN=${NEW_STUDENT_PIN}"
  echo "DEMO_TEACHER_PASSWORD=${NEW_TEACHER_PASSWORD}"
  echo "DEMO_ADMIN_PASSWORD=${NEW_ADMIN_PASSWORD}"
} > "${TEMP_API_ENV}"

chmod 0600 "${TEMP_CREDENTIAL_FILE}" "${TEMP_API_ENV}"

export MANA_ROTATE_STUDENT_PIN="${NEW_STUDENT_PIN}"
export MANA_ROTATE_TEACHER_PASSWORD="${NEW_TEACHER_PASSWORD}"
export MANA_ROTATE_ADMIN_PASSWORD="${NEW_ADMIN_PASSWORD}"

podman exec -i \
  --env MANA_ROTATE_STUDENT_PIN \
  --env MANA_ROTATE_TEACHER_PASSWORD \
  --env MANA_ROTATE_ADMIN_PASSWORD \
  mana-english-api python - <<'PY'
import os

from sqlalchemy import select

from app.db import SessionLocal
from app.models import User
from app.security import hash_secret


student_usernames = {"ANANYA03", "SAIKIRAN03", "HARSHINI03", "ROHAN03"}
with SessionLocal() as db:
    users = db.scalars(select(User).where(User.active.is_(True))).all()
    found = set()
    for user in users:
        if user.username in student_usernames:
            user.password_hash = hash_secret(os.environ["MANA_ROTATE_STUDENT_PIN"])
            found.add(user.username)
        elif user.username == "LAKSHMI":
            user.password_hash = hash_secret(os.environ["MANA_ROTATE_TEACHER_PASSWORD"])
            found.add(user.username)
        elif user.username == "ADMIN":
            user.password_hash = hash_secret(os.environ["MANA_ROTATE_ADMIN_PASSWORD"])
            found.add(user.username)
    expected = student_usernames | {"LAKSHMI", "ADMIN"}
    missing = expected - found
    if missing:
        raise RuntimeError(f"Missing demo accounts: {', '.join(sorted(missing))}")
    db.commit()
PY
mv -f "${TEMP_CREDENTIAL_FILE}" "${CREDENTIAL_FILE}"
mv -f "${TEMP_API_ENV}" "${API_ENV}"
trap - EXIT

unset MANA_ROTATE_STUDENT_PIN MANA_ROTATE_TEACHER_PASSWORD MANA_ROTATE_ADMIN_PASSWORD
systemctl restart mana-english-api.service

for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
curl -fsS http://127.0.0.1:8000/api/health >/dev/null

echo
echo "Demo credentials rotated successfully."
echo "Student school code: ${STUDENT_SCHOOL_CODE:-MANA001}"
echo "Student ID:          ${STUDENT_USERNAME:-ANANYA03}"
echo "New student PIN:     ${NEW_STUDENT_PIN}"
echo
echo "Teacher school code: ${TEACHER_SCHOOL_CODE:-MANA001}"
echo "Teacher username:    ${TEACHER_USERNAME:-LAKSHMI}"
echo "New teacher password: ${NEW_TEACHER_PASSWORD}"
echo
echo "New credentials are stored root-only at ${CREDENTIAL_FILE}"
