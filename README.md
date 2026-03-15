# Claw Job Sniper

`claw-job-sniper` is an OpenClaw-native job intelligence skill for people hunting design roles, AI coding roles, and companies worth reaching out to.

It runs locally, keeps a SQLite database as the source of truth, searches the public web plus common ATS platforms, ranks roles against your CV, extracts public company/contact signals, and syncs the results into an AI-editable Google Sheet.

It is meant to be customized:

- choose your own cities, countries, and remote preferences
- tailor the search lanes to design, engineering, AI, or startup-company scouting
- rank jobs against any profile, not one hardcoded persona
- use the sheet and contact outputs as a general job-intel and outreach workflow

## What it does

- Onboards your CV from raw text or a local file path
- Searches across:
  - web search results
  - RSS feeds
  - common ATS/job boards
  - structured job pages via JSON-LD
- Scores roles against your profile instead of just doing dumb keyword matching
- Tracks:
  - jobs
  - companies
  - public contacts
  - manual notes and outreach state
- Drafts outreach text for specific jobs
- Syncs to Google Sheets and pulls manual edits back into local state

## Command surface

OpenClaw should expose this as `/sniper`.

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

If your surface does not expose native skill commands, use:

```text
/skill sniper run
```

Older `!sniper ...` examples are deprecated.

## Local setup

```bash
npm install
npm run typecheck
npm test
```

Quick smoke check:

```bash
npm run sniper -- help
```

Runtime state lives in:

- `profile/cv.md`
- `profile/profile.json`
- `data/sniper.db`

## Customization

This tool is not tied to one person, one city, or one hiring market.

The main customization points are:

- `config.json`
  Set your target cities, countries, remote preferences, RSS feeds, ATS boards, blacklist rules, and Google Sheets tabs
- `profile/cv.md` and `profile/profile.json`
  Onboard a different person, resume, or job-search strategy
- search lanes
  Enable or disable `design_jobs`, `ai_coding_jobs`, and `company_watch`
- sheet workflow
  Adapt the `Jobs`, `Companies`, and `Contacts` tabs to your own research and outreach process

Typical examples:

- switch from Berlin to London, New York, Dubai, or remote-only
- tune the system for product design, frontend, AI engineering, or startup scouting
- use it for one candidate, a recruiter workflow, or a small career-coaching operation
- treat it as a research tool only, or as a shortlist-plus-outreach machine

## Basic workflow

### 1. Onboard your profile

Paste CV text directly:

```text
/sniper onboard I am a product designer focused on fintech, based in London, open to hybrid and remote roles...
```

Or point it at a local file:

```text
/sniper onboard /absolute/path/to/cv.pdf
```

### 2. Run discovery

```text
/sniper run
```

This will:

- search the web
- inspect configured RSS and ATS sources
- normalize listings
- enrich company/contact signals
- score the jobs against your profile

### 3. Review the best matches

```text
/sniper digest
/sniper companies
```

### 4. Draft outreach for a specific role

```text
/sniper draft 42
```

### 5. Sync everything to Google Sheets

```text
/sniper sheet sync
```

### 6. Pull back your manual notes/status changes

```text
/sniper sheet pull
```

## Google Sheets setup

For live Sheets sync, provide one of:

- `SNIPER_GOOGLE_SERVICE_ACCOUNT_PATH`
- `SNIPER_GOOGLE_SERVICE_ACCOUNT_JSON`

Optional:

- `SNIPER_GOOGLE_SHEET_ID`
- `SNIPER_GOOGLE_FOLDER_ID`

If no sheet ID is configured, first sync creates a spreadsheet named `Claw Job Sniper`.

The default tabs are:

- `Jobs`
- `Companies`
- `Contacts`

The sync is designed so AI-owned columns can refresh without wiping out your manual notes.

Manual columns preserved on sync:

- `manual_status`
- `owner_notes`
- `priority`
- `outreach_state`
- `manual_contact_override`

## OpenClaw workflow examples

### Workflow 1: Simple job hunting loop

1. `/sniper onboard ...`
2. `/sniper run`
3. `/sniper digest`
4. `/sniper draft <id>`
5. `/sniper sheet sync`

This is the shortest useful loop: discover, rank, draft, and push to the sheet.

### Workflow 2: Google Sheets as your AI control panel

Use the Google Sheet as the operational board:

- `Jobs` tab for ranking, notes, and outreach state
- `Companies` tab for company-level tracking
- `Contacts` tab for public hiring emails/links you found

Typical loop:

1. Run `/sniper run`
2. Run `/sniper sheet sync`
3. Open the sheet and mark rows with:
   - `manual_status=interested`
   - `priority=high`
   - `owner_notes=strong product fit`
4. Run `/sniper sheet pull`
5. Ask OpenClaw to draft outreach for the high-priority rows

### Workflow 3: OpenClaw + browser + Google Sheets

This repo stores the data. OpenClaw can then use its browser/tooling layer to read and act on the outputs.

Examples:

- Open the Google Sheet in a browser session and summarize all `priority=high` rows
- Compare the `Companies` tab against live company career pages
- Open a job URL from the sheet and draft a more tailored outreach based on the live page

