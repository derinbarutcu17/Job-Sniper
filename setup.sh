#!/bin/bash

# Job Sniper: Standardized Setup Script
# Description: Installs all dependencies for the Agentic Job Discovery Engine.

set -e

echo "🚀 Starting Job Sniper Setup..."

# 1. Check for Bun
if ! command -v bun &> /dev/null; then
    echo "📦 Bun not found. Installing..."
    curl -fsSL https://bun.sh/install | bash
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
else
    echo "✅ Bun is already installed."
fi

# 2. Check for QMD
if ! command -v qmd &> /dev/null; then
    echo "🧠 QMD (Quick Markdown Search) not found. Installing..."
    bun install -g https://github.com/tobi/qmd
else
    echo "✅ QMD is already installed."
fi

# 3. Check for PDF Rendering Requirements (Playwright/Chromium)
if ! bun pm -g list | grep -q "playwright"; then
    echo "📄 Installing PDF rendering engine..."
    bun install -g playwright
    # Note: Users may need to run 'bunx playwright install' manually if not in a container
fi

# 4. Install Project Dependencies
echo "📦 Installing npm dependencies..."
bun install

# 5. Initialize QMD Collection
echo "⚙️ Initializing local knowledge base..."
mkdir -p my-knowledge
qmd collection add ./my-knowledge --name job-sniper-knowledge

echo "----------------------------------------------------"
echo "✅ Setup Complete!"
echo "Next steps:"
echo "1. Drop your CV (Markdown) and Project descriptions into the 'my-knowledge' folder."
echo "2. Run 'qmd embed' to generate semantic vectors."
echo "3. Run 'bun index.ts run' to find matches."
echo "4. Run 'bun index.ts serve' to view your dashboard."
echo "----------------------------------------------------"
