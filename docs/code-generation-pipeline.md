# Initiative Codegen Agent Pipeline

This document describes how the current `codegen-agent` utility generates code, which agents/prompts it uses, how templates are applied, how the DAG and execution plan work, and how verification and repair are performed.

## Current Goal

The utility generates project code from a rich natural-language intent.

The current design is:

```text
Intent
  -> optional template selection
  -> intent preview generation
  -> manifest generation
  -> file DAG planning
  -> execution group planning
  -> template copy
  -> layered grouped generation
  -> verification
  -> review and repair loop
  -> generated project
```

The core implementation is:

```text
codegen-agent/src/cli.mjs
```

## Commands

Generate a project:

```bash
node ./src/cli.mjs generate \
  --intent ./examples/warehouse-fulfillment-api.intent.md \
  --out ../generated-warehouse-fulfillment-api \
  --template node-express-ecs-ts \
  --install \
  --force
```

Generate a manifest only:

```bash
node ./src/cli.mjs manifest \
  --intent ./examples/warehouse-fulfillment-api.intent.md \
  --out ./manifest.json \
  --template node-express-ecs-ts
```

Generate a plan only:

```bash
node ./src/cli.mjs plan \
  --manifest ./manifest.json \
  --intent ./examples/warehouse-fulfillment-api.intent.md \
  --out ./plan.json \
  --template node-express-ecs-ts
```

Verify an existing generated project:

```bash
node ./src/cli.mjs verify \
  --project ../generated-warehouse-fulfillment-api \
  --install
```

Run review/repair on an existing generated project:

```bash
node ./src/cli.mjs review \
  --project ../generated-warehouse-fulfillment-api
```

List templates:

```bash
node ./src/cli.mjs template list
```

Sync a registry template into the local cache:

```bash
node ./src/cli.mjs template sync official-vite-react-ts
```

## Environment Variables

Gemini API key:

```bash
export GEMINI_API_KEY="..."
```

Optional model override:

```bash
export GEMINI_MODEL="gemini-3.5-flash"
```

The API key must not be committed to the repo.

## Generated Artifacts

Each generated project gets an `.initiative/` directory.

Typical artifacts:

```text
.initiative/
  preview/index.html
  preview.json
  manifest.json
  plan.json
  execution-plan.json
  verification.json
  review.json
  template.json
```

These files are useful for debugging because they show what the engine believed it was building.

## Templates

Templates are known-good project foundations.

They reduce model drift by preventing Gemini from inventing package, TypeScript, test, Docker, or framework configuration from scratch.

Current local templates:

```text
templates/node-express-ecs-ts/
templates/react-vite-express-ts/
```

Cached templates synced from registry live under:

```text
.template-cache/<template-id>/template/
```

Generation uses local or cached templates only. It does not fetch templates from the internet automatically.

### Template Metadata

Each template has a `template.json`.

Example:

```json
{
  "id": "node-express-ecs-ts",
  "kind": "backend",
  "stack": ["nodejs20", "typescript", "express", "vitest", "docker", "ecs-fargate", "npm"],
  "protectedFiles": [
    "package.json",
    "tsconfig.json",
    "vitest.config.ts",
    "Dockerfile",
    ".dockerignore",
    "src/common/errors.ts",
    "src/common/response.ts",
    "src/middleware/errorHandler.ts",
    "src/middleware/requestLogger.ts"
  ],
  "editableFiles": [
    "src/app.ts",
    "src/server.ts",
    "src/config/**",
    "src/models/**",
    "src/data/**",
    "src/repositories/**",
    "src/services/**",
    "src/controllers/**",
    "src/routes/**",
    "tests/**",
    "README.md"
  ]
}
```

### Protected Files

Protected files are copied from the template and removed from the AI generation plan.

This prevents fragile foundational files from being regenerated incorrectly.

Examples:

```text
package.json
tsconfig.json
vitest.config.ts
Dockerfile
.dockerignore
```

### Editable Files

Editable files are where Gemini is expected to generate application-specific code.

Examples:

```text
src/models/**
src/services/**
src/controllers/**
src/routes/**
tests/**
README.md
```

## Template Sync And Cache

The registry file is:

```text
template-registry.json
```

It defines controlled remote/scaffold sources.

Example registry entry:

```json
{
  "id": "official-vite-react-ts",
  "kind": "frontend",
  "stack": ["react", "vite", "typescript", "npm"],
  "sourceType": "scaffold-command",
  "source": "npm create vite@latest -- --template react-ts",
  "command": "npm",
  "args": [
    "create",
    "vite@latest",
    "{{targetDir}}",
    "--",
    "--template",
    "react-ts"
  ],
  "protectedFiles": [
    "package.json",
    "tsconfig.json",
    "tsconfig.app.json",
    "tsconfig.node.json",
    "vite.config.ts",
    "index.html"
  ],
  "editableFiles": ["src/**", "README.md"]
}
```

