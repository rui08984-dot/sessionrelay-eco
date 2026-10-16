# SessionRelay Ecosystem — a local-first project memory layer

> Your AI coding tools should **already know this project** — its decisions, open questions, and what changed lately —
> before you type a word. Local-first, **zero neural networks**, fully offline-capable.

A deep fork of [SessionRelay](https://github.com/EwanJasper/SessionRelay) (MIT) plus the **integration layer** for two clients:

| Component | Path | Needed by |
|---|---|---|
| Core (capture / extract / search / archive) | [packages/core](packages/core) | everything |
| **DeepSeek Harness plugin** | [packages/dsh-plugin](packages/dsh-plugin) | DSH users |
| **ZCode adapter** (SessionStart hook) | [packages/zcode-adapter](packages/zcode-adapter) | ZCode users |
| Handoff skill | [skills/handoff-atlas](skills/handoff-atlas) | optional |

**Install**: see [INSTALL.md](INSTALL.md) · **What we learned the hard way**: [docs/ENGINEERING-NOTES.md](docs/ENGINEERING-NOTES.md)

## Why it exists

CLI agents inherit the project root as their working directory; a desktop agent like DSH does not —
so it starts every session blind. Worse is the **silent half-failure**: a memory plugin that installs
cleanly, passes every self-check, and still never captures a single session. Most of the engineering here
is defenses against that class of bug.

## Key numbers (measured, not marketing)

| | |
|---|---|
| Brief fetch | **~5ms** cold (SQL direct) vs 310–360ms shelling out to the CLI |
| Keyword search | **20/20** queries land in top-10 |
| Plain-language search | 17/20 in top-10, **top-1 only 10/20** — our known weak spot, stated up front |
| Consistency gate | 9 sections (A–I), all green |

## License

MIT. Upstream © EwanJasper; modifications © rui08984-dot.
