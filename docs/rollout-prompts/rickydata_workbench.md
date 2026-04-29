# Prompt: rickydata_workbench Rust Parity Rollout

You are working in `/Users/riccardoesclapon/Documents/github/rickydata_workbench`.

Treat the RickyData SDK realtime/KFDB improvements as contract input for Rust parity, not as an npm dependency upgrade.

Requirements:
- Read `AGENTS.md`, `WARP.md`, `docs/PRODUCT_SPEC.md`, `docs/ARCHITECTURE.md`, and `docs/SECURITY.md` before broad changes.
- Preserve Warp OSS attribution and existing native integration boundaries.
- Mirror the SDK realtime contract in `rickydata_core` where the app consumes Agent Gateway streams:
  - `id:`
  - `event:`
  - multi-line `data:`
  - comments/heartbeats
  - malformed JSON skips
  - `Last-Event-ID` resume
- Add connection-state snapshots for UI surfaces that need reconnect/progress display.
- Keep production endpoint contracts sourced from `mcp_deployments_registry` skills.

Test plan:
- Run `cargo test -p rickydata_core`.
- Run `cargo check -p rickydata_core`.
- Run `cargo fmt --all --check`.
- Before release, run `cargo clippy --workspace --all-targets --all-features --tests -- -D warnings`, `cargo test --workspace --exclude command-signatures-v2`, and `cargo build -p warp --bin rickydata-workbench`.

No manual infrastructure changes.
