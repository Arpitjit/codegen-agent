#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
INTENT="${1:-$AGENT_DIR/examples/warehouse-fulfillment-api.intent.md}"
OUTPUT_DIR="${2:-$AGENT_DIR/../generated-intent-preview}"
MODEL="${GEMINI_MODEL:-gemini-3.5-flash}"

if [[ -z "${GEMINI_API_KEY:-}" ]]; then
  echo "GEMINI_API_KEY is required."
  echo "Run: export GEMINI_API_KEY=\"your-key\""
  exit 1
fi

cd "$AGENT_DIR"

node ./src/cli.mjs preview \
  --intent "$INTENT" \
  --out "$OUTPUT_DIR" \
  --model "$MODEL" \
  --force
