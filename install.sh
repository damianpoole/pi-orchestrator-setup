#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="${PI_AGENT_DIR:-${PI_CODING_AGENT_DIR:-${HOME}/.pi/agent}}"
SETTINGS="${AGENT_DIR}/settings.json"
AGENTS_FILE="${AGENT_DIR}/AGENTS.md"
INSTALL_DIR="${AGENT_DIR}/agents/pi-orchestrator"
CONFIG_DIR="${ROOT_DIR}/config"
MARKER_START='<!-- pi-orchestrator-setup:start -->'
MARKER_END='<!-- pi-orchestrator-setup:end -->'

usage() {
  printf 'Usage: %s [--provider openai-codex|github-copilot] [--dry-run] [--uninstall]\n' "$0"
  printf '\n'
  printf 'Install defaults to the openai-codex profile. Uninstall detects the active profile unless --provider is supplied.\n'
}

DRY_RUN=0
UNINSTALL=0
REQUESTED_PROVIDER=""
PROVIDER_SEEN=0
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --provider)
      if [[ "$#" -lt 2 || "$2" == --* ]]; then
        printf '%s\n' '--provider requires a value.' >&2
        usage >&2
        exit 2
      fi
      if (( PROVIDER_SEEN )); then
        printf '%s\n' '--provider may only be specified once.' >&2
        usage >&2
        exit 2
      fi
      REQUESTED_PROVIDER="$2"
      PROVIDER_SEEN=1
      shift 2
      ;;
    --provider=*)
      if [[ -z "${1#*=}" ]]; then
        printf '%s\n' '--provider requires a value.' >&2
        usage >&2
        exit 2
      fi
      if (( PROVIDER_SEEN )); then
        printf '%s\n' '--provider may only be specified once.' >&2
        usage >&2
        exit 2
      fi
      REQUESTED_PROVIDER="${1#*=}"
      PROVIDER_SEEN=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --uninstall)
      UNINSTALL=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "$REQUESTED_PROVIDER" in
  ""|openai-codex|github-copilot) ;;
  *)
    printf 'Invalid provider: %s (choose openai-codex or github-copilot).\n' "$REQUESTED_PROVIDER" >&2
    usage >&2
    exit 2
    ;;
esac

case "$AGENT_DIR" in
  ""|/)
    printf 'Refusing to use an empty or root PI_AGENT_DIR.\n' >&2
    exit 1
    ;;
esac

run() {
  if (( DRY_RUN )); then
    printf '+'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
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
fi

# Validate the selected profile and print a plan before any package/configuration work.
if [[ "$UNINSTALL" -eq 0 ]]; then
  node "$ROOT_DIR/install-config.js" --plan --agent-dir "$AGENT_DIR" --config-dir "$CONFIG_DIR" --provider "${REQUESTED_PROVIDER:-openai-codex}"
else
  if [[ -n "$REQUESTED_PROVIDER" ]]; then
    node "$ROOT_DIR/install-config.js" --plan --agent-dir "$AGENT_DIR" --config-dir "$CONFIG_DIR" --provider "$REQUESTED_PROVIDER" --uninstall
  else
    node "$ROOT_DIR/install-config.js" --plan --agent-dir "$AGENT_DIR" --config-dir "$CONFIG_DIR" --uninstall
  fi
fi

if [[ "$UNINSTALL" -eq 0 && "$DRY_RUN" -eq 0 ]]; then
  # Capture settings/package ownership before pi can update settings.json.
  node "$ROOT_DIR/install-config.js" --apply --quiet --agent-dir "$AGENT_DIR" --config-dir "$CONFIG_DIR" --provider "${REQUESTED_PROVIDER:-openai-codex}"
  run env PI_CODING_AGENT_DIR="$AGENT_DIR" pi install npm:pi-subagents
fi

if (( DRY_RUN )); then
  if [[ "$UNINSTALL" -eq 0 ]]; then
    printf '+ env PI_CODING_AGENT_DIR=%q pi install npm:pi-subagents\n' "$AGENT_DIR"
  fi
  printf 'Dry run: no files will be changed.\n'
  if [[ "$UNINSTALL" -eq 0 ]]; then
    printf '+ write %s\n' "$SETTINGS"
    printf '+ replace %s\n' "$INSTALL_DIR"
    printf '+ update %s between managed markers\n' "$AGENTS_FILE"
  else
    printf '+ remove %s\n' "$INSTALL_DIR"
    printf '+ remove managed settings from %s\n' "$SETTINGS"
    printf '+ remove managed block from %s\n' "$AGENTS_FILE"
  fi
  exit 0
fi

if [[ "$UNINSTALL" -eq 0 ]]; then
  mkdir -p "$AGENT_DIR" "$AGENT_DIR/agents"
  rm -rf "$INSTALL_DIR"
  mkdir -p "$INSTALL_DIR"
  cp "$ROOT_DIR/agents/"*.md "$INSTALL_DIR/"
  node - "$AGENTS_FILE" "$ROOT_DIR/config/orchestrator-agents.md" <<'NODE'
const fs = require('node:fs');
const target = process.argv[2];
const snippet = fs.readFileSync(process.argv[3], 'utf8').trim();
const start = '<!-- pi-orchestrator-setup:start -->';
const end = '<!-- pi-orchestrator-setup:end -->';
const re = new RegExp(`${start}[\\s\\S]*?${end}\\n?`, 'm');
const text = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
const updated = re.test(text)
  ? text.replace(re, snippet + '\n')
  : (text.trimEnd() + (text.trim() ? '\n\n' : '') + snippet + '\n');
fs.mkdirSync(require('node:path').dirname(target), { recursive: true });
fs.writeFileSync(target, updated, { mode: 0o600 });
NODE
else
  # Let the config helper inspect legacy setup files before removing them.
  if [[ -n "$REQUESTED_PROVIDER" ]]; then
    node "$ROOT_DIR/install-config.js" --apply --quiet --agent-dir "$AGENT_DIR" --config-dir "$CONFIG_DIR" --provider "$REQUESTED_PROVIDER" --uninstall
  else
    node "$ROOT_DIR/install-config.js" --apply --quiet --agent-dir "$AGENT_DIR" --config-dir "$CONFIG_DIR" --uninstall
  fi
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
  if [[ -n "$REQUESTED_PROVIDER" ]]; then
    printf 'Pi orchestrator setup removed (%s profile).\n' "$REQUESTED_PROVIDER"
  else
    printf 'Pi orchestrator setup removed (active profile).\n'
  fi
else
  printf 'Pi orchestrator setup installed (%s profile). Restart Pi or run /reload.\n' "${REQUESTED_PROVIDER:-openai-codex}"
fi
