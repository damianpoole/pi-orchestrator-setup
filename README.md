# Pi Orchestrator Setup

Portable configuration for using provider-qualified `gpt-6-astra` as the primary Pi orchestrator and delegating work to model-specific subagents.

## Routing

Each provider profile uses the same three model IDs, qualified for that provider, across the four roles:

| Complexity | OpenAI Codex | GitHub Copilot | Thinking |
|---|---|---|---|
| easy | `openai-codex/gpt-5.6-luna` | `github-copilot/gpt-5.6-luna` | high |
| medium | `openai-codex/gpt-5.6-luna` | `github-copilot/gpt-5.6-luna` | max |
| hard | `openai-codex/gpt-5.6-sol` | `github-copilot/gpt-5.6-sol` | medium |
| very-hard | `openai-codex/gpt-6-astra` | `github-copilot/gpt-6-astra` | low |

## Install

Prerequisites are Node.js 22 or newer (Node 24 is recommended; mise is supported) and `pi` on `PATH` for installation. Choose the provider profile for the machine:

- Work Mac with GitHub Copilot:

  ```bash
  ./install.sh --provider github-copilot
  ```

- Omarchy with OpenAI Codex:

  ```bash
  ./install.sh --provider openai-codex
  ```

OpenAI Codex is the default, so `./install.sh` is equivalent to `./install.sh --provider openai-codex`.

The installer is idempotent. It validates the selected profile and prints a plan, writes the selected routing/settings and installer state, installs or updates `pi-subagents`, then installs the four shared agent definitions under `~/.pi/agent/agents/pi-orchestrator/` and updates `~/.pi/agent/AGENTS.md` using managed markers. It merges settings without replacing unrelated settings. Configuration and state are written before the package install; the operation is not an atomic rollback. If package installation fails, rerun the selected install or use uninstall to recover.

After installation, restart Pi or run `/reload`, then run `/login` in Pi and select the provider used for installation. Start Pi with the matching primary model:

```bash
pi --model openai-codex/gpt-6-astra:low
# or
pi --model github-copilot/gpt-6-astra:low
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

Without `--provider`, uninstall auto-detects the active provider from installer state (and can fall back to legacy markers/profile matching). It removes this setup's agents, package setting, managed routing block, managed AGENTS section, and installer state. State-backed uninstall restores settings previously replaced by this setup only when those managed values are still unchanged; user edits are left intact. Unrelated Pi settings are preserved.

You can pass `--provider openai-codex` or `--provider github-copilot` when needed, but an explicit provider must match the active profile.

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

- [Pi package documentation](https://pi.dev/docs/packages)
- [pi-subagents](https://pi.dev/packages/pi-subagents)
- [Pi settings](https://pi.dev/docs/settings)
