---
name: sniper
description: "Istanbul-first job intelligence for design and AI coding roles. Use /sniper with subcommands like onboard, run, digest, draft, companies, and sheet sync."
user-invocable: true
metadata: { "openclaw": { "requires": { "bins": ["node", "npm"] } } }
---

# Sniper

Use this skill when the user wants to hunt for jobs, companies, and public hiring contacts.

## Command surface

Run the local CLI via:

```bash
node {baseDir}/scripts/run-sniper.mjs <subcommand> [args...]
```

Supported subcommands:

- `onboard <text-or-path>`
- `run`
- `digest [limit]`
- `draft <job-id>`
- `blacklist add <term>`
- `sheet sync`
- `sheet pull`
- `companies [limit]`

## Behavior rules

- Keep the local SQLite database as the source of truth.
- Prioritize Istanbul and Turkish listings first, but keep relevant global remote roles too.
- Collect only public contacts and public company pages.
- Never send applications or email anyone automatically.
- If the user asks to sync or pull Google Sheets data, use the configured service account env vars.

## Environment

Optional env vars for Google Sheets:

- `SNIPER_GOOGLE_SERVICE_ACCOUNT_PATH`
- `SNIPER_GOOGLE_SERVICE_ACCOUNT_JSON`
- `SNIPER_GOOGLE_SHEET_ID`
- `SNIPER_GOOGLE_FOLDER_ID`
