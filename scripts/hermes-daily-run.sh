#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
REPO_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
DATE_KEY="$(date +%F)"
REPORT_DIR="$REPO_DIR/data/reports"

if [ ! -d "$REPO_DIR" ]; then
  echo "Job Sniper repo directory was not found: $REPO_DIR" >&2
  exit 1
fi

mkdir -p "$REPORT_DIR"
cd "$REPO_DIR"

if [ -f "$HOME/.hermes/.env" ]; then
  set -a
  . "$HOME/.hermes/.env"
  set +a
fi

if [ ! -f "$REPO_DIR/profile/cv.md" ]; then
  echo "Job Sniper profile is missing. Run onboarding before automation." >&2
  exit 1
fi

npm run sniper -- sheet pull
npm run sniper -- run
npm run sniper -- triage 25 > "$REPORT_DIR/$DATE_KEY-triage.txt"
npm run sniper -- companies 25 > "$REPORT_DIR/$DATE_KEY-companies.txt"
npm run sniper -- stats > "$REPORT_DIR/$DATE_KEY-stats.txt"
npm run sniper -- export json "$REPORT_DIR/$DATE_KEY-export.json"
npm run sniper -- sheet sync
