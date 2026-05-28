#!/usr/bin/env node

import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta";

const MANIFEST_SCHEMA = {
  project: {
    name: "string",
    type: "string",
    language: "string",
    framework: "string",
    packageManager: "string"
  },
  architecture: {
    layers: ["string"],
    moduleBoundaries: ["string"]
  },
  conventions: {
    naming: "string",
    exports: "string",
    errorHandling: "string",
    responseShape: "string"
  },
  models: {},
  dtos: {},
  interfaces: {},
  routes: {},
  config: {},
  dependencies: {
    runtime: {},
    development: {}
  },
  testing: {
    framework: "string",
    requiredCoverageAreas: ["string"]
  },
  verification: {
    commands: ["string"]
  }
};

const GENERATION_GUARDRAILS = `
Project consistency guardrails:
- Generated projects must be self-contained and must not rely on config files from parent directories.
- For Node/TypeScript projects using Vitest, include a local vitest.config.ts in the file plan.
- Vitest config should default to environment: "node" for backend/API projects and reporters: ["default"].
- Do not use @vitest/ui/reporter, html reporters, jsdom, setup files, coverage reporters, or plugins unless the required packages and files are explicitly included in package.json and the plan.
- Every package.json script must reference commands and config files that exist in the generated project.
- Every imported package, reporter, plugin, middleware, or framework helper must be declared in dependencies or devDependencies.
- Tests and services must agree on public error messages and response shapes from the manifest.
- Prefer simple stable test tooling over fancy reporters or UI tooling.
- For frontend projects without Tailwind installed and configured, do not use Tailwind utility classes. Use semantic class names and define every class used in JSX in the generated CSS.
- Frontend entrypoints must import the global stylesheet exactly once from the entrypoint or another always-loaded root module.
`.trim();

function usage() {
  return `Initiative Codegen Agent

Usage:
  initiative-codegen generate --intent <text-or-file> --out <dir> [--template <id>] [--model gemini-3.5-flash] [--retries 3] [--force] [--install] [--skip-preview] [--skip-review]
  initiative-codegen preview --intent <text-or-file> --out <dir> [--model gemini-3.5-flash] [--force]
  initiative-codegen manifest --intent <text-or-file> --out <manifest.json> [--model gemini-3.5-flash]
  initiative-codegen plan --manifest <manifest.json> --out <plan.json> [--model gemini-3.5-flash]
  initiative-codegen verify --project <dir> [--install]
  initiative-codegen review --project <dir> [--model gemini-3.5-flash] [--install]
  initiative-codegen template list
  initiative-codegen template sync <id> [--force]

Environment:
  GEMINI_API_KEY  Required for Gemini calls
  GEMINI_MODEL    Optional default model, defaults to ${DEFAULT_MODEL}
`;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command, _: [] };

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }

    const key = token.slice(2);
    if (["force", "install", "help", "skip-preview", "skip-review"].includes(key)) {
      args[key] = true;
      continue;
    }

    const value = rest[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    args[key] = value;
    i += 1;
  }

  return args;
}

function requireArg(args, key) {
  if (!args[key]) {
    throw new Error(`Missing required argument --${key}`);
  }
  return args[key];
}

async function readTextOrFile(value) {
  const resolved = path.resolve(value);
  if (existsSync(resolved)) {
    return readFile(resolved, "utf8");
  }
  return value;
}

async function readJson(filePath) {
  const text = await readFile(path.resolve(filePath), "utf8");
  return JSON.parse(text);
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
  await writeFile(path.resolve(filePath), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function assertGeminiKey() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is required. Export it before running generation.");
  }
}

