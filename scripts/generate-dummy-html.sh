#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="${1:-$AGENT_DIR/../generated-dummy-html}"
TEMPLATE_DIR="$AGENT_DIR/templates/static-dummy-html/files"

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR/.initiative"
cp -R "$TEMPLATE_DIR/." "$OUTPUT_DIR/"

cat > "$OUTPUT_DIR/.initiative/template.json" <<'JSON'
{
  "id": "static-dummy-html",
  "kind": "static-preview",
  "generatedBy": "scripts/generate-dummy-html.sh"
}
JSON

echo "Generated dummy HTML preview at: $OUTPUT_DIR"
echo
echo "Preview:"
echo "  $OUTPUT_DIR/index.html"
echo
echo "Or serve it:"
echo "  cd \"$OUTPUT_DIR\""
echo "  npx serve ."
