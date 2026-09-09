# Pi Orchestrator Setup

Portable configuration for using provider-qualified `gpt-6-astra` as the primary Pi orchestrator and delegating work to model-specific subagents.

## Routing

Each provider profile uses the same three model IDs, qualified for that provider, across the four roles:

| Complexity | OpenAI Codex | GitHub Copilot | Thinking |
|---|---|---|---|
| easy | `openai-codex/gpt-5.6-luna` | `github-copilot/gpt-5.6-luna` | medium |
| medium | `openai-codex/gpt-5.6-luna` | `github-copilot/gpt-5.6-luna` | high |
| hard | `openai-codex/gpt-5.6-sol` | `github-copilot/gpt-5.6-sol` | medium |
| very-hard | `openai-codex/gpt-6-astra` | `github-copilot/gpt-6-astra` | low |

## Install

Prerequisites are Node.js 22 or newer (Node 24 is recommended) and the **npm installation of Pi 0.85.1**. The installer checks the actual executable’s package metadata before changing configuration. Auto-updating wrappers and standalone binaries are rejected; background subagents need Pi’s npm package directory. Runtime requirements are recorded in `config/runtime.json`.

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.85.1
# Use the actual npm executable if a wrapper or shim shadows pi:
export PI_BINARY="$(npm prefix -g)/bin/pi"
```

Choose the provider profile for the machine:

- Work Mac with GitHub Copilot:

  ```bash
  ./install.sh --provider github-copilot
  ```

- Omarchy with OpenAI Codex:

  ```bash
  ./install.sh --provider openai-codex
  ```

OpenAI Codex is the default, so `./install.sh` is equivalent to `./install.sh --provider openai-codex`.

The installer is idempotent. It validates the selected profile and prints a plan, writes the selected routing/settings and installer state, installs the exact packages declared by the selected profile, then installs the four shared agent definitions under `~/.pi/agent/agents/pi-orchestrator/` and updates `~/.pi/agent/AGENTS.md` using managed markers. It merges declared settings without replacing unrelated settings, and installs execution limits from `config/subagents.json` into `~/.pi/agent/extensions/subagent/config.json`. Existing version-1 installer state is migrated automatically, including removal of the old misplaced limit settings when unchanged. Configuration and state are written before the package install; the operation is not an atomic rollback. If package installation fails, rerun the selected install or use uninstall to recover.

After installation, restart using the same pinned executable, then run `/login` in Pi and select the provider used for installation. Start Pi with the matching primary model:

```bash
"${PI_BINARY:-pi}" --model openai-codex/gpt-6-astra:low
# or
"${PI_BINARY:-pi}" --model github-copilot/gpt-6-astra:low
```

The GitHub Copilot profile requires the relevant organization and model entitlements. Its registry model IDs are verified, but no live account or macOS verification has been performed here.

To preview an installation without changing files, add `--dry-run`:

```bash
./install.sh --provider github-copilot --dry-run
```

To target a different Pi agent directory, set `PI_AGENT_DIR`; the installer passes that resolved directory to `pi install` through `PI_CODING_AGENT_DIR`:

```bash
PI_AGENT_DIR=/path/to/agent ./install.sh --provider openai-codex
```

Switch providers by rerunning the installer with the other `--provider` value; there is no separate switch command. The model names are intentionally fully qualified to avoid accidentally selecting a similarly named model from another provider.

## Uninstall

```bash
./install.sh --uninstall
```

Without `--provider`, uninstall auto-detects the active provider from installer state (and can fall back to legacy markers/profile matching). It removes this setup's agents, managed package entries, managed settings and extension configuration values, managed AGENTS section, and installer state. Downloaded package caches may remain on disk. State-backed uninstall restores settings previously replaced by this setup only when those managed values are still unchanged; user edits are left intact. Unrelated Pi settings are preserved.

You can pass `--provider openai-codex` or `--provider github-copilot` when needed, but an explicit provider must match the active profile.

## Sharing and updating

The repository is the source of truth. Edit files here, commit and push, then pull on the other laptop and rerun `./install.sh --provider github-copilot` (or `openai-codex`). Always pass the machine’s provider when updating; an omitted provider selects OpenAI Codex. Changes made directly to installed agent files are replaced on reinstall and are not synced back.

- Put shared Pi preferences (such as `theme`, `prompts`, or `skills`) in the provider settings files. Nested objects are merged by leaf; arrays are replaced as a unit. Undeclared settings are preserved. Removing a previously managed setting restores its previous local value if it is still unchanged.
- The `packages` array controls package installation. Use exact npm versions, e.g. `npm:pi-subagents@0.66.0`. Object entries with `source` and Pi resource filters are supported. Duplicate package identities, unversioned packages, Git sources, and local package paths are rejected. Add the package to both profiles if it should be shared by both devices.
- Put subagent execution limits in `config/subagents.json`, not under `subagents` in Pi settings.
- Resource paths in installed settings resolve relative to the destination agent directory, not this checkout. This installer copies `agents/` only; use pinned packages to distribute additional skills, prompts, themes, and extensions, or provision the referenced resources separately on both laptops.
- Keep credentials, sessions, caches, and local trust decisions out of this repository. Log in separately on each device.
- Upgrade deliberately: change package versions in both profiles, update `config/runtime.json` when changing Pi, install that Pi version on both devices, and run the checks below. Direct dependency pins prevent automatic release drift; they do not lock every transitive npm dependency or guarantee identical provider behaviour.

## Validation

```bash
node --test test/install.test.js
```

The tests use isolated directories and a simulated npm Pi executable. They exercise deployment, provider switching, package arguments and filtering, local-value restoration, legacy migration, and runtime rejection without touching your real Pi configuration or calling a model. Live provider entitlements and macOS operation need a separate smoke check; after installation, restart Pi and run `/subagents-doctor`.

## Design notes

Astra performs the classification; `pi-subagents` supplies the execution mechanism. The primary must delegate every substantive implementation task to its matching role, including localized low-risk dependency updates. Conversational requests and read-only checks may stay with the primary; workers are not required to recursively delegate. Astra retains the current model, planning, coordination, verification, synthesis, user communication, and final decision authority. Keep one writer at a time when implementation could touch the same files.

The model scope is strict: each provider profile permits three provider-qualified models across four roles, so accidental per-run model overrides outside this policy are rejected. Change the relevant profile in `config/settings.json` or `config/settings.github-copilot.json` and reinstall if the policy changes.

## Bounded assignments

Keep delegated work practical and bounded:

- For easy and medium work, the primary must decompose broader requests and delegate one focused, bounded step at a time.
- Ask for one concrete outcome, naming the relevant files and working directory.
- State explicit non-goals, proportionate validation, and the concise evidence expected back; inspect that evidence before issuing the next dependent step.
- Do not bundle investigation, implementation, tests, and documentation into a single easy or medium assignment, or relabel a broad task to evade decomposition.
- Workers stop after the assigned step and report discovered follow-ups rather than doing them.
- Reuse established facts. For a small request, avoid a full-repository audit or documentation rabbit hole.
- Stop when acceptance is met; report blockers or unknowns instead of broadening scope. The primary should narrow or stop an overlong investigation rather than leave it running.

For example: “In `/repo`, update `config/orchestrator-agents.md` to require primary delegation for substantive implementation; do not change installer code or other files; run `git diff --check` and report the diff summary and any uncertainty.”

## Sources

- [Pi package documentation](https://pi.dev/docs/latest/packages)
- [pi-subagents](https://pi.dev/packages/pi-subagents)
- [Pi settings](https://pi.dev/docs/latest/settings)