Sync flow:

```text
template sync <id>
  -> read template-registry.json
  -> run scaffold command or git clone
  -> copy output into .template-cache/<id>/template/files
  -> write .template-cache/<id>/template/template.json
  -> optionally run validation commands
```

Supported source types:

```text
scaffold-command
git
```

Generation does not sync automatically. Sync is explicit so that generation stays deterministic.

## Global Guardrails

The generator injects the following guardrails into manifest generation, DAG planning, file generation, batch generation, and review prompts:

```text
Generated projects must be self-contained and must not rely on config files from parent directories.
For Node/TypeScript projects using Vitest, include a local vitest.config.ts in the file plan.
Vitest config should default to environment: "node" for backend/API projects and reporters: ["default"].
Do not use @vitest/ui/reporter, html reporters, jsdom, setup files, coverage reporters, or plugins unless the required packages and files are explicitly included in package.json and the plan.
Every package.json script must reference commands and config files that exist in the generated project.
Every imported package, reporter, plugin, middleware, or framework helper must be declared in dependencies or devDependencies.
Tests and services must agree on public error messages and response shapes from the manifest.
Prefer simple stable test tooling over fancy reporters or UI tooling.
```

These guardrails reduce recurring failures such as:

```text
missing @types packages
Vitest reading parent config
start script pointing to missing build output
tests expecting different error messages than services return
```

## Step 1: Intent

The user supplies a rich intent.

Example:

```text
Create an Express ECS Fargate API for a warehouse fulfillment platform.

Use Node.js 20, TypeScript, Express, npm, Docker, Vitest, and Supertest.

API versioning:
- Mount all routes under /api/v1
- Include GET /health

Domain:
- Warehouses store inventory for products.
- Customers place orders.
- Orders reserve inventory.
- Shipments are created from orders.
- Inventory adjustments track restocks, damage, and corrections.
```

The engine assumes the intent is rich enough and does not currently run a clarification loop.

## Step 2: Load Template

If `--template <id>` is supplied, `loadTemplate(templateId)` resolves the template.

Resolution order:

```text
templates/<id>/template.json
.template-cache/<id>/template/template.json
```

The template is copied into the output directory before generation.

Template metadata is also written to:

```text
.initiative/template.json
```

## Step 3: Intent Preview Agent

Function:

```text
createProjectPreview({ intent, model, outDir })
```

Purpose:

```text
Generate a preview artifact from the same intent before final code generation.
```

The preview is a single self-contained HTML file:

```text
.initiative/preview/index.html
```

Metadata is written to:

```text
.initiative/preview.json
```

Gemini role:

```text
You are a senior product designer and frontend engineer.
Return only valid JSON.
```

Preview response shape:

```json
{
  "filePath": "index.html",
  "title": "short preview title",
  "summary": "one sentence summary",
  "content": "complete self-contained HTML document"
}
```

Preview rules:

```text
Generate exactly one self-contained index.html file.
Use inline CSS and optional inline JavaScript only.
Do not require a build step, package install, API server, external CSS, or local assets.
The preview must reflect the user's intent, domain, audience, data objects, workflows, and tone.
If the intent is backend/API-focused, create a useful product/API preview page showing routes, resources, sample payloads, architecture, and operational status panels.
If the intent is UI/full-stack-focused, create a polished static mockup of the likely user interface.
Include realistic labels, sections, and sample data from the intent.
Keep it responsive for desktop and mobile.
Do not use markdown fences.
Do not include prose outside JSON.
```

The main `generate` command runs this stage by default.

Skip it with:

```bash
--skip-preview
```

The standalone `preview` command still exists for quick preview-only generation.

## Step 4: Manifest Agent

Function:

```text
generateManifest({ intent, model, template })
```

Purpose:

```text
Convert natural-language intent into a locked architecture contract.
```

Gemini role:

```text
You are a strict software architecture contract agent.
Return only valid JSON.
```

Prompt responsibilities:

```text
Create a locked project manifest from the rich intent.
The manifest is the shared brain for a multi-file code generation engine.
It must be complete enough that file agents do not invent shared names, routes, models, environment variables, error shapes, or test expectations.
```

Required manifest shape:

