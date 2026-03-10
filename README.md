# Claw Job Sniper

`claw-job-sniper` is now a modern OpenClaw skill built around a Node 24 TypeScript CLI.

It keeps a local SQLite database, discovers Istanbul-first design and AI coding roles across the public web and common ATS platforms, enriches companies and public contacts, and syncs editable results to Google Sheets.

## OpenClaw usage

The primary command surface is:

```text
/sniper onboard <cv text or file path>
/sniper run
/sniper digest
/sniper draft <job-id>
/sniper blacklist add <company-or-keyword>
/sniper sheet sync
/sniper sheet pull
/sniper companies
```

Older `!sniper ...` examples are deprecated. If a surface does not expose native skill commands, use `/skill sniper ...`.

## Local setup

```bash
npm install
npm run test
```

The runtime keeps its state in:

- `profile/cv.md`
- `profile/profile.json`
- `data/sniper.db`

## Google Sheets configuration

For live Sheets sync, set either:

- `SNIPER_GOOGLE_SERVICE_ACCOUNT_PATH`
- `SNIPER_GOOGLE_SERVICE_ACCOUNT_JSON`

Optional:

- `SNIPER_GOOGLE_SHEET_ID`
- `SNIPER_GOOGLE_FOLDER_ID`

On first sync, the tool creates a spreadsheet named `Claw Job Sniper` if no spreadsheet ID is configured or stored.