Example prompt to OpenClaw:

```text
Open the Claw Job Sniper Google Sheet, find the high-priority design and AI roles, visit the job pages, and draft concise outreach emails for the top 3.
```

### Workflow 4: ChatGPT or Gemini reading the outputs

There are a few practical ways to let ChatGPT or Gemini work with the results:

- Open the Google Sheet in the browser and let OpenClaw browse it
- paste selected rows into ChatGPT or Gemini
- export CSV from the sheet and upload it
- mirror curated rows into Notion and work from there

Typical prompts:

```text
Here is my Jobs sheet export. Rank the top 10 roles by likely interview conversion.
```

```text
These are the companies and contacts I found. Write short, non-cringe cold outreach drafts for the best 5.
```

```text
Compare these design roles versus these AI coding roles and tell me where I have the strongest edge.
```

### Workflow 5: Notion research board

This repo does not natively write to Notion in v1, but the workflow is straightforward:

1. Sync to Google Sheets
2. Use OpenClaw, browser automation, or your Notion tooling to mirror selected rows into a Notion database
3. Use Notion for:
   - long-form research notes
   - company dossiers
   - interview prep
   - application pipeline tracking

A practical pattern is:

- Google Sheets = structured operating table
- Notion = research and writing layer

Example Notion workflow:

1. Pull the top 20 jobs from the `Jobs` tab
2. Create a Notion page per high-priority company
3. Store notes, recruiter observations, and interview prep there
4. Keep final status back in the sheet so the job-intel loop stays structured

### Workflow 6: Drafting and sending outreach with OpenClaw

This repo drafts the outreach text.

OpenClaw can sit on top of that output and help you finish the loop:

- read the `Jobs` tab or local DB
- generate personalized messages
- open the target email/contact form in a browser
- paste the draft
- send it after your approval

Good pattern:

1. `/sniper draft <id>`
2. Review the draft
3. Ask OpenClaw to open Gmail, a company contact form, LinkedIn, or another outbound surface
4. Have OpenClaw paste the draft and prepare the send
5. Keep sending gated by your approval

Example prompt:

```text
Take the draft for job 42, open the company contact form or email surface, paste the message, and stop before sending so I can approve it.
```

If you build your own sending workflow on top of OpenClaw, this repo becomes the intelligence layer feeding that process.

## Recommended operating model

A strong setup looks like this:

1. `claw-job-sniper` discovers and ranks
2. Google Sheets becomes the structured control board
3. Notion holds deeper research and application notes
4. OpenClaw browser/tooling reads the sheet and live job pages
5. ChatGPT or Gemini helps with ranking, positioning, and rewrites
6. OpenClaw drafts and stages outreach for approval

That gives you:

- local-first storage
- AI-readable structured outputs
- human-editable workflow state
- a clean handoff into outreach and application ops

## Startup outreach workflow

If you are using this as a startup cold-email machine, the tight loop is:

1. `/sniper onboard ...`
2. `/sniper run --company-watch`
3. `/sniper companies 20`
4. `/sniper contacts <company-id-or-key>`
5. `/sniper sheet sync`

Then work from the sheet:

- `Companies` tab = startup/company shortlist
- `Contacts` tab = public inboxes, LinkedIn company pages, and contact forms
- `Jobs` tab = best role matches with `best_contact` where available

For a stronger pass on a specific company:

```text
/sniper enrich company <company-id-or-key>
```

Useful prompts on top of that:

```text
Open the Companies tab, shortlist the startups with the strongest public contact surfaces, then draft 5 concise cold emails.
```

```text
Open the Jobs tab, find startup roles with a populated best_contact, and draft outreach for the top 3.
```

## Privacy and secrets

This project is designed to keep sensitive runtime data out of git:

- `profile/` is ignored
- local databases in `data/*.db` are ignored
- temporary HTML artifacts in `data/*.html` are ignored
- `.env` is ignored

Expected secrets are environment variables, not committed files:

- `SNIPER_GOOGLE_SERVICE_ACCOUNT_PATH`
- `SNIPER_GOOGLE_SERVICE_ACCOUNT_JSON`
- `SNIPER_GOOGLE_SHEET_ID`
- `SNIPER_GOOGLE_FOLDER_ID`

Recommended rule: treat this repo as code plus tests plus docs. Keep CVs, API credentials, generated databases, exports, and local operating data outside the tracked tree.

## Notes on scope

What this repo does directly:

- search
- normalize
- score
- store
- sync
- draft

What the wider OpenClaw stack can do around it:

- browse sheets and live job pages
- mirror data into other systems
- summarize and triage
- stage outbound outreach
- send only when you want it to

## Repo status

This is the modern TypeScript/OpenClaw version, not the old Bun-only prototype.

Key pieces:

- `SKILL.md` for OpenClaw skill behavior
- `src/cli.ts` for the command surface
- `src/search/*` for discovery/parsing
- `src/db.ts` for SQLite + migration
- `src/sheets.ts` for Google Sheets sync/pull
- `test/*` for regression, parsing, scoring, discovery, CLI, and sheet sync coverage