async function callGemini({ model, system, prompt, temperature = 0.2 }) {
  assertGeminiKey();
  const modelName = model.startsWith("models/") ? model.slice("models/".length) : model;
  const url = `${GEMINI_ENDPOINT}/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const body = JSON.stringify({
    systemInstruction: {
      parts: [{ text: system }]
    },
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      temperature,
      responseMimeType: "application/json"
    }
  });

  let response = null;
  let payload = {};
  let lastError = null;
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body
      });
      payload = await response.json().catch(() => ({}));
      if (response.ok) {
        break;
      }

      const message = payload?.error?.message || response.statusText;
      lastError = new Error(`Gemini request failed for ${model}: ${message}`);
      if (!isRetryableGeminiStatus(response.status) || attempt === maxAttempts) {
        throw lastError;
      }
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) {
        throw new Error(`Gemini request failed for ${model} after ${maxAttempts} attempts: ${error.message}`);
      }
    }

    const delayMs = 750 * attempt;
    console.log(`  Gemini request retry ${attempt + 1}/${maxAttempts} after: ${lastError.message}`);
    await sleep(delayMs);
  }

  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n").trim();
  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }
  return parseJsonResponse(text);
}

function isRetryableGeminiStatus(status) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseJsonResponse(text) {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);

  if (fenced) {
    candidates.push(fenced[1].trim());
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    candidates.push(trimmed.slice(first, last + 1));
  }

  if (trimmed.includes("\\n") || trimmed.includes('\\"')) {
    const unescaped = trimmed
      .replaceAll("\\n", "\n")
      .replaceAll("\\t", "\t")
      .replaceAll('\\"', '"');
    candidates.push(unescaped.trim());

    const unescapedFirst = unescaped.indexOf("{");
    const unescapedLast = unescaped.lastIndexOf("}");
    if (unescapedFirst >= 0 && unescapedLast > unescapedFirst) {
      candidates.push(unescaped.slice(unescapedFirst, unescapedLast + 1));
    }
  }

  let lastError = null;
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed === "string") {
        candidates.push(parsed.trim());
        continue;
      }
      return parsed;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`Could not parse Gemini JSON response: ${lastError?.message || "unknown parse error"}\n${trimmed.slice(0, 800)}`);
}

async function loadTemplate(templateId) {
  if (!templateId) {
    return null;
  }
  const templateDir = await resolveTemplateDir(templateId);
  const metadataPath = path.join(templateDir, "template.json");
  if (!existsSync(metadataPath)) {
    throw new Error(`Unknown template "${templateId}". Expected ${metadataPath}`);
  }
  const metadata = await readJson(metadataPath);
  return {
    ...metadata,
    id: metadata.id || templateId,
    dir: templateDir,
    filesDir: path.join(templateDir, "files")
  };
}

async function resolveTemplateDir(templateId) {
  const localTemplateDir = path.resolve("templates", templateId);
  if (existsSync(path.join(localTemplateDir, "template.json"))) {
    return localTemplateDir;
  }

  const cachedTemplateDir = path.resolve(".template-cache", templateId, "template");
  if (existsSync(path.join(cachedTemplateDir, "template.json"))) {
    return cachedTemplateDir;
  }

  return localTemplateDir;
}

async function loadTemplateRegistry() {
  const registryPath = path.resolve("template-registry.json");
  if (!existsSync(registryPath)) {
    return { templates: [] };
  }
  return readJson(registryPath);
}

async function listTemplates() {
  const registry = await loadTemplateRegistry();
  const localIds = existsSync(path.resolve("templates"))
    ? await readdir(path.resolve("templates"))
    : [];
  const cachedIds = existsSync(path.resolve(".template-cache"))
    ? await readdir(path.resolve(".template-cache"))
    : [];
  const allIds = [...new Set([
    ...localIds,
    ...cachedIds,
    ...(registry.templates || []).map((template) => template.id)
  ])].sort();

  for (const id of allIds) {
    const registryEntry = (registry.templates || []).find((template) => template.id === id);
    const hasLocal = existsSync(path.join("templates", id, "template.json"));
    const hasCache = existsSync(path.join(".template-cache", id, "template", "template.json"));
    const source = registryEntry ? `${registryEntry.sourceType}:${registryEntry.source}` : "local";
    console.log(`${id}  local=${hasLocal ? "yes" : "no"} cache=${hasCache ? "yes" : "no"} source=${source}`);
  }
}

async function syncTemplate(templateId, force) {
  const registry = await loadTemplateRegistry();
  const entry = (registry.templates || []).find((template) => template.id === templateId);
  if (!entry) {
    throw new Error(`Template "${templateId}" is not in template-registry.json`);
  }

  const cacheRoot = path.resolve(".template-cache", templateId);
  const workDir = path.join(cacheRoot, "work");
  const templateDir = path.join(cacheRoot, "template");
  const filesDir = path.join(templateDir, "files");

  if (existsSync(templateDir) && !force) {
    console.log(`Template ${templateId} is already cached at ${templateDir}. Use --force to refresh.`);
    return;
  }

  await rm(workDir, { recursive: true, force: true });
  await rm(templateDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });

  const sourceDir = await fetchTemplateSource(entry, workDir);
  await mkdir(templateDir, { recursive: true });
  await cp(sourceDir, filesDir, { recursive: true });
  await writeJson(path.join(templateDir, "template.json"), {
    id: entry.id,
    kind: entry.kind,
    stack: entry.stack,
    source: entry.source,
    sourceType: entry.sourceType,
    sourceArgs: entry.args || [],
    protectedFiles: entry.protectedFiles || [],
    editableFiles: entry.editableFiles || ["src/**", "README.md"],
    verification: entry.verification || {},
    instructions: entry.instructions || [],
    syncedAt: new Date().toISOString()
  });

  for (const command of entry.validate || []) {
    const result = await runCommand(command[0], command.slice(1), filesDir);
    if (result.code !== 0) {
      throw new Error(`Template ${templateId} validation failed: ${command.join(" ")}\n${result.output}`);
    }
  }

  await writeJson(path.join(cacheRoot, "source.json"), entry);
  console.log(`Cached template ${templateId} at ${templateDir}`);
}

async function fetchTemplateSource(entry, workDir) {
  if (entry.sourceType === "scaffold-command") {
    const targetDir = path.join(workDir, "source");
    const args = (entry.args || []).map((arg) => arg.replaceAll("{{targetDir}}", targetDir));
    const result = await runCommand(entry.command, args, workDir);
    if (result.code !== 0) {
      throw new Error(`Template scaffold failed: ${entry.command} ${args.join(" ")}\n${result.output}`);
    }
    return targetDir;
  }

  if (entry.sourceType === "git") {
    const targetDir = path.join(workDir, "source");
    const args = ["clone", "--depth", "1"];
    if (entry.ref) {
      args.push("--branch", entry.ref);
    }
    args.push(entry.source, targetDir);
    const result = await runCommand("git", args, workDir);
    if (result.code !== 0) {
      throw new Error(`Template git clone failed: git ${args.join(" ")}\n${result.output}`);
    }
    return targetDir;
  }

  throw new Error(`Unsupported template sourceType: ${entry.sourceType}`);
}

async function generatePreview({ intent, model }) {
  return callGemini({
    model,
    temperature: 0.2,
    system: "You are a senior product designer and frontend engineer. Return only valid JSON. Do not include markdown.",
    prompt: `Create a single-file static HTML preview for this product/app intent.

Return JSON:
{
  "filePath": "index.html",
  "title": "short preview title",
  "summary": "one sentence summary",
  "content": "complete self-contained HTML document"
}

Rules:
- Generate exactly one self-contained index.html file.
- Use inline CSS and optional inline JavaScript only.
- Do not require a build step, package install, API server, external CSS, or local assets.
- The preview must reflect the user's intent, domain, audience, data objects, workflows, and tone.
- If the intent is backend/API-focused, create a useful product/API preview page showing routes, resources, sample payloads, architecture, and operational status panels.
- If the intent is UI/full-stack-focused, create a polished static mockup of the likely user interface.
- Use a modern, intentional color system suited to the product domain. Avoid plain default colors, generic wireframe styling, and one-note palettes.
- Make the preview visually polished enough for stakeholder review: strong hierarchy, refined spacing, responsive layout, accessible contrast, and tasteful depth or texture when useful.
- Include realistic labels, sections, and sample data from the intent.
- Keep it responsive for desktop and mobile.
- Do not use markdown fences.
- Do not include prose outside JSON.

Intent:
${intent}`
  });
}

async function createPreview(args) {
  const model = args.model || DEFAULT_MODEL;
  const intent = await readTextOrFile(requireArg(args, "intent"));
  const outDir = path.resolve(requireArg(args, "out"));

  await prepareOutputDir(outDir, Boolean(args.force));
  const preview = await generatePreview({ intent, model });

  if (preview.filePath !== "index.html") {
    throw new Error(`Preview must return index.html, received ${preview.filePath}`);
  }
  if (typeof preview.content !== "string" || !preview.content.includes("<html")) {
    throw new Error("Preview response did not include a complete HTML document.");
  }

  await writeGeneratedFile(outDir, "index.html", preview.content);
  await writeJson(path.join(outDir, ".initiative", "preview.json"), {
    title: preview.title || "Preview",
    summary: preview.summary || "",
    model,
    generatedAt: new Date().toISOString()
  });

  const previewUrl = `file://${path.join(outDir, "index.html")}`;
  console.log(`Generated preview at: ${outDir}`);
  console.log("");
  console.log("Preview link:");
  console.log(`  ${previewUrl}`);
}

async function createProjectPreview({ intent, model, outDir }) {
  const preview = await generatePreview({ intent, model });

  if (preview.filePath !== "index.html") {
    throw new Error(`Preview must return index.html, received ${preview.filePath}`);
  }
  if (typeof preview.content !== "string" || !preview.content.includes("<html")) {
    throw new Error("Preview response did not include a complete HTML document.");
  }

  const previewDir = path.join(outDir, ".initiative", "preview");
  await mkdir(previewDir, { recursive: true });
  await writeGeneratedFile(previewDir, "index.html", preview.content);
  await writeJson(path.join(outDir, ".initiative", "preview.json"), {
    title: preview.title || "Preview",
    summary: preview.summary || "",
    filePath: ".initiative/preview/index.html",
    model,
    generatedAt: new Date().toISOString()
  });

  return {
    url: `file://${path.join(previewDir, "index.html")}`,
    title: preview.title || "Preview",
    summary: preview.summary || "",
    filePath: ".initiative/preview/index.html",
    content: preview.content
  };
}

function describePreviewContract(previewContext) {
  if (!previewContext?.content) {
    return "No preview generated or preview was skipped.";
  }

  return JSON.stringify({
    title: previewContext.title,
    summary: previewContext.summary,
    filePath: previewContext.filePath,
    usage: [
      "Treat this preview as the approved visual/frontend contract.",
      "For frontend or full-stack projects, preserve the same product structure, labels, visual hierarchy, color direction, and core interaction states in the real app.",
      "Convert the preview into framework-native code when the selected technology requires it instead of generating an unrelated UI."
    ],
    contentExcerpt: previewContext.content.slice(0, 16000)
  }, null, 2);
}

function describeTemplate(template) {
  if (!template) {
    return "No template selected. Generate all files from the manifest and plan.";
  }
  return JSON.stringify({
    id: template.id,
    kind: template.kind,
    stack: template.stack,
    protectedFiles: template.protectedFiles,
    editableFiles: template.editableFiles,
    verification: template.verification,
    instructions: template.instructions
  }, null, 2);
}

async function applyTemplate(template, outDir) {
  if (!template) {
    return;
  }
  if (existsSync(template.filesDir)) {
    await cp(template.filesDir, outDir, { recursive: true });
  }
  await mkdir(path.join(outDir, ".initiative"), { recursive: true });
  await writeJson(path.join(outDir, ".initiative", "template.json"), {
    id: template.id,
    kind: template.kind,
    stack: template.stack,
    protectedFiles: template.protectedFiles,
    editableFiles: template.editableFiles,
    source: template.source
  });
}

