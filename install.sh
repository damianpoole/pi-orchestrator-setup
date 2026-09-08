#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="${PI_AGENT_DIR:-${HOME}/.pi/agent}"
SETTINGS="${AGENT_DIR}/settings.json"
AGENTS_FILE="${AGENT_DIR}/AGENTS.md"
INSTALL_DIR="${AGENT_DIR}/agents/pi-orchestrator"
MARKER_START='<!-- pi-orchestrator-setup:start -->'
MARKER_END='<!-- pi-orchestrator-setup:end -->'

usage() {
  printf 'Usage: %s [--dry-run] [--uninstall]\n' "$0"
}
DRY_RUN=0
UNINSTALL=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --uninstall) UNINSTALL=1 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$arg" >&2; usage >&2; exit 2 ;;
  esac
done

run() {
  if (( DRY_RUN )); then printf '+ %q' "$@"; printf '\n'; else "$@"; fi
}

if ! command -v node >/dev/null 2>&1; then
  printf 'Node.js is required. Install Node 24 (mise is recommended).\n' >&2
  exit 1
fi
node_major="$(node -p 'process.versions.node.split(".")[0]')"
if (( node_major < 22 )); then
  printf 'Node.js 22+ is required (found %s).\n' "$(node --version)" >&2
  exit 1
fi

if [[ "$UNINSTALL" -eq 0 ]]; then
  if ! command -v pi >/dev/null 2>&1; then
    printf 'pi is required and must be on PATH.\n' >&2
    exit 1
  fi
  run pi install npm:pi-subagents
fi

if (( DRY_RUN )); then
  printf '+ install configuration in %s\n' "$AGENT_DIR"
  exit 0
fi

mkdir -p "$AGENT_DIR" "$AGENT_DIR/agents"

node - "$SETTINGS" "$ROOT_DIR/config/settings.json" "$UNINSTALL" <<'NODE'
const fs = require('node:fs');
const path = process.argv[2];
const sourcePath = process.argv[3];
const uninstall = process.argv[4] === '1';
const managed = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
let settings = {};
if (fs.existsSync(path)) {
  const raw = fs.readFileSync(path, 'utf8').trim();
  if (raw) settings = JSON.parse(raw);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const roles = managed.subagents.agentOverrides;
if (!uninstall) {
  settings.defaultProvider = managed.defaultProvider;
  settings.defaultModel = managed.defaultModel;
  settings.defaultThinkingLevel = managed.defaultThinkingLevel;
  settings.subagents ??= {};
  settings.subagents.agentOverrides ??= {};
  for (const [name, value] of Object.entries(roles)) settings.subagents.agentOverrides[name] = value;
  settings.subagents.modelScope = managed.subagents.modelScope;
  settings.subagents.maxSubagentDepth = managed.subagents.maxSubagentDepth;
  settings.subagents.globalConcurrencyLimit = managed.subagents.globalConcurrencyLimit;
  settings.subagents.maxSubagentSpawnsPerRun = managed.subagents.maxSubagentSpawnsPerRun;
  settings.packages = Array.isArray(settings.packages) ? settings.packages : [];
  if (!settings.packages.includes('npm:pi-subagents')) settings.packages.push('npm:pi-subagents');
} else {
  for (const [key, value] of Object.entries({
    defaultProvider: managed.defaultProvider,
    defaultModel: managed.defaultModel,
    defaultThinkingLevel: managed.defaultThinkingLevel,
  })) if (same(settings[key], value)) delete settings[key];
  if (settings.subagents && typeof settings.subagents === 'object') {
    if (settings.subagents.agentOverrides) {
      for (const [name, value] of Object.entries(roles)) {
        if (same(settings.subagents.agentOverrides[name], value)) delete settings.subagents.agentOverrides[name];
      }
      if (!Object.keys(settings.subagents.agentOverrides).length) delete settings.subagents.agentOverrides;
    }
    for (const [key, value] of Object.entries({
      modelScope: managed.subagents.modelScope,
      maxSubagentDepth: managed.subagents.maxSubagentDepth,
      globalConcurrencyLimit: managed.subagents.globalConcurrencyLimit,
      maxSubagentSpawnsPerRun: managed.subagents.maxSubagentSpawnsPerRun,
    })) if (same(settings.subagents[key], value)) delete settings.subagents[key];
    if (!Object.keys(settings.subagents).length) delete settings.subagents;
  }
  if (Array.isArray(settings.packages)) {
    settings.packages = settings.packages.filter((entry) => entry !== 'npm:pi-subagents');
    if (!settings.packages.length) delete settings.packages;
  }
}
fs.mkdirSync(require('node:path').dirname(path), { recursive: true });
fs.writeFileSync(path, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
NODE

if [[ "$UNINSTALL" -eq 0 ]]; then
  rm -rf "$INSTALL_DIR"
  mkdir -p "$INSTALL_DIR"
  cp "$ROOT_DIR/agents/"*.md "$INSTALL_DIR/"
  node - "$AGENTS_FILE" "$ROOT_DIR/config/orchestrator-agents.md" <<'NODE'
const fs = require('node:fs');
const target = process.argv[2];
const snippet = fs.readFileSync(process.argv[3], 'utf8').trim();
let text = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
const start = '<!-- pi-orchestrator-setup:start -->';
const end = '<!-- pi-orchestrator-setup:end -->';
const re = new RegExp(`${start}[\\s\\S]*?${end}\\n?`, 'm');
text = re.test(text) ? text.replace(re, snippet + '\n') : (text.trimEnd() + (text.trim() ? '\n\n' : '') + snippet + '\n');
fs.mkdirSync(require('node:path').dirname(target), { recursive: true });
fs.writeFileSync(target, text, { mode: 0o600 });
NODE
else
  rm -rf "$INSTALL_DIR"
  node - "$AGENTS_FILE" <<'NODE'
const fs = require('node:fs');
const target = process.argv[2];
if (!fs.existsSync(target)) process.exit(0);
const start = '<!-- pi-orchestrator-setup:start -->';
const end = '<!-- pi-orchestrator-setup:end -->';
const re = new RegExp(`\\n?${start}[\\s\\S]*?${end}\\n?`, 'm');
const text = fs.readFileSync(target, 'utf8').replace(re, '\n').replace(/\n{3,}/g, '\n\n').trimEnd();
fs.writeFileSync(target, text ? text + '\n' : '', { mode: 0o600 });
NODE
fi

if [[ "$UNINSTALL" -eq 1 ]]; then
  printf 'Pi orchestrator setup removed.\n'
else
  printf 'Pi orchestrator setup installed. Restart Pi or run /reload.\n'
fi