```json
{
  "project": {
    "name": "string",
    "type": "string",
    "language": "string",
    "framework": "string",
    "packageManager": "string"
  },
  "architecture": {
    "layers": ["string"],
    "moduleBoundaries": ["string"]
  },
  "conventions": {
    "naming": "string",
    "exports": "string",
    "errorHandling": "string",
    "responseShape": "string"
  },
  "models": {},
  "dtos": {},
  "interfaces": {},
  "routes": {},
  "config": {},
  "dependencies": {
    "runtime": {},
    "development": {}
  },
  "testing": {
    "framework": "string",
    "requiredCoverageAreas": ["string"]
  },
  "verification": {
    "commands": ["string"]
  }
}
```

Rules included in the prompt:

```text
Prefer a small coherent MVP over an enormous project.
Make routes, models, DTOs, config keys, interfaces, dependencies, and test expectations explicit.
Include verification.commands suitable for the generated project.
Choose practical package scripts.
Apply global guardrails.
If a template is selected, treat protected files as already solved foundation files.
Do not include prose outside JSON.
```

Output:

```text
.initiative/manifest.json
```

## Step 5: File DAG Planner

Function:

```text
generateValidatedPlan({ manifest, intent, model, template, outDir })
```

Gemini planner function:

```text
generatePlan({ manifest, intent, model, template, previousError })
```

Purpose:

```text
Create a file-level Directed Acyclic Graph.
```

Each node represents one generated file.

Node shape:

```json
{
  "id": "unique-id",
  "filePath": "relative/path",
  "layer": 0,
  "purpose": "what this file must contain",
  "dependsOn": ["relative/path"],
  "contractRefs": ["manifest paths this file must obey"],
  "modelTier": "cheap|standard|strong",
  "verificationHints": ["string"]
}
```

Planner rules:

```text
Use layers: config/package/models at 0, repositories at 1, services at 2, controllers/routes/entrypoints/tests/docs at 3 or later.
Keep each file reasonably focused.
Every dependsOn entry must reference another filePath in nodes.
Use real file paths only.
Never invent pseudo paths like package-json or vite-config-ts.
For Node/TypeScript projects using Vitest, include vitest.config.ts as a Layer 0 file and make tests depend on it.
If a template is selected, do not plan protected files unless explicitly required.
If a template is selected, plan mainly editable app-specific files.
Planned files may depend on protected template files.
Do not include generated code.
Do not include prose outside JSON.
```

### Plan Normalization

Before validation, the engine normalizes common model path mistakes:

```text
package-json -> package.json
tsconfig-json -> tsconfig.json
vite-config-ts -> vite.config.ts
vitest-config-ts -> vitest.config.ts
```

### Template Protection Enforcement

After normalization, protected template files are removed from the generation plan.

Example:

```text
skipped 4 protected template files from generation plan
```

### Plan Validation

The engine validates:

```text
nodes array is non-empty
each node has filePath and numeric layer
dependsOn references either:
  another plan node
  a file already present in output
  a file present in the template files directory
```

If the plan is invalid, Gemini receives the validation error and retries.

Hard cap:

```text
3 attempts
```

Output:

```text
.initiative/plan.json
```

## Step 6: Execution Planner / Batching Agent

Function:

```text
generateValidatedExecutionPlan({ manifest, plan, intent, model, template })
```

Gemini function:

```text
generateExecutionPlan({ manifest, plan, intent, model, template })
```

Purpose:

```text
Decide how to execute the file DAG.
```

The execution planner chooses whether to generate files:

```text
one-by-one
as a small module batch
as a test batch
as a UI batch
as a docs batch
```

Execution group shape:

```json
{
  "id": "stable-kebab-case-id",
  "strategy": "batch",
  "layer": 2,
  "files": [
    "src/models/order.model.ts",
    "src/services/order.service.ts",
    "src/controllers/order.controller.ts"
  ],
  "dependsOnGroups": ["common-types"],
  "reason": "Tightly coupled module should be generated together."
}
```

Rules:

```text
Cover every plan node file exactly once.
Do not include protected template files.
Use batch for tightly coupled small files.
Use single for large/complex files.
Keep batch groups small, normally 2-6 files.
Do not batch unrelated backend and frontend files together.
Do not batch tests with production code unless tiny and directly coupled.
Group layer must be the maximum layer of its files.
dependsOnGroups must reference groups that produce needed dependencies.
Prefer deterministic stable group IDs.
Do not include prose outside JSON.
```

### Execution Plan Validation

The engine validates:

```text
groups array is non-empty
group IDs are unique
strategy is batch or single
single groups contain exactly one file
batch groups contain no more than 8 files
every file exists in the file DAG
every DAG file is covered exactly once
dependsOnGroups references known group IDs
```

If invalid, execution planning retries.

If still invalid, the engine falls back to deterministic per-file execution groups.