async function generateManifest({ intent, model, template, previewContext }) {
  return callGemini({
    model,
    temperature: 0.15,
    system: "You are a strict software architecture contract agent. Return only valid JSON. Do not include markdown.",
    prompt: `Create a locked project manifest from the rich intent.

The manifest is the shared brain for a multi-file code generation engine. It must be complete enough that file agents do not invent shared names, routes, models, environment variables, error shapes, or test expectations.

Return JSON with this shape. You may add useful fields, but do not omit these top-level sections:
${JSON.stringify(MANIFEST_SCHEMA, null, 2)}

Rules:
- Prefer a small coherent MVP over an enormous project.
- Make routes, models, DTOs, config keys, interfaces, dependencies, and test expectations explicit.
- Include verification.commands suitable for the generated project.
- Choose practical package scripts.
- If the selected template is frontend-only or the intent says no backend is required, do not invent backend routes, API proxies, server modules, or /api calls. Browser-safe public APIs should be called directly from frontend service modules.
- Use the preview contract for UI/frontend decisions. The generated app should feel like an implementation of the preview, not a separate redesign.
- Apply these guardrails:
${GENERATION_GUARDRAILS}
- If a template is selected, treat its protected files as already solved foundation files. Do not ask downstream agents to reinvent them.
- Do not include prose outside JSON.

Intent:
${intent}

Selected template:
${describeTemplate(template)}

Preview contract:
${describePreviewContract(previewContext)}`
  });
}

async function generatePlan({ manifest, intent, model, template, previewContext, previousError }) {
  return callGemini({
    model,
    temperature: 0.1,
    system: "You are a deterministic DAG planner for code generation. Return only valid JSON. Do not include markdown.",
    prompt: `Create a file-level DAG plan for generating this project.

Return JSON:
{
  "projectName": "string",
  "rootFiles": ["string"],
  "nodes": [
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
  ]
}

Rules:
- Use layers: config/package/models at 0, repositories at 1, services at 2, controllers/routes/entrypoints/tests/docs at 3 or later.
- Keep each file reasonably focused.
- Every dependsOn entry must reference another filePath in nodes.
- Use real file paths only. For example, use package.json, tsconfig.json, vite.config.ts, and vitest.config.ts. Never invent pseudo paths like package-json or vite-config-ts.
- For Node/TypeScript projects using Vitest, include vitest.config.ts as a Layer 0 file and make tests depend on it.
- Apply these guardrails:
${GENERATION_GUARDRAILS}
- If a template is selected, do not plan protected files unless the intent explicitly requires changing them.
- If a template is selected, plan mainly editable app-specific files matching editableFiles.
- If the selected template is frontend-only or the intent says no backend is required, do not plan backend files, server routes, API proxy files, or /api adapter code.
- For UI/frontend files, use the preview contract as a dependency for layout, content, colors, and interaction states.
- For frontend templates without Tailwind, plan a real global stylesheet such as src/index.css and make visual components depend on it or be generated in the same batch.
- Do not plan protected entrypoints such as src/main.tsx when the template already provides them.
- Planned files may depend on protected template files, but protected files do not need generation nodes.
- Do not include generated code.
- Do not include prose outside JSON.

Intent:
${intent}

Previous planner validation error:
${previousError || "none"}

Selected template:
${describeTemplate(template)}

Preview contract:
${describePreviewContract(previewContext)}

Manifest:
${JSON.stringify(manifest, null, 2)}`
  });
}

async function generateValidatedPlan({ manifest, intent, model, template, previewContext, outDir, attempts = 3 }) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const plan = enforceTemplateProtection(normalizePlanPaths(await generatePlan({
      manifest,
      intent,
      model,
      template,
      previewContext,
      previousError: lastError?.message
    })), template);
    try {
      validatePlan(plan, outDir, template);
      if (attempt > 1) {
        console.log(`  planner repaired DAG on attempt ${attempt}/${attempts}`);
      }
      return plan;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        console.log(`  planner retry ${attempt + 1}/${attempts} after invalid DAG: ${error.message}`);
      }
    }
  }
  throw lastError;
}

async function generateExecutionPlan({ manifest, plan, intent, model, template, previewContext }) {
  return callGemini({
    model,
    temperature: 0.05,
    system: "You are a deterministic execution planner for code generation. Return only valid JSON. Do not include markdown.",
    prompt: `Decide how to execute this file generation DAG.

Return JSON:
{
  "groups": [
    {
      "id": "stable-kebab-case-id",
      "strategy": "batch|single",
      "layer": 0,
      "files": ["relative/path.ts"],
      "dependsOnGroups": ["other-group-id"],
      "reason": "short reason"
    }
  ]
}

Rules:
- Cover every plan node file exactly once.
- Do not include protected template files.
- Use "batch" for tightly coupled small files that benefit from shared context, such as module models/repository/service/routes, frontend App/api/styles, tests for the same feature, or docs.
- Use "single" for large/complex files or files likely to exceed response limits.
- Keep batch groups small: normally 2-6 files.
- Do not batch unrelated backend and frontend files together.
- Do not batch tests with production code unless they are tiny and directly coupled.
- Prefer batching tightly coupled frontend visual files such as App, styles, and frontend service/types when they implement the preview contract together.
- A group layer must be the maximum layer of its files.
- dependsOnGroups must include groups that produce external file dependencies required before this group.
- Prefer deterministic, stable group IDs.
- Do not include prose outside JSON.

Intent:
${intent}

Selected template:
${describeTemplate(template)}

Preview contract:
${describePreviewContract(previewContext)}

Manifest:
${JSON.stringify(manifest, null, 2)}

File DAG:
${JSON.stringify(plan, null, 2)}`
  });
}

async function generateValidatedExecutionPlan({ manifest, plan, intent, model, template, previewContext, attempts = 2 }) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const executionPlan = await generateExecutionPlan({ manifest, plan, intent, model, template, previewContext });
      validateExecutionPlan(executionPlan, plan);
      return normalizeExecutionPlan(executionPlan, plan);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        console.log(`  execution planner retry ${attempt + 1}/${attempts} after invalid grouping: ${error.message}`);
      }
    }
  }

  console.log(`  execution planner fallback to deterministic per-file groups: ${lastError.message}`);
  return buildDefaultExecutionPlan(plan);
}

function validateExecutionPlan(executionPlan, plan) {
  if (!Array.isArray(executionPlan?.groups) || executionPlan.groups.length === 0) {
    throw new Error("Execution plan must contain a non-empty groups array.");
  }

  const nodeFiles = new Set(plan.nodes.map((node) => node.filePath));
  const seenFiles = new Set();
  const groupIds = new Set();

  for (const group of executionPlan.groups) {
    if (!group.id || groupIds.has(group.id)) {
      throw new Error(`Invalid or duplicate execution group id: ${group.id}`);
    }
    groupIds.add(group.id);

    if (!["batch", "single"].includes(group.strategy)) {
      throw new Error(`Execution group ${group.id} has invalid strategy ${group.strategy}`);
    }
    if (!Array.isArray(group.files) || group.files.length === 0) {
      throw new Error(`Execution group ${group.id} must include files.`);
    }
    if (group.strategy === "single" && group.files.length !== 1) {
      throw new Error(`Execution group ${group.id} uses single strategy but has ${group.files.length} files.`);
    }
    if (group.strategy === "batch" && group.files.length > 8) {
      throw new Error(`Execution group ${group.id} batch is too large (${group.files.length} files).`);
    }

    for (const filePath of group.files) {
      if (!nodeFiles.has(filePath)) {
        throw new Error(`Execution group ${group.id} references unknown file ${filePath}`);
      }
      if (seenFiles.has(filePath)) {
        throw new Error(`Execution group ${group.id} duplicates file ${filePath}`);
      }
      seenFiles.add(filePath);
    }
  }

  for (const filePath of nodeFiles) {
    if (!seenFiles.has(filePath)) {
      throw new Error(`Execution plan does not cover ${filePath}`);
    }
  }

  for (const group of executionPlan.groups) {
    for (const depGroupId of group.dependsOnGroups || []) {
      if (!groupIds.has(depGroupId)) {
        throw new Error(`Execution group ${group.id} depends on unknown group ${depGroupId}`);
      }
    }
  }
}

