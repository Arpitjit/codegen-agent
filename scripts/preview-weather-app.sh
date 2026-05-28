#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="${1:-$AGENT_DIR/../generated-weather-app}"
MODEL="${GEMINI_MODEL:-gemini-3.5-flash}"

if [[ -z "${GEMINI_API_KEY:-}" ]]; then
  echo "GEMINI_API_KEY is required."
  echo "Run: export GEMINI_API_KEY=\"your-key\""
  exit 1
fi

cd "$AGENT_DIR"

node ./src/cli.mjs generate \
  --intent ./examples/weather-app.intent.md \
  --out "$OUTPUT_DIR" \
  --template react-vite-ts \
  --model "$MODEL" \
  --install \
  --force

echo
echo "Generated weather app at: $OUTPUT_DIR"
echo
echo "Preview:"
echo "  file://$OUTPUT_DIR/.initiative/preview/index.html"
echo
echo "Next:"
echo "  cd \"$OUTPUT_DIR\""
echo "  npm run dev"