Output:

```text
.initiative/execution-plan.json
```

## Step 7: Layered Grouped Generation

Generation happens by execution groups.

Groups are first grouped by layer:

```text
Layer 0
Layer 1
Layer 2
Layer 3
...
```

Within a layer, groups are ordered deterministically:

```text
dependencies first
then group id order
```

This is slower than full parallelism but more deterministic.

### Batch Generation

Function:

```text
generateBatch({ group, manifest, plan, intent, outDir, model, template, previousError })
```

Batch output shape:

```json
{
  "files": [
    {
      "filePath": "src/services/order.service.ts",
      "content": "complete file content"
    },
    {
      "filePath": "src/routes/order.routes.ts",
      "content": "complete file content"
    }
  ]
}
```

Batch prompt receives:

```text
intent
selected template metadata
manifest
execution group
plan nodes for the group
full plan summary
external dependency file contents
previous verification feedback
global guardrails
```

Batch validation checks:

```text
response has files array
every returned file is expected
no duplicate files
content is string
all expected files are returned
```

If batch generation fails, the engine logs the failure and falls back to per-file generation for that group.

### Single File Generation

Function:

```text
generateFileWithRetries(...)
```

Single file response shape:

```json
{
  "filePath": "src/services/order.service.ts",
  "content": "complete file content as a string"
}
```

Each file generation receives:

```text
intent
selected template metadata
manifest
plan node
full plan summary
real direct dependency file contents
previous verification feedback
global guardrails
```

File generation retries up to 3 times for malformed model output or transient request failures.

## Step 8: Gemini Request Handling

Gemini calls use the REST API.

The model defaults to:

```text
gemini-3.5-flash
```

The wrapper:

```text
callGemini(...)
```

sets:

```json
{
  "responseMimeType": "application/json"
}
```

The wrapper retries transient API/network issues up to 3 times.

Retryable statuses:

```text
408
409
425
429
5xx
```

It also handles `fetch failed`.

### JSON Parsing

The parser accepts:

```text
normal JSON
fenced JSON
JSON embedded in text
escaped JSON strings containing \n and \"
```

This was added because long file content responses can occasionally arrive as escaped JSON.

## Step 9: Verification

Function:

```text
verifyProject({ projectDir, install })
```

Verification currently runs:

```text
npm install       if --install is true
npm run build    if package.json has scripts.build
npm test         if package.json has scripts.test
validate start script target
```

If no `node_modules` exists and `--install` was not passed, verification is skipped with a message.

### Build Check

If `package.json` has:

```json
"build": "..."
```

the engine runs:

```bash
npm run build
```

If there is no build script but `tsconfig.json` exists, it runs:

```bash
npx tsc --noEmit
```

### Test Check

If `package.json` has:

```json
"test": "..."
```

the engine runs:

```bash
npm test
```

### Start Script Target Check

After build/test, the engine validates a simple Node start script.

Example:

```json
"start": "node dist/server.js"
```

It checks whether:

```text
dist/server.js
```

exists.

If missing, verification fails and reports likely emitted matches.

Example failure:

```text
Start script points to missing file: dist/server.js
Likely emitted entry: dist/src/server.js
Fix package.json scripts.start or tsconfig rootDir/outDir so the start target exists after build.
```

This catches the case where TypeScript compiles successfully but the app cannot start.

Output:

```text
.initiative/verification.json
```

## Step 10: Review Agent

Function:

```text
reviewProject({ projectDir, model, install, verification })
```

The review agent runs when verification fails.

It receives:

```text
manifest
plan
verification output
project files
global guardrails
```

Review response shape:

```json
{
  "summary": "short review summary",
  "failureAnalysis": {
    "category": "missing_export|bad_import|type_mismatch|missing_dependency|test_failure|runtime_failure|other",
    "rootCause": "short explanation",
    "targetFiles": ["relative/path/to/file"]
  },
  "generationFeedback": "specific instructions for the next file generation pass if direct review patch does not fully fix the project",
  "changes": [
    {
      "filePath": "relative/path/to/file",
      "reason": "why this file must change",
      "content": "complete replacement file content"
    }
  ],
  "notes": ["optional notes"]
}
```

The review agent can directly replace files.

It cannot modify `.initiative/` artifacts.

After applying review changes, verification runs again.

Output:

```text
.initiative/review.json
```

## Step 11: Repair Loop

The repair loop starts only when verification fails.

Hard cap:

```text
3 rounds
```

Flow:

```text
verification fails
  -> review agent analyzes and patches
  -> verification reruns
  -> if still failing, choose target file from review.failureAnalysis.targetFiles or error output
  -> regenerate target file using review feedback
  -> verification reruns
  -> repeat up to 3 rounds
```