function normalizeExecutionPlan(executionPlan, plan) {
  const layerByFile = new Map(plan.nodes.map((node) => [node.filePath, node.layer]));
  const nodeOrder = new Map(plan.nodes.map((node, index) => [node.filePath, index]));
  return {
    groups: executionPlan.groups
      .map((group) => {
        const files = [...group.files].sort((a, b) => nodeOrder.get(a) - nodeOrder.get(b));
        return {
          id: group.id,
          strategy: group.strategy,
          layer: Math.max(...files.map((filePath) => layerByFile.get(filePath))),
          files,
          dependsOnGroups: Array.isArray(group.dependsOnGroups) ? [...group.dependsOnGroups].sort() : [],
          reason: group.reason || ""
        };
      })
      .sort((a, b) => a.layer - b.layer || a.id.localeCompare(b.id))
  };
}

function buildDefaultExecutionPlan(plan) {
  return {
    groups: plan.nodes
      .map((node) => ({
        id: node.filePath.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase(),
        strategy: "single",
        layer: node.layer,
        files: [node.filePath],
        dependsOnGroups: [],
        reason: "Default per-file generation fallback."
      }))
      .sort((a, b) => a.layer - b.layer || a.id.localeCompare(b.id))
  };
}

function normalizePlanPaths(plan) {
  if (!Array.isArray(plan?.nodes)) {
    return plan;
  }

  const replacements = new Map([
    ["package-json", "package.json"],
    ["tsconfig-json", "tsconfig.json"],
    ["vite-config-ts", "vite.config.ts"],
    ["vitest-config-ts", "vitest.config.ts"]
  ]);

  const normalizePath = (filePath) => {
    if (typeof filePath !== "string") {
      return filePath;
    }
    const parts = filePath.split("/");
    const last = parts[parts.length - 1];
    if (replacements.has(last)) {
      parts[parts.length - 1] = replacements.get(last);
      return parts.join("/");
    }
    return filePath;
  };

  return {
    ...plan,
    rootFiles: Array.isArray(plan.rootFiles) ? plan.rootFiles.map(normalizePath) : plan.rootFiles,
    nodes: plan.nodes.map((node) => ({
      ...node,
      filePath: normalizePath(node.filePath),
      dependsOn: Array.isArray(node.dependsOn) ? node.dependsOn.map(normalizePath) : node.dependsOn
    }))
  };
}

function enforceTemplateProtection(plan, template) {
  if (!template?.protectedFiles?.length || !Array.isArray(plan?.nodes)) {
    return plan;
  }

  const protectedFiles = new Set(template.protectedFiles);
  const nodes = plan.nodes.filter((node) => !protectedFiles.has(node.filePath));
  const removed = plan.nodes.length - nodes.length;
  if (removed > 0) {
    console.log(`  skipped ${removed} protected template file${removed === 1 ? "" : "s"} from generation plan`);
  }

  return { ...plan, nodes };
}

function validatePlan(plan, outDir = ".", template = null) {
  if (!Array.isArray(plan?.nodes) || plan.nodes.length === 0) {
    throw new Error("Plan must contain a non-empty nodes array.");
  }

  const filePaths = new Set(plan.nodes.map((node) => node.filePath));
  for (const node of plan.nodes) {
    if (!node.filePath || typeof node.layer !== "number") {
      throw new Error(`Invalid plan node: ${JSON.stringify(node)}`);
    }
    for (const dep of node.dependsOn || []) {
      const depExistsInOutput = existsSync(path.resolve(outDir, dep));
      const depExistsInTemplate = template?.filesDir ? existsSync(path.resolve(template.filesDir, dep)) : false;
      if (!filePaths.has(dep) && !depExistsInOutput && !depExistsInTemplate) {
        throw new Error(`Plan node ${node.filePath} depends on unknown file ${dep}`);
      }
    }
  }
}

async function generateFile({ node, manifest, plan, intent, outDir, model, template, previewContext, previousError }) {
  const dependencies = {};
  for (const dep of node.dependsOn || []) {
    const depPath = path.join(outDir, dep);
    if (existsSync(depPath)) {
      dependencies[dep] = await readFile(depPath, "utf8");
    }
  }

  const result = await callGemini({
    model,
    temperature: node.modelTier === "cheap" ? 0.15 : 0.25,
    system: "You are a precise file generation agent. Return only valid JSON. Do not include markdown.",
    prompt: `Generate exactly one file for a contract-driven project.

Return JSON:
{
  "filePath": "${node.filePath}",
  "content": "complete file content as a string"
}

Rules:
- Generate only the requested file.
- The file must obey the manifest exactly. Do not invent shared names, routes, config keys, response shapes, or methods.
- Use real dependency code below for imports and call sites.
- Keep imports relative and valid from this file.
- Do not wrap content in markdown fences.
- If this is package.json or another JSON file, content must itself be valid JSON text.
- If previous verification feedback is provided, fix only this file.
- For UI/frontend files, implement the preview contract in framework-native code. Preserve its layout intent, copy, color system, visual hierarchy, and states unless the manifest says otherwise.
- If the selected template is frontend-only or the intent says no backend is required, do not call /api routes or assume a local backend. Call browser-safe public APIs directly from frontend service modules.
- For frontend files without Tailwind configured, do not use utility class names like flex, grid, px-4, text-white, rounded-xl, md:grid-cols-4, or bg-sky-500. Use semantic class names and define them in the generated CSS.
- If generating JSX and CSS separately, keep class names exactly synchronized. Every visual class used in JSX must exist in the CSS file.
- Apply these guardrails:
${GENERATION_GUARDRAILS}
- If a template is selected, preserve its foundation and follow its structure. Do not rewrite protected files unless this node is explicitly for that protected file.

Intent:
${intent}

Selected template:
${describeTemplate(template)}

Preview contract:
${describePreviewContract(previewContext)}

Manifest:
${JSON.stringify(manifest, null, 2)}

Plan node:
${JSON.stringify(node, null, 2)}

Full plan summary:
${JSON.stringify(plan.nodes.map(({ filePath, layer, purpose, dependsOn }) => ({ filePath, layer, purpose, dependsOn })), null, 2)}

Dependency file contents:
${JSON.stringify(dependencies, null, 2)}

Previous verification feedback:
${previousError || "none"}`
  });

  if (result.filePath !== node.filePath) {
    throw new Error(`Gemini returned ${result.filePath}, expected ${node.filePath}`);
  }
  if (typeof result.content !== "string") {
    throw new Error(`Generated content for ${node.filePath} was not a string.`);
  }
  return result.content;
}

async function generateFileWithRetries({ node, manifest, plan, intent, outDir, model, template, previewContext, previousError, attempts = 3 }) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await generateFile({
        node,
        manifest,
        plan,
        intent,
        outDir,
        model,
        template,
        previewContext,
        previousError: [
          previousError,
          lastError ? `Previous generation attempt failed for ${node.filePath}: ${lastError.message}` : null
        ].filter(Boolean).join("\n\n")
      });
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        console.log(`  retrying ${node.filePath} after generation error (${attempt}/${attempts}): ${error.message}`);
      }
    }
  }
  throw lastError;
}

