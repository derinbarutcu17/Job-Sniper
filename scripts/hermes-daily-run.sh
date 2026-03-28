#!/bin/zsh
set -euo pipefail

REPO_DIR="/Users/derin/Desktop/CODING/Job sniper/derinbarutcu17-job-sniper-v2"
DATE_KEY="$(date +%F)"
REPORT_DIR="$REPO_DIR/data/reports"

mkdir -p "$REPORT_DIR"
cd "$REPO_DIR"

if [ -f "$HOME/.hermes/.env" ]; then
  set -a
  . "$HOME/.hermes/.env"
  set +a
fi

npm run sniper -- sheet pull
npm run sniper -- run
npm run sniper -- triage 25 > "$REPORT_DIR/$DATE_KEY-triage.txt"
npm run sniper -- companies 25 > "$REPORT_DIR/$DATE_KEY-companies.txt"
npm run sniper -- stats > "$REPORT_DIR/$DATE_KEY-stats.txt"
npm run sniper -- export json "$REPORT_DIR/$DATE_KEY-export.json"
npm run sniper -- sheet sync
