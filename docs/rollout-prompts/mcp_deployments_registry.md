# Prompt: MCP Deployments Registry Durable Realtime Rollout

You are working in `/Users/riccardoesclapon/Documents/github/mcp_deployments_registry`.

Implement the RickyData SDK realtime upgrade without breaking existing Agent Gateway or marketplace behavior.

Requirements:
- Preserve all current SSE response payload shapes. Existing clients that only parse `data:` frames must keep working.
- Use the new SDK-compatible SSE contract: tolerate `id:`, `event:`, comments/heartbeats, split chunks, malformed JSON skips, and `Last-Event-ID`.
- Keep durable replay opt-in behind `ENABLE_DURABLE_SSE_REPLAY=true`.
- Use the existing durable writer and replay route in Agent Gateway:
  - `X-RickyData-Stream-Id` identifies the stream.
  - `GET /streams/:streamId/events?after=<cursor>` returns replayable JSON.
  - `Accept: text/event-stream` or `?format=sse` returns replayable SSE.
- Migrate duplicated frontend SSE parsers only after backend tests pass.

Test plan:
- Run `cd mcp-agent-gateway && npm test -- --run src/routes/stream-routes.test.ts`.
- Run `cd mcp-agent-gateway && npm test -- --run src/routes/chat-routes-sponsorship.test.ts`.
- Run `cd mcp-agent-gateway && npm run build`.
- If frontend parser changes are made, run the relevant marketplace/dashboard build and existing tests.

Do not touch unrelated website redesign files already dirty in this repo.