async function generateBatch({ group, manifest, plan, intent, outDir, model, template, previewContext, previousError }) {
  const nodeByFile = new Map(plan.nodes.map((node) => [node.filePath, node]));
  const groupFiles = new Set(group.files);
  const dependencies = {};

  for (const filePath of group.files) {
    const node = nodeByFile.get(filePath);
    for (const dep of node?.dependsOn || []) {
      if (groupFiles.has(dep)) {
        continue;
      }
      const depPath = path.join(outDir, dep);
      if (existsSync(depPath)) {
        dependencies[dep] = await readFile(depPath, "utf8");
      }
    }
  }

  const result = await callGemini({
    model,
    temperature: 0.1,
    system: "You are a precise multi-file generation agent. Return only valid JSON. Do not include markdown.",
    prompt: `Generate a coherent batch of files for a contract-driven project.

Return JSON:
{
  "files": [
    {
      "filePath": "relative/path",
      "content": "complete file content as a string"
    }
  ]
}

Rules:
- Generate exactly and only the requested files.
- The files must be mutually consistent with each other.
- The files must obey the manifest exactly. Do not invent shared names, routes, config keys, response shapes, or methods.
- Use real dependency code below for imports and call sites.
- Keep imports relative and valid from each file.
- Do not wrap content in markdown fences.
- If a file is JSON, its content must itself be valid JSON text.
- If a template is selected, preserve its foundation and follow its structure. Do not rewrite protected files.
- For UI/frontend files, implement the preview contract in framework-native code. Preserve its layout intent, copy, color system, visual hierarchy, and states unless the manifest says otherwise.
- If the selected template is frontend-only or the intent says no backend is required, do not call /api routes or assume a local backend. Call browser-safe public APIs directly from frontend service modules.
- For frontend files without Tailwind configured, do not use utility class names like flex, grid, px-4, text-white, rounded-xl, md:grid-cols-4, or bg-sky-500. Use semantic class names and define them in the generated CSS.
- If generating JSX and CSS together, ensure every visual class used in JSX exists in the CSS file.
- Apply these guardrails:
${GENERATION_GUARDRAILS}

Intent:
${intent}

Selected template:
${describeTemplate(template)}

Preview contract:
${describePreviewContract(previewContext)}

Manifest:
${JSON.stringify(manifest, null, 2)}

Execution group:
${JSON.stringify(group, null, 2)}

Plan nodes for this group:
${JSON.stringify(group.files.map((filePath) => nodeByFile.get(filePath)), null, 2)}

Full plan summary:
${JSON.stringify(plan.nodes.map(({ filePath, layer, purpose, dependsOn }) => ({ filePath, layer, purpose, dependsOn })), null, 2)}

External dependency file contents:
${JSON.stringify(dependencies, null, 2)}

Previous verification feedback:
${previousError || "none"}`
  });

  if (!Array.isArray(result.files)) {
    throw new Error(`Batch ${group.id} did not return a files array.`);
  }

  const expected = new Set(group.files);
  const seen = new Set();
  for (const file of result.files) {
    if (!expected.has(file.filePath)) {
      throw new Error(`Batch ${group.id} returned unexpected file ${file.filePath}`);
    }
    if (seen.has(file.filePath)) {
      throw new Error(`Batch ${group.id} returned duplicate file ${file.filePath}`);
    }
    if (typeof file.content !== "string") {
      throw new Error(`Batch ${group.id} returned non-string content for ${file.filePath}`);
    }
    seen.add(file.filePath);
  }

  for (const filePath of expected) {
    if (!seen.has(filePath)) {
      throw new Error(`Batch ${group.id} did not return ${filePath}`);
    }
  }

  return result.files;
}

async function generateGroup({ group, manifest, plan, intent, outDir, model, template, previewContext }) {
  if (group.strategy === "batch" && group.files.length > 1) {
    try {
      console.log(`  generating group ${group.id} as batch (${group.files.length} files)`);
      const files = await generateBatch({ group, manifest, plan, intent, outDir, model, template, previewContext });
      for (const file of files) {
        await writeGeneratedFile(outDir, file.filePath, file.content);
        console.log(`    wrote ${file.filePath}`);
      }
      return;
    } catch (error) {
      console.log(`  batch ${group.id} failed, falling back to per-file generation: ${error.message}`);
    }
  }

  const nodeByFile = new Map(plan.nodes.map((node) => [node.filePath, node]));
  for (const filePath of group.files) {
    const node = nodeByFile.get(filePath);
    const content = await generateFileWithRetries({ node, manifest, plan, intent, outDir, model, template, previewContext });
    await writeGeneratedFile(outDir, node.filePath, content);
    console.log(`  wrote ${node.filePath}`);
  }
}

async function reviewProject({ projectDir, model, install, verification }) {
  const initiativeDir = path.join(projectDir, ".initiative");
  const manifestPath = path.join(initiativeDir, "manifest.json");
  const planPath = path.join(initiativeDir, "plan.json");
  const manifest = existsSync(manifestPath) ? await readJson(manifestPath) : null;
  const plan = existsSync(planPath) ? await readJson(planPath) : null;
  const currentVerification = verification || await verifyProject({ projectDir, install });
  const files = await collectReviewFiles(projectDir, plan);

  if (files.length === 0) {
    return {
      ok: currentVerification.ok,
      changedFiles: [],
      review: { summary: "No reviewable source files were found.", changes: [] },
      verification: currentVerification
    };
  }

  const review = await callGemini({
    model,
    temperature: 0.1,
    system: "You are a strict code review and repair agent. Return only valid JSON. Do not include markdown.",
    prompt: `Review this generated project and produce minimal file replacements plus generation feedback that can guide the next repair pass.

Return JSON:
{
  "summary": "short review summary",
  "failureAnalysis": {
    "category": "missing_export|bad_import|type_mismatch|missing_dependency|test_failure|runtime_failure|other",
    "rootCause": "short explanation",
    "targetFiles": ["relative/path/to/file"]
  },
  "generationFeedback": "specific instructions for the next file generation pass if the direct review patch does not fully fix the project",
  "changes": [
    {
      "filePath": "relative/path/to/file",
      "reason": "why this file must change",
      "content": "complete replacement file content"
    }
  ],
  "notes": ["optional notes"]
}

Rules:
- Prefer the smallest coherent change set.
- Do not rewrite unrelated files.
- Do not change manifest.json or plan.json.
- Do not invent a new architecture; repair consistency between existing files.
- For frontend CSS validation failures, either add complete CSS definitions for the JSX class names or change JSX to use classes that already exist. Prefer preserving the preview design and adding missing semantic CSS.
- Every changed filePath must already exist in the project files below unless the verification error clearly requires a missing file.
- Content must be complete replacement file content, not a diff.
- Always provide generationFeedback, even if changes is empty.
- If no direct patch is safe, return an empty changes array and use generationFeedback plus failureAnalysis.targetFiles to guide regeneration.
- Apply these guardrails:
${GENERATION_GUARDRAILS}

Manifest:
${manifest ? JSON.stringify(manifest, null, 2) : "not found"}

Plan:
${plan ? JSON.stringify(plan, null, 2) : "not found"}

Verification output:
${currentVerification.output || "none"}

Project files:
${JSON.stringify(files, null, 2)}`
  });

  const changedFiles = [];
  for (const change of review.changes || []) {
    if (!change?.filePath || typeof change.content !== "string") {
      throw new Error(`Invalid review change: ${JSON.stringify(change)}`);
    }
    if (change.filePath.startsWith(".initiative/")) {
      throw new Error(`Review agent attempted to modify internal artifact: ${change.filePath}`);
    }
    await writeGeneratedFile(projectDir, change.filePath, change.content);
    changedFiles.push(change.filePath);
  }

  const nextVerification = changedFiles.length > 0
    ? await verifyProject({ projectDir, install: false })
    : currentVerification;

  const result = {
    ok: nextVerification.ok,
    changedFiles,
    review,
    verification: nextVerification
  };
  await mkdir(initiativeDir, { recursive: true });
  await writeJson(path.join(initiativeDir, "review.json"), result);
  await writeJson(path.join(initiativeDir, "verification.json"), nextVerification);
  return result;
}

