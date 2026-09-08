# Pi Orchestrator Setup

Portable configuration for using `gpt-6-astra` as the primary Pi orchestrator and delegating work to model-specific subagents.

## Routing

| Complexity | Model | Thinking |
|---|---|---|
| easy | `openai-codex/gpt-5.6-luna` | high |
| medium | `openai-codex/gpt-5.6-luna` | max |
| hard | `openai-codex/gpt-5.6-sol` | medium |
| very-hard | `openai-codex/gpt-6-astra` | low |

## Install

```bash
./install.sh
```

The installer is idempotent. It will:

1. Install/update `pi-subagents` for the current user.
2. Install the four shared agent definitions under `~/.pi/agent/agents/pi-orchestrator/`.
3. Merge the routing and safety settings into `~/.pi/agent/settings.json` without replacing unrelated settings.
4. Add the orchestrator instructions to `~/.pi/agent/AGENTS.md` using managed markers.

Restart Pi or run `/reload` after installation. Start Pi with:

```bash
pi --model openai-codex/gpt-6-astra:low
```

The model names are intentionally fully qualified. This avoids accidentally selecting a similarly named model from another provider.

## Uninstall

```bash
./install.sh --uninstall
```

Uninstall removes this setup's agents, package setting, managed routing block, and managed AGENTS section. It does not remove unrelated Pi configuration.

## Design notes

Astra performs the classification; `pi-subagents` supplies the execution mechanism. The setup does not force delegation for every request. Astra should delegate substantive work, keep final decision authority, and use one writer at a time when multiple agents could edit the same files.

The model scope is strict, so accidental per-run model overrides outside this four-model policy are rejected. Change `config/settings.json` and reinstall if the policy changes.

## Sources

- [Pi package documentation](https://pi.dev/docs/packages)
- [pi-subagents](https://pi.dev/packages/pi-subagents)
- [Pi settings](https://pi.dev/docs/settings)
