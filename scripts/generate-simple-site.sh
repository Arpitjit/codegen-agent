#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="${1:-$AGENT_DIR/../generated-simple-site}"
TEMPLATE_DIR="$AGENT_DIR/templates/simple-site-preview/files"

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR/.initiative"
cp -R "$TEMPLATE_DIR/." "$OUTPUT_DIR/"

cat > "$OUTPUT_DIR/.initiative/template.json" <<'JSON'
{
  "id": "simple-site-preview",
  "kind": "static-site",
  "generatedBy": "scripts/generate-simple-site.sh"
}
JSON

PREVIEW_FILE="$OUTPUT_DIR/index.html"
PREVIEW_URL="file://$PREVIEW_FILE"

echo "Generated simple site at: $OUTPUT_DIR"
echo
echo "Preview link:"
echo "  $PREVIEW_URL"
echo
echo "Open directly:"
echo "  $PREVIEW_FILE"
echo
echo "Or serve locally:"
echo "  cd \"$OUTPUT_DIR\""
echo "  npx serve ."