If verification never fails, the review loop does not run.

That means runtime problems are only caught if verification includes a check for them.

Currently we catch:

```text
compile failures
test failures
missing start script target
```

Runtime smoke testing is handled by API scripts through Docker smoke, not by core `verifyProject()` yet.

## Step 12: Docker Smoke Stage

API scripts run a Docker smoke stage after generation.

Script:

```text
scripts/docker-smoke.sh
```

Flow:

```bash
docker build -t <image> .
docker run -d -p 3009:3000 <image>
curl http://localhost:3009/health
docker rm -f <container>
```

Environment variables:

```bash
DOCKER_HOST_PORT=3009
DOCKER_CONTAINER_PORT=3000
DOCKER_HEALTH_PATH=/health
```

If Docker is not available, it skips gracefully.

The Dockerfile comes from the protected `node-express-ecs-ts` template.

## Current Scripts

Backend API:

```bash
./scripts/generate-orders-shipments-api.sh
```

Complex backend API:

```bash
./scripts/generate-warehouse-fulfillment-api.sh
```

Full-stack site:

```bash
./scripts/generate-full-site.sh
```

Docker smoke:

```bash
./scripts/docker-smoke.sh <project-dir> <image-name>
```

## Current Local Templates

### node-express-ecs-ts

Purpose:

```text
Express TypeScript API intended for Docker/ECS Fargate.
```

Protected foundation:

```text
package.json
tsconfig.json
vitest.config.ts
Dockerfile
.dockerignore
src/common/errors.ts
src/common/response.ts
src/middleware/errorHandler.ts
src/middleware/requestLogger.ts
```

This template ensures:

```text
Node 20
npm
TypeScript
Express
Vitest
Supertest
Docker build
dist/server.js start target
centralized error handling
request logging
```

### react-vite-express-ts

Purpose:

```text
Full-stack React/Vite frontend plus Express backend.
```

Protected foundation:

```text
root package.json
backend/package.json
backend/tsconfig.json
backend/vitest.config.ts
frontend/package.json
frontend/tsconfig.json
frontend/tsconfig.node.json
frontend/vite.config.ts
frontend/index.html
```

This template ensures:

```text
npm workspaces
Vite React TypeScript
Express backend package setup
local Vitest configs
root build/test/dev scripts
```

## What Is Deterministic

The following parts are deterministic:

```text
template copy
protected file enforcement
plan validation
path normalization
execution plan validation
layer ordering
group dependency ordering
file writes
build/test/start-target verification
Docker smoke command sequence
```

The following parts are AI-generated:

```text
manifest
file DAG
execution groups
batch file content
single file content
review patches
repair generation
```

## Why Templates Matter

Without templates, Gemini may invent fragile foundation files:

```text
package.json
tsconfig.json
Dockerfile
vitest.config.ts
vite.config.ts
workspace scripts
```

Templates reduce this risk by providing known-good files.

Gemini then focuses on:

```text
models
repositories
services
controllers
routes
tests
README
frontend app code
```

## Known Limitations

The engine is not yet universal.

Current limitations:

```text
No hierarchical system -> module -> file planning yet.
No full runtime smoke check in core verifyProject().
No database-backed templates yet.
No authentication/authorization template pack yet.
No queue/worker template pack yet.
No persistent JSONL event log yet.
No automatic template composition from multiple template packs.
No clarification loop for vague intent.
```

## Recommended Next Improvements

1. Add persistent event logging:

```text
.initiative/events.jsonl
```

2. Add core runtime smoke verification:

```text
npm start
wait for /health
stop process
```

3. Add hierarchical planning:

```text
system manifest
module manifests
module DAGs
file DAGs
execution groups
```

4. Add template composition:

```text
backend template
+ frontend template
+ database template
+ infra template
```

5. Add fix recipe knowledge base:

```text
knowledge/fixes/
  missing-typescript-dependencies.json
  vitest-parent-config-leak.json
  start-script-target-mismatch.json
  supertest-app-listen-mismatch.json
```

6. Add first-class Docker verification to `verifyProject()`, not only scripts.

## Mental Model

The engine should be understood as:

```text
Templates provide the stable skeleton.
Manifest provides the shared contract.
DAG provides dependency order.
Execution plan provides batching strategy.
Gemini generates app-specific implementation.
Verification catches deterministic failures.
Review/repair fixes what verification exposes.
```

The goal is not to let AI invent an entire project from nothing.

The goal is:

```text
known-good foundation
+ explicit contract
+ controlled AI generation
+ deterministic validation
+ bounded repair loop
```