function buildGenerationFeedback({ review, verification }) {
  if (!review) {
    return verification.output;
  }

  return [
    "Review agent feedback:",
    review.review?.summary ? `Summary: ${review.review.summary}` : null,
    review.review?.failureAnalysis ? `Failure analysis: ${JSON.stringify(review.review.failureAnalysis, null, 2)}` : null,
    review.review?.generationFeedback ? `Generation instructions: ${review.review.generationFeedback}` : null,
    "Latest verification output:",
    verification.output
  ].filter(Boolean).join("\n\n");
}

function pickRepairNode(plan, output, review) {
  const targetFiles = review?.review?.failureAnalysis?.targetFiles || [];
  for (const filePath of targetFiles) {
    const match = plan.nodes.find((node) => node.filePath === filePath);
    if (match) {
      return match;
    }
  }
  return pickLikelyBrokenNode(plan, output);
}

async function collectReviewFiles(projectDir, plan) {
  const plannedPaths = Array.isArray(plan?.nodes)
    ? plan.nodes.map((node) => node.filePath).filter(Boolean)
    : [];
  const discoveredPaths = plannedPaths.length > 0
    ? plannedPaths
    : await walkProjectFiles(projectDir);
  const uniquePaths = [...new Set(discoveredPaths)]
    .filter((filePath) => isReviewablePath(filePath))
    .sort();

  const files = [];
  let totalChars = 0;
  const maxChars = 180000;
  for (const filePath of uniquePaths) {
    const fullPath = path.join(projectDir, filePath);
    if (!existsSync(fullPath)) {
      continue;
    }
    const content = await readFile(fullPath, "utf8").catch(() => null);
    if (content === null) {
      continue;
    }
    totalChars += content.length;
    if (totalChars > maxChars) {
      files.push({
        filePath,
        content: content.slice(0, Math.max(0, content.length - (totalChars - maxChars))),
        truncated: true
      });
      break;
    }
    files.push({ filePath, content });
  }
  return files;
}

async function walkProjectFiles(projectDir, dir = "") {
  const entries = await readdir(path.join(projectDir, dir), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relPath = path.posix.join(dir.split(path.sep).join(path.posix.sep), entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".git", "dist", "build", "coverage", ".initiative"].includes(entry.name)) {
        continue;
      }
      files.push(...await walkProjectFiles(projectDir, relPath));
    } else {
      files.push(relPath);
    }
  }
  return files;
}

function isReviewablePath(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  if (normalized.startsWith(".initiative/")) {
    return false;
  }
  if (/(^|\/)(node_modules|dist|build|coverage)\//.test(normalized)) {
    return false;
  }
  return /\.(ts|tsx|js|jsx|mjs|cjs|json|md|yml|yaml|toml|env\.example)$/.test(normalized)
    || ["Dockerfile", ".gitignore"].includes(path.basename(normalized));
}

async function writeGeneratedFile(outDir, filePath, content) {
  const fullPath = path.resolve(outDir, filePath);
  const root = path.resolve(outDir);
  if (!fullPath.startsWith(`${root}${path.sep}`) && fullPath !== root) {
    throw new Error(`Refusing to write outside output directory: ${filePath}`);
  }
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, normalizeContent(content), "utf8");
}

function normalizeContent(content) {
  return content.endsWith("\n") ? content : `${content}\n`;
}

async function prepareOutputDir(outDir, force) {
  const resolved = path.resolve(outDir);
  if (existsSync(resolved)) {
    const info = await stat(resolved);
    if (!info.isDirectory()) {
      throw new Error(`Output path exists and is not a directory: ${resolved}`);
    }
    if (!force) {
      throw new Error(`Output directory already exists: ${resolved}. Use --force to clear it first.`);
    }
    await rm(resolved, { recursive: true, force: true });
  }
  await mkdir(resolved, { recursive: true });
  await mkdir(path.join(resolved, ".initiative"), { recursive: true });
}

function groupByLayer(nodes) {
  const groups = new Map();
  for (const node of nodes) {
    if (!groups.has(node.layer)) {
      groups.set(node.layer, []);
    }
    groups.get(node.layer).push(node);
  }
  return [...groups.entries()].sort(([a], [b]) => a - b);
}

function groupExecutionGroupsByLayer(groupsToRun) {
  const groups = new Map();
  for (const group of groupsToRun) {
    if (!groups.has(group.layer)) {
      groups.set(group.layer, []);
    }
    groups.get(group.layer).push(group);
  }
  return [...groups.entries()]
    .map(([layer, layerGroups]) => [layer, layerGroups.sort((a, b) => a.id.localeCompare(b.id))])
    .sort(([a], [b]) => a - b);
}

function orderGroupsForExecution(layerGroups, completedGroups) {
  const pending = [...layerGroups].sort((a, b) => a.id.localeCompare(b.id));
  const ordered = [];
  const available = new Set(completedGroups);

  while (pending.length > 0) {
    const index = pending.findIndex((group) => (group.dependsOnGroups || []).every((dep) => available.has(dep)));
    if (index === -1) {
      ordered.push(...pending);
      break;
    }
    const [group] = pending.splice(index, 1);
    ordered.push(group);
    available.add(group.id);
  }

  return ordered;
}

async function generateProject(args) {
  const model = args.model || DEFAULT_MODEL;
  const retries = Math.min(Number(args.retries || 3), 3);
  const intent = await readTextOrFile(requireArg(args, "intent"));
  const outDir = path.resolve(requireArg(args, "out"));
  const template = await loadTemplate(args.template);

  await prepareOutputDir(outDir, Boolean(args.force));
  await applyTemplate(template, outDir);

  let previewContext = null;
  if (!args["skip-preview"]) {
    console.log("Generating intent preview...");
    previewContext = await createProjectPreview({ intent, model, outDir });
    console.log(`Preview link: ${previewContext.url}`);
  }

  console.log(`Generating manifest with ${model}...`);
  const manifest = await generateManifest({ intent, model, template, previewContext });
  await writeJson(path.join(outDir, ".initiative", "manifest.json"), manifest);

  console.log("Planning file DAG...");
  const plan = await generateValidatedPlan({ manifest, intent, model, template, previewContext, outDir });
  await writeJson(path.join(outDir, ".initiative", "plan.json"), plan);

  console.log("Planning execution groups...");
  const executionPlan = await generateValidatedExecutionPlan({ manifest, plan, intent, model, template, previewContext });
  await writeJson(path.join(outDir, ".initiative", "execution-plan.json"), executionPlan);

  const completedGroups = new Set();
  for (const [layer, groups] of groupExecutionGroupsByLayer(executionPlan.groups)) {
    const failures = [];
    const fileCount = groups.reduce((sum, group) => sum + group.files.length, 0);
    console.log(`Generating layer ${layer} (${groups.length} group${groups.length === 1 ? "" : "s"}, ${fileCount} file${fileCount === 1 ? "" : "s"})...`);
    for (const group of orderGroupsForExecution(groups, completedGroups)) {
      try {
        await generateGroup({ group, manifest, plan, intent, outDir, model, template, previewContext });
        completedGroups.add(group.id);
      } catch (error) {
        failures.push({ group, error: error.message });
      }
    }
    if (failures.length > 0) {
      throw new Error(`Generation failed in layer ${layer}: ${failures.map((failure) => `${failure.group.id}: ${failure.error}`).join("; ")}`);
    }
  }

  console.log("Running verification...");
  let verification = await verifyProject({ projectDir: outDir, install: Boolean(args.install) });
  await writeJson(path.join(outDir, ".initiative", "verification.json"), verification);

  for (let attempt = 1; !verification.ok && attempt <= retries; attempt += 1) {
    let review = null;
    if (!args["skip-review"]) {
      console.log(`Verification failed. Running review agent (attempt ${attempt}/${retries})...`);
      review = await reviewProject({
        projectDir: outDir,
        model,
        install: false,
        verification
      });
      verification = review.verification;
      if (review.changedFiles.length > 0) {
        console.log(`  review changed ${review.changedFiles.join(", ")}`);
      } else {
        console.log("  review made no file changes");
      }
      if (verification.ok) {
        break;
      }
    }

    const target = pickRepairNode(plan, verification.output, review);
    if (!target) {
      break;
    }
    console.log(`Verification failed. Regenerating ${target.filePath} (attempt ${attempt}/${retries})...`);
    const content = await generateFileWithRetries({
      node: target,
      manifest,
      plan,
      intent,
      outDir,
      model,
      template,
      previousError: buildGenerationFeedback({ review, verification })
    });
    await writeGeneratedFile(outDir, target.filePath, content);
    verification = await verifyProject({ projectDir: outDir, install: false });
    await writeJson(path.join(outDir, ".initiative", "verification.json"), verification);
  }

  if (!verification.ok) {
    console.log("Generation completed, but verification is still failing.");
    console.log(verification.output.slice(-4000));
    process.exitCode = 2;
    return;
  }

  console.log(`Done. Project generated at ${outDir}`);
}

