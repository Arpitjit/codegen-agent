# Initiative Codegen Agent

A manifest-first command line code generation agent inspired by the Initiative architecture.

It uses Google Gemini through the public REST API, so no SDK dependency is required. Bring your own API key.

## Setup

```bash
export GEMINI_API_KEY="your-key"
```

Optional:

```bash
export GEMINI_MODEL="gemini-3.5-flash"
```

If that model name is not enabled for your account, pass another Gemini model with `--model`.

## Generate A Project

```bash
node ./src/cli.mjs generate \
  --intent ./examples/express-api.intent.md \
  --out ../generated-shop-api \
  --model gemini-3.5-flash
```

You can also pass the intent inline:

```bash
node ./src/cli.mjs generate \
  --intent "Create a TypeScript Express REST API for users and orders with Vitest tests." \
  --out ../generated-api
```

Generate a full-stack site:

```bash
./scripts/generate-full-site.sh
```

Or choose the output directory:

```bash
./scripts/generate-full-site.sh ../generated-shop-dashboard
```

The full-site script uses the `react-vite-express-ts` template, which provides known-good package, TypeScript, Vite, Vitest, and npm workspace files before Gemini generates app-specific code.

Generate the orders/shipments API:

```bash
./scripts/generate-orders-shipments-api.sh
```

Generate the more complex warehouse fulfillment API:

```bash
./scripts/generate-warehouse-fulfillment-api.sh
```

Generate a local dummy HTML preview without any API key or model calls:

```bash
./scripts/generate-dummy-html.sh
```

Generate a simple static site preview and print a local preview link:

```bash
./scripts/generate-simple-site.sh
```

Generate an intent-driven HTML preview with Gemini:

```bash
./scripts/generate-intent-preview.sh ./examples/warehouse-fulfillment-api.intent.md ../preview-warehouse
```

Or call the CLI directly:

```bash
node ./src/cli.mjs preview \
  --intent ./examples/warehouse-fulfillment-api.intent.md \
  --out ../preview-warehouse \
  --force
```

Generate a full weather app with an intent-driven preview:

```bash
./scripts/preview-weather-app.sh
```

This uses the frontend-only `react-vite-ts` template. The generated preview is kept inside the final app and passed back into the manifest, planning, and file-generation stages as the frontend visual contract.

The main `generate` command also creates an intent-driven preview by default before final code generation. The preview is written inside the generated project:

```text
.initiative/preview/index.html
.initiative/preview.json
```

Disable that stage with:

```bash
node ./src/cli.mjs generate \
  --intent ./examples/warehouse-fulfillment-api.intent.md \
  --out ../generated-warehouse-fulfillment-api \
  --skip-preview
```

For React/Vite frontend projects, verification also checks that generated JSX and CSS agree. If Tailwind is not fully configured, the generator expects semantic class names and fails verification when JSX uses undefined utility classes such as `text-white`, `rounded-xl`, or `px-4`.

The API scripts use the `node-express-ecs-ts` template, which provides protected package, TypeScript, Vitest, Dockerfile, `.dockerignore`, request logging, and centralized error handling files. After generation, they run a Docker smoke stage when Docker is available:

```bash
docker build
docker run
curl /health
```

## Template Sync And Cache

Templates can be local or synced from a controlled registry into `.template-cache/`.

List available templates:

```bash
node ./src/cli.mjs template list
```

Sync an official scaffold into the local cache:

```bash
node ./src/cli.mjs template sync official-vite-react-ts
```

Refresh an existing cached template:

```bash
node ./src/cli.mjs template sync official-vite-react-ts --force
```

Use a cached template during generation:

```bash
node ./src/cli.mjs generate \
  --intent "Create a React TypeScript dashboard." \
  --template official-vite-react-ts \
  --out ../generated-vite-dashboard \
  --install \
  --force
```

Template sync is explicit. Generation uses local/cached templates and does not fetch from the internet unless you run `template sync`.

## Commands

```bash
node ./src/cli.mjs generate --intent <text-or-file> --out <dir>
node ./src/cli.mjs manifest --intent <text-or-file> --out ./manifest.json
node ./src/cli.mjs plan --manifest ./manifest.json --out ./plan.json
node ./src/cli.mjs verify --project <dir>
node ./src/cli.mjs review --project <dir>
```

## Review Agent

When generation verification fails, the CLI now runs a Gemini-powered review agent before falling back to single-file regeneration. The review agent reads the generated project, `.initiative/manifest.json`, `.initiative/plan.json`, and the verification output, then writes the smallest set of complete file replacements it believes will fix the issue.

If the project still fails, the review agent passes structured feedback back into generation:

- failure category
- root cause
- target files
- generation instructions

The repair loop runs up to 3 rounds. `--retries` can lower that number, but the hard cap is 3.

You can run it manually:

```bash
node ./src/cli.mjs review \
  --project ../generated-shop-api \
  --model gemini-3.5-flash
```

Review output is saved to:

```bash
../generated-shop-api/.initiative/review.json
```

Use `--skip-review` on `generate` if you want the older targeted regeneration behavior only.

## How It Works

1. Generates a locked manifest from rich intent.
2. Generates a file DAG with layers and dependencies.
3. Generates files layer by layer.
4. Passes the full manifest plus real dependency file contents to each file generation call.
5. Runs local verification commands when possible.
6. Runs a review agent on verification failure.
7. Feeds review guidance back into targeted regeneration.
8. Repeats review plus regeneration for up to 3 rounds.

Generated artifacts are written to `.initiative/` inside the output project.

The generator also applies consistency guardrails for Node/TypeScript projects:

- generated test projects must include their own local test config
- Vitest defaults to a simple Node config and default reporter
- reporters, plugins, setup files, and imported packages must be declared in `package.json`
- package scripts must only reference files/configs that exist inside the generated project

## Notes

- This is a prototype agent, not a sandbox. Only run generated projects you trust.
- By default it will not overwrite an existing output directory. Use `--force` to clear the output directory first.
- Verification runs package scripts if they exist. Dependency installation is only attempted when you pass `--install`.
