# Claw Job Sniper

<p align="center">
  <img src="assets/job-sniper-mascot.png" alt="Claw Job Sniper mascot" width="960" />
</p>

`claw-job-sniper` is a local-first OpenClaw skill for finding jobs, tracking companies, collecting public hiring contacts, and running a structured outreach workflow.

It keeps a SQLite database as the source of truth, searches the public web plus common ATS surfaces, ranks opportunities against an onboarded profile, and syncs the output into Google Sheets.

## At a glance

- Local-first storage with SQLite
- Profile-aware job ranking instead of raw keyword matching
- Company and public contact discovery
- Google Sheets sync with manual columns preserved
- OpenClaw-friendly command surface for scouting, reviewing, and drafting

## What it is now

This repo now runs as a role-pack-driven engine.

That means:

- lanes are data-driven, not hardcoded enums
- the shipped presets are just built-in packs, not special-case code paths
- you can define new lanes for other fields in `config.json` without editing the scoring engine, query builder, or CLI

The repo still ships with three first-party presets:

- `design_jobs`
- `ai_coding_jobs`
- `company_watch`

They exist to preserve the current working workflow, but they are examples of the engine, not the limit of it.

## What it does

- Onboards a profile from raw text or a local file path
- Searches across:
  - web search results
  - RSS feeds
  - ATS/job platforms
  - structured job pages via JSON-LD
- Tracks:
  - jobs
  - companies
  - public contacts
  - manual notes and outreach state
- Drafts outreach text for specific jobs
- Syncs to Google Sheets and pulls manual edits back into local state

## Quick start

Install and smoke test:

```bash
npm install
npm run typecheck
npm test
npm run sniper -- help
```

Basic flow:

```text
/sniper onboard <cv text or file path>
/sniper run
/sniper digest
/sniper companies
/sniper sheet sync
```

If your OpenClaw surface does not expose native skill commands, use:

```text
/skill sniper run
```

## Command surface

OpenClaw should expose this as `/sniper`.

```text
/sniper onboard <cv text or file path>
/sniper run [--lane <lane-id>] [--company-watch]
/sniper digest [limit]
/sniper shortlist [limit]
/sniper draft <job-id>
/sniper explain <job-id>
/sniper companies [limit]
/sniper contacts [company-id-or-key]
/sniper enrich company <company-id-or-key>
/sniper blacklist add [--company | --keyword] [--lane <lane>] <term>
/sniper sheet sync
/sniper sheet pull
/sniper stats
/sniper export json [path]
```

Older `!sniper ...` examples are deprecated.

## Role packs and customization

This tool is not tied to one person, one city, or one hiring market.

Main customization points:

- `config.json`
  Set target cities, countries, remote preferences, RSS feeds, ATS boards, blacklists, sheet tabs, and your lane definitions.
- `profile/cv.md` and `profile/profile.json`
  Local runtime profile files created and updated through onboarding.
- Role packs
  Add, remove, or tune lanes for any field.
- Sheet workflow
  Adapt the `Jobs`, `Companies`, and `Contacts` tabs to your own research and outreach process.

Each lane is a role pack with:

- `label`
- `type`
- `queries`
- `keywords`
- optional `queryTerms`
- optional `profileSignals`
- optional `titleFamilies`
- optional `mismatchTerms`
- optional `startupTerms`
- optional `companyTerms`

Typical uses:

- switch the search market from one city or country to another
- run a remote-only search
- use it for one candidate, a recruiting workflow, or a coaching workflow
- add a new field like policy, biotech, legal ops, data science, or climate research
- use it only for research, or for research plus outreach

### Example: add a new lane for climate policy