function pickLikelyBrokenNode(plan, output) {
  const normalized = output.replaceAll("\\", "/");
  return plan.nodes.find((node) => normalized.includes(node.filePath))
    || [...plan.nodes].reverse().find((node) => normalized.includes(path.basename(node.filePath)))
    || null;
}

async function verifyProject({ projectDir, install }) {
  const packageJsonPath = path.join(projectDir, "package.json");
  if (!existsSync(packageJsonPath)) {
    return { ok: true, commands: [], output: "No package.json found; verification skipped." };
  }

  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const packageManager = detectPackageManager(projectDir, packageJson.packageManager);
  const commands = [];
  const hasNodeModules = existsSync(path.join(projectDir, "node_modules"));

  if (install) {
    commands.push(packageManager === "pnpm" ? ["pnpm", ["install"]] : ["npm", ["install"]]);
  } else if (!hasNodeModules) {
    return {
      ok: true,
      commands: [],
      output: "Dependencies are not installed; verification skipped. Re-run verify or generate with --install to run build/test commands."
    };
  }

  if (packageJson.scripts?.build) {
    commands.push(packageManager === "pnpm" ? ["pnpm", ["run", "build"]] : ["npm", ["run", "build"]]);
  } else if (existsSync(path.join(projectDir, "tsconfig.json"))) {
    commands.push(["npx", ["tsc", "--noEmit"]]);
  }

  if (packageJson.scripts?.test) {
    commands.push(packageManager === "pnpm" ? ["pnpm", ["test"]] : ["npm", ["test"]]);
  }

  if (commands.length === 0) {
    return { ok: true, commands: [], output: "No verification commands discovered." };
  }

  let combined = "";
  for (const [cmd, cmdArgs] of commands) {
    const label = `${cmd} ${cmdArgs.join(" ")}`;
    const result = await runCommand(cmd, cmdArgs, projectDir);
    combined += `\n$ ${label}\n${result.output}\n`;
    if (result.code !== 0) {
      return { ok: false, commands: commands.map(([name, args]) => `${name} ${args.join(" ")}`), output: combined };
    }
  }

  const startValidation = await validateStartScriptTarget(projectDir, packageJson);
  combined += `\n$ validate start script\n${startValidation.output}\n`;
  if (!startValidation.ok) {
    return {
      ok: false,
      commands: [...commands.map(([name, args]) => `${name} ${args.join(" ")}`), "validate start script"],
      output: combined
    };
  }

  const frontendStyleValidation = await validateFrontendStyles(projectDir, packageJson);
  combined += `\n$ validate frontend styles\n${frontendStyleValidation.output}\n`;
  if (!frontendStyleValidation.ok) {
    return {
      ok: false,
      commands: [...commands.map(([name, args]) => `${name} ${args.join(" ")}`), "validate frontend styles"],
      output: combined
    };
  }

  return { ok: true, commands: commands.map(([name, args]) => `${name} ${args.join(" ")}`), output: combined };
}

async function validateFrontendStyles(projectDir, packageJson) {
  const srcDir = path.join(projectDir, "src");
  if (!existsSync(srcDir)) {
    return { ok: true, output: "No src directory found; frontend style validation skipped." };
  }

  const allFiles = await walkProjectFiles(projectDir);
  const componentFiles = allFiles.filter((filePath) => /\.(tsx|jsx)$/.test(filePath));
  if (componentFiles.length === 0) {
    return { ok: true, output: "No JSX/TSX files found; frontend style validation skipped." };
  }

  const cssFiles = allFiles.filter((filePath) => filePath.startsWith("src/") && /\.css$/.test(filePath));
  if (cssFiles.length === 0) {
    return {
      ok: false,
      output: "Frontend JSX/TSX files exist, but no src/*.css stylesheet was generated. Generate and import a global stylesheet."
    };
  }

  const hasTailwindDependency = Boolean(packageJson.dependencies?.tailwindcss || packageJson.devDependencies?.tailwindcss);
  const hasTailwindConfig = existsSync(path.join(projectDir, "tailwind.config.js"))
    || existsSync(path.join(projectDir, "tailwind.config.ts"));
  const hasTailwind = hasTailwindDependency && hasTailwindConfig;

  const cssContents = [];
  for (const filePath of cssFiles) {
    cssContents.push(await readFile(path.join(projectDir, filePath), "utf8"));
  }
  if (!hasTailwind && cssContents.some((content) => /@tailwind\s+(base|components|utilities)/.test(content))) {
    return {
      ok: false,
      output: "CSS uses Tailwind directives, but Tailwind is not fully configured with both dependency and local tailwind.config. Generate plain CSS or add complete Tailwind setup."
    };
  }
  const definedClasses = extractCssClassNames(cssContents.join("\n"));
  const usedClassMap = new Map();
  const cssImports = [];

  for (const filePath of componentFiles) {
    const content = await readFile(path.join(projectDir, filePath), "utf8");
    for (const importPath of extractCssImports(content)) {
      cssImports.push({ filePath, importPath });
    }
    for (const className of extractJsxClassNames(content)) {
      if (!usedClassMap.has(className)) {
        usedClassMap.set(className, new Set());
      }
      usedClassMap.get(className).add(filePath);
    }
  }

  if (cssImports.length === 0) {
    return {
      ok: false,
      output: "A stylesheet exists, but no JSX/TSX entry or root component imports CSS. Import the global stylesheet from src/main.tsx or src/App.tsx."
    };
  }

  if (hasTailwind) {
    return { ok: true, output: "Tailwind is configured; class coverage validation skipped." };
  }

  const usedClasses = [...usedClassMap.keys()].filter((className) => !isIgnoredClassToken(className));
  const undefinedClasses = usedClasses.filter((className) => !definedClasses.has(cssClassSelectorName(className)));
  const utilityLikeClasses = undefinedClasses.filter(isLikelyUtilityClass);

  if (undefinedClasses.length > 8 || utilityLikeClasses.length > 4) {
    const examples = undefinedClasses.slice(0, 30).map((className) => {
      const files = [...usedClassMap.get(className)].slice(0, 3).join(", ");
      return `- ${className} (${files})`;
    }).join("\n");
    return {
      ok: false,
      output: [
        "Frontend CSS validation failed.",
        "The project does not configure Tailwind, but JSX uses many classes that are not defined in generated CSS.",
        "Generate semantic CSS classes and keep JSX className values synchronized with src/*.css.",
        "Undefined class examples:",
        examples
      ].join("\n")
    };
  }

  return {
    ok: true,
    output: `Found ${cssFiles.length} stylesheet(s), ${cssImports.length} CSS import(s), and ${undefinedClasses.length} undefined JSX class token(s).`
  };
}

