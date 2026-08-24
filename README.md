# Mana English Phase 7 v0.7.0

Secure pilot web application for spoken-English learning in Classes 3–5 in Andhra Pradesh and Telangana. The interface combines English, Telugu pronunciation support, Telugu meaning, practice lessons, and a teacher progress view.

## What is included

- Student login with school code, student ID, and four-digit PIN
- Teacher and administrator login with school code, username, and password
- JWT-based eight-hour browser sessions
- PostgreSQL-backed student accounts and lesson progress
- Class 3 Week 1 and Week 2 learning paths with English and Telugu support
- Weekly vocabulary banks with easy phonetics, one Telugu pronunciation, one Telugu meaning, visual cues, and female audio
- Week selector for students and teachers with progress kept separate by week
- Ten complete daily lessons with 30 guided practice questions across both weeks
- Week 2 classroom-object and instruction module based on the approved student workbook and teacher guide
- Eight-turn role plays for both weeks with female English audio on every line
- Each weekend test unlock requires all five lessons plus that week’s role play
- One clear Telugu pronunciation guide and one child-friendly Telugu meaning for every key phrase
- Teacher warm-up, modelling, guided-practice, pair-practice, error-correction, and home-practice notes
- A 10-question weekend test scored securely by the API
- Working student Speak, Practice, Tests, Progress, and Telugu Help views
- Browser microphone recording with local playback on trusted HTTPS, plus an HTTP practice-count fallback
- Database-backed teacher lesson assignments for Class 3A
- Working teacher Students, Lessons, Assessments, and Reports views
- Searchable student roster and downloadable CSV class report
- Interactive multiple-choice practice with browser speech playback
- Two-attempt guided correction: remove the first wrong choice, then reveal and explain the correct answer after a second mistake
- PostgreSQL-backed answer-attempt and mistake history with bilingual areas-to-improve guidance
- Mastery gate requiring at least two of three questions correct before a lesson is completed or the next lesson unlocks
- Automatic correction of earlier zero/low-score lesson records from Completed to Needs practice
- Answer-safe weekend assessments: model-answer text and Telugu pronunciation hints are removed, and audio reads only the question
- Accessibility audio beside every answer without selecting it, plus English and Telugu question-audio controls
- Female Indian-English and Telugu browser-voice preference with safe device-default fallback
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

## Rotate demo credentials

If a demo PIN or password is displayed in a shared terminal output, rotate all
demo credentials without deleting student progress:

```bash
sudo bash deploy/rotate-demo-credentials.sh
```

The script updates the password hashes in PostgreSQL, replaces the root-only
credential and API environment files, and restarts the API. Existing schools,
students, lesson completion, XP, and test scores are preserved.

## Verify the services

```bash
systemctl --no-pager --full status mana-english-db.service mana-english-api.service
curl -s http://localhost/api/health
podman ps
```

Expected health response:

```json
{"status":"ok","service":"mana-english-api","version":"0.7.0"}
```

## Architecture

- Nginx serves `public/` and proxies `/api/`.
- FastAPI provides authentication, progress, lessons, and teacher dashboard endpoints.
- PostgreSQL 16 stores schools, accounts, and lesson progress.
- Podman Quadlet manages the API, database, network, and persistent database volume through systemd.

The installer backs up replaced website files under `/var/backups/mana-english`, preserves existing demo credentials, applies SELinux labels, and validates Nginx before reload.
