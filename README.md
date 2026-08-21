# Mana English MVP v0.1.0

First deployable interface for the spoken-English learning platform for Classes 3–5 in Andhra Pradesh and Telangana.

## Included

- Class 3 student learning path
- English sentence, Telugu pronunciation guide and Telugu meaning
- Interactive multiple-choice lesson
- Browser-based English audio playback
- XP, streak, weekly goal and progress indicators
- Teacher dashboard with student progress and speaking-review queue
- Responsive desktop and mobile layout

This release is an interface prototype. User accounts, PostgreSQL persistence, content administration, recorded speaking submissions and automated weekly-test scoring will be connected in later releases.

## Deploy on the RHEL 9 server

1. Copy and extract this package on the server.
2. Change into the extracted directory.
3. Run:

   ```bash
   sudo bash deploy/install.sh
   ```

4. Open `http://192.168.247.200`.

The installer backs up any replaced website files under `/var/backups/mana-english`, applies the correct SELinux labels, validates Nginx and reloads it.