function extractCssImports(content) {
  return [...content.matchAll(/import\s+["']([^"']+\.css)["'];?/g)].map((match) => match[1]);
}

function extractCssClassNames(content) {
  const classNames = new Set();
  for (const match of content.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
    classNames.add(match[1]);
  }
  return classNames;
}

function extractJsxClassNames(content) {
  const classes = [];
  const patterns = [
    /className\s*=\s*"([^"]*)"/g,
    /className\s*=\s*'([^']*)'/g,
    /className\s*=\s*{\s*`([\s\S]*?)`\s*}/g,
    /className\s*=\s*{\s*"([^"]*)"\s*}/g,
    /className\s*=\s*{\s*'([^']*)'\s*}/g
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      classes.push(...splitClassTokens(match[1].replace(/\$\{[\s\S]*?\}/g, " ")));
    }
  }

  for (const match of content.matchAll(/className\s*=\s*{([^}]+)}/g)) {
    const expression = match[1];
    if (expression.trim().startsWith("`")) {
      continue;
    }
    for (const literal of expression.matchAll(/["'`]([^"'`]+)["'`]/g)) {
      classes.push(...splitClassTokens(literal[1]));
    }
  }

  return [...new Set(classes)];
}

function splitClassTokens(value) {
  return value
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !/[${};()]/.test(token))
    .filter(isClassTokenCandidate);
}

function isClassTokenCandidate(token) {
  if (token.length < 2) {
    return false;
  }
  if (["==", "===", "!=", "!==", "?", ":", "&&", "||", "=>"].includes(token)) {
    return false;
  }
  return /^-?[_a-zA-Z][\w:-]*$/.test(token);
}

function cssClassSelectorName(className) {
  return className.replace(/\\/g, "").split(":").pop();
}

function isIgnoredClassToken(className) {
  return className.startsWith("http")
    || className.includes("/")
    || className.includes("[")
    || className.includes("]");
}

function isLikelyUtilityClass(className) {
  const base = cssClassSelectorName(className);
  return /^(absolute|relative|fixed|sticky|block|inline|flex|grid|hidden|items-|justify-|content-|self-|gap-|space-[xy]-|w-|h-|min-h-|max-w-|max-h-|p[trblxy]?-\d|m[trblxy]?-\d|text-|font-|tracking-|leading-|bg-|from-|via-|to-|border|border-|rounded|rounded-|shadow|opacity-|transition|duration-|ease-|hover:|focus:|disabled:|sm:|md:|lg:|xl:|z-|top-|right-|bottom-|left-|inset-|overflow-|object-|animate-)/.test(base)
    || ["flex", "grid", "hidden", "relative", "absolute", "block", "inline-block", "text-left", "text-right", "mx-auto", "w-full"].includes(base);
}

async function validateStartScriptTarget(projectDir, packageJson) {
  const startScript = packageJson.scripts?.start;
  if (!startScript) {
    return { ok: true, output: "No start script found; runtime entrypoint validation skipped." };
  }

  const target = parseNodeStartTarget(startScript);
  if (!target) {
    return { ok: true, output: `Start script is not a simple node file target; validation skipped: ${startScript}` };
  }

  const targetPath = path.resolve(projectDir, target);
  if (existsSync(targetPath)) {
    return { ok: true, output: `Start script target exists: ${target}` };
  }

  const distFiles = existsSync(path.join(projectDir, "dist"))
    ? await walkProjectFiles(path.join(projectDir, "dist"))
    : [];
  const basename = path.basename(target);
  const likelyMatches = distFiles
    .filter((filePath) => path.basename(filePath) === basename)
    .map((filePath) => path.posix.join("dist", filePath));

  const hint = likelyMatches.length > 0
    ? `\nLikely emitted entr${likelyMatches.length === 1 ? "y" : "ies"}: ${likelyMatches.join(", ")}`
    : "";

  return {
    ok: false,
    output: `Start script points to missing file: ${target}${hint}\nFix package.json scripts.start or tsconfig rootDir/outDir so the start target exists after build.`
  };
}

function parseNodeStartTarget(startScript) {
  const parts = startScript.trim().split(/\s+/);
  const nodeIndex = parts.findIndex((part) => part === "node" || part.endsWith("/node"));
  if (nodeIndex === -1) {
    return null;
  }

  for (let index = nodeIndex + 1; index < parts.length; index += 1) {
    const part = parts[index];
    if (part.startsWith("-")) {
      continue;
    }
    if (part.endsWith(".js") || part.endsWith(".mjs") || part.endsWith(".cjs")) {
      return part;
    }
    return null;
  }

  return null;
}

function detectPackageManager(projectDir, packageManager) {
  if (packageManager?.startsWith("pnpm") || existsSync(path.join(projectDir, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  return "npm";
}

function runCommand(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      env: process.env
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({ code: 127, output: error.message });
    });
    child.on("close", (code) => {
      resolve({ code, output });
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.command || args.help || args.command === "help") {
    console.log(usage());
    return;
  }

  const model = args.model || DEFAULT_MODEL;

  if (args.command === "template") {
    const subcommand = args._[0];
    if (subcommand === "list") {
      await listTemplates();
      return;
    }
    if (subcommand === "sync") {
      const templateId = args._[1];
      if (!templateId) {
        throw new Error("Missing template id. Usage: initiative-codegen template sync <id> [--force]");
      }
      await syncTemplate(templateId, Boolean(args.force));
      return;
    }
    throw new Error(`Unknown template command: ${subcommand || ""}\n\n${usage()}`);
  }

  if (args.command === "preview") {
    await createPreview(args);
    return;
  }

  if (args.command === "manifest") {
    const intent = await readTextOrFile(requireArg(args, "intent"));
    const template = await loadTemplate(args.template);
    const manifest = await generateManifest({ intent, model, template });
    await writeJson(requireArg(args, "out"), manifest);
    console.log(`Wrote manifest to ${path.resolve(args.out)}`);
    return;
  }

  if (args.command === "plan") {
    const manifest = await readJson(requireArg(args, "manifest"));
    const intent = args.intent ? await readTextOrFile(args.intent) : "Use the supplied manifest as source of truth.";
    const template = await loadTemplate(args.template);
    const plan = await generateValidatedPlan({ manifest, intent, model, template, outDir: path.dirname(path.resolve(args.out)) });
    await writeJson(requireArg(args, "out"), plan);
    console.log(`Wrote plan to ${path.resolve(args.out)}`);
    return;
  }

  if (args.command === "generate") {
    await generateProject(args);
    return;
  }

  if (args.command === "verify") {
    const verification = await verifyProject({
      projectDir: path.resolve(requireArg(args, "project")),
      install: Boolean(args.install)
    });
    console.log(verification.output.trim());
    if (!verification.ok) {
      process.exitCode = 2;
    }
    return;
  }

  if (args.command === "review") {
    const projectDir = path.resolve(requireArg(args, "project"));
    const verification = await verifyProject({
      projectDir,
      install: Boolean(args.install)
    });
    const review = await reviewProject({
      projectDir,
      model,
      install: false,
      verification
    });
    console.log(review.review.summary || "Review complete.");
    if (review.changedFiles.length > 0) {
      console.log(`Changed files: ${review.changedFiles.join(", ")}`);
    } else {
      console.log("Changed files: none");
    }
    console.log(review.verification.output.trim());
    if (!review.ok) {
      process.exitCode = 2;
    }
    return;
  }

  throw new Error(`Unknown command: ${args.command}\n\n${usage()}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