```json
{
  "lanes": {
    "policy_jobs": {
      "label": "Policy Jobs",
      "type": "job",
      "enabled": true,
      "queries": {
        "tr": [],
        "en": [
          "Berlin climate policy jobs",
          "Germany public affairs analyst roles"
        ]
      },
      "keywords": ["policy analyst", "climate policy", "public affairs"],
      "queryTerms": ["policy analyst", "public policy associate"],
      "profileSignals": ["policy", "climate policy", "research", "public affairs"],
      "titleFamilies": [
        {
          "family": "Policy Analyst",
          "terms": ["policy analyst", "public policy associate"]
        }
      ],
      "mismatchTerms": ["sales", "account executive"]
    }
  },
  "blacklist": {
    "lanes": {
      "policy_jobs": []
    }
  }
}
```

After adding the lane:

```text
/sniper run --lane policy_jobs
/sniper blacklist add --lane policy_jobs --keyword lobbying
```

## Typical workflow

### 1. Onboard a profile

Paste text directly:

```text
/sniper onboard I am a frontend engineer focused on devtools, based in London, open to hybrid and remote roles...
```

Or use a local file:

```text
/sniper onboard /absolute/path/to/cv.pdf
```

### 2. Run discovery

```text
/sniper run
/sniper run --lane design_jobs
/sniper run --lane policy_jobs
/sniper run --company-watch
```

This will:

- search configured sources
- normalize job and company records
- enrich public contact surfaces
- score the jobs against the onboarded profile

### 3. Review the output

```text
/sniper digest
/sniper shortlist
/sniper companies
```

### 4. Enrich promising companies

```text
/sniper enrich company <company-id-or-key>
/sniper contacts <company-id-or-key>
```

### 5. Draft outreach

```text
/sniper draft 42
```

### 6. Sync to Google Sheets

```text
/sniper sheet sync
/sniper sheet pull
```

## Google Sheets

For live Sheets sync, provide one of:

- `SNIPER_GOOGLE_SERVICE_ACCOUNT_PATH`
- `SNIPER_GOOGLE_SERVICE_ACCOUNT_JSON`

Optional:

- `SNIPER_GOOGLE_SHEET_ID`
- `SNIPER_GOOGLE_FOLDER_ID`

If no sheet ID is configured, first sync creates a spreadsheet named `Claw Job Sniper`.

Default tabs:

- `Jobs`
- `Companies`
- `Contacts`
- `RunMetrics`

Manual columns preserved on sync:

- `manual_status`
- `owner_notes`
- `priority`
- `outreach_state`
- `manual_contact_override`

## AI workflow examples

### OpenClaw + Google Sheets

Use the sheet as the operational board:

- `Jobs` for ranking and outreach state
- `Companies` for company research
- `Contacts` for public hiring surfaces

Example:

```text
Open the Claw Job Sniper Google Sheet, find the high-priority rows, visit the job pages, and draft outreach for the top 3.
```

### ChatGPT or Gemini

You can:

- paste selected rows into the chat
- export CSV and upload it
- ask the model to rank opportunities, compare roles, or rewrite outreach

Example:

```text
Here is my Jobs sheet export. Rank the top 10 roles by likely interview conversion.
```

### Notion

This repo does not write to Notion directly, but the workflow is simple:

1. Sync to Google Sheets
2. Mirror selected rows into Notion
3. Use Notion for dossiers, prep notes, and application tracking

## Privacy and secrets

This project is designed to keep runtime data out of git.

Ignored local state includes:

- `profile/`
- `data/*.db`
- `data/*.html`
- `.env`

Expected secrets should come from environment variables, not committed files:

- `SNIPER_GOOGLE_SERVICE_ACCOUNT_PATH`
- `SNIPER_GOOGLE_SERVICE_ACCOUNT_JSON`
- `SNIPER_GOOGLE_SHEET_ID`
- `SNIPER_GOOGLE_FOLDER_ID`

## Repo structure

- [README.md](README.md)
  Main documentation
- [SKILL.md](SKILL.md)
  Minimal OpenClaw skill wrapper
- [src/cli.ts](src/cli.ts)
  Command parsing
- [src/search](src/search)
  Discovery, crawling, parsing, enrichment
- [src/db.ts](src/db.ts)
  SQLite schema and persistence
- [src/sheets.ts](src/sheets.ts)
  Google Sheets sync and pull
- [test](test)
  Regression and integration coverage
