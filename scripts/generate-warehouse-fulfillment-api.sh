#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="${1:-$AGENT_DIR/../generated-warehouse-fulfillment-api}"
MODEL="${GEMINI_MODEL:-gemini-3.5-flash}"

if [[ -z "${GEMINI_API_KEY:-}" ]]; then
  echo "GEMINI_API_KEY is required."
  echo "Run: export GEMINI_API_KEY=\"your-key\""
  exit 1
fi

cd "$AGENT_DIR"

node ./src/cli.mjs generate \
  --intent ./examples/warehouse-fulfillment-api.intent.md \
  --out "$OUTPUT_DIR" \
  --template node-express-ecs-ts \
  --model "$MODEL" \
  --install \
  --force

"$AGENT_DIR/scripts/docker-smoke.sh" "$OUTPUT_DIR" "warehouse-fulfillment-api-smoke"

echo
echo "Generated warehouse API at: $OUTPUT_DIR"
echo
echo "Next:"
echo "  cd \"$OUTPUT_DIR\""
echo "  npm run build"
echo "  npm start"
