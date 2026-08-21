# Mana English Phase 2 v0.2.0

Secure pilot web application for spoken-English learning in Classes 3–5 in Andhra Pradesh and Telangana. The interface combines English, Telugu pronunciation support, Telugu meaning, practice lessons, and a teacher progress view.

## What is included

- Student login with school code, student ID, and four-digit PIN
- Teacher and administrator login with school code, username, and password
- JWT-based eight-hour browser sessions
- PostgreSQL-backed student accounts and lesson progress
- Class 3 Week 1 learning path with English and Telugu support
- Interactive multiple-choice practice with browser speech playback
- XP, completion, weekly goal, and accuracy updates
- Teacher dashboard populated from the PostgreSQL demo class
- Login throttling after repeated failed attempts
- Private API exposure: only Nginx is network-facing; the API listens on `127.0.0.1:8000`
- RHEL 9 deployment with Podman Quadlet, SELinux, firewalld, and Nginx

This is a pilot build. A full three-year curriculum, content authoring, recorded-speaking submissions, password recovery, and production school administration remain future phases.

## Deploy on the RHEL 9 VM

On the server, run:

```bash
cd /home/chakravarthi/mana-english
git switch mana-english-mvp-v0.1.0
git pull origin mana-english-mvp-v0.1.0
sudo bash deploy/install.sh
```

The first installation builds the FastAPI image, downloads PostgreSQL, creates root-only random demo credentials, starts both services, updates Nginx, and checks the web application.

Open `http://192.168.247.200` and use the credentials printed at the end of installation. They are also stored locally on the VM at:

```text
/etc/mana-english/demo-credentials
```

Only root can read that file. Do not commit or share it.

## Verify the services

```bash
systemctl --no-pager --full status mana-english-db.service mana-english-api.service
curl -s http://localhost/api/health
podman ps
```

Expected health response:

```json
{"status":"ok","service":"mana-english-api","version":"0.2.0"}
```

## Architecture

- Nginx serves `public/` and proxies `/api/`.
- FastAPI provides authentication, progress, lessons, and teacher dashboard endpoints.
- PostgreSQL 16 stores schools, accounts, and lesson progress.
- Podman Quadlet manages the API, database, network, and persistent database volume through systemd.

The installer backs up replaced website files under `/var/backups/mana-english`, preserves existing demo credentials, applies SELinux labels, and validates Nginx before reload.
