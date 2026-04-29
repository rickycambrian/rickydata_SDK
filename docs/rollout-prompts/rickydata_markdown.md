# Prompt: rickydata_markdown SDK Realtime Rollout

You are working in `/Users/riccardoesclapon/Documents/github/rickydata_markdown`.

Adopt the RickyData SDK realtime improvements while preserving the existing Rust WebSocket/session architecture.

Requirements:
- Keep the current shared notebook session bus and WebSocket route; do not replace it with SSE.
- Add cursor-based replay to reconnect flows for notebook/cell events where data loss currently forces a full refresh.
- Use the SDK realtime parser contract for gateway/canvas SSE calls in the React app.
- Update app dependencies to the new local/published packages:
  - `rickydata >= 1.6.0`
  - `@rickydata/react >= 0.1.13`
  - `@rickydata/chat >= 0.1.12`
- For local validation before publish, use `/tmp/rickydata-1.6.0.tgz`, `/tmp/rickydata-react-0.1.13.tgz`, and `/tmp/rickydata-chat-0.1.12.tgz`.
- Keep block SQL local-only and keep current KFDB notebook persistence semantics.

Test plan:
- Run `cargo test --workspace`.
- Run `cd app && npx tsc --noEmit`.
- Run `cd app && npm run build`.
- Add a reconnect test proving a client can recover events since the last cursor without duplicating already-applied cell output.

No manual infrastructure changes.
