# Prompt: rickydata_notes Sync Observability Rollout

You are working in `/Users/riccardoesclapon/Documents/github/rickydata_notes`.

Use the RickyData/KFDB lessons to improve sync observability without changing local note/block storage behavior.

Requirements:
- Do not migrate SiYuan block SQL away from local SQLite.
- Add a local/cloud operation log for note sync activity: note changed, queued, synced, conflict, failed, resolved.
- Make the operation log replayable by cursor so UI/status tools can resume after disconnects or app restart.
- Mirror the TypeScript SDK contract where useful, but implement in the native Go/Rust/SiYuan shape already used by this repo.
- Preserve sign-to-derive protection for private note data.

Test plan:
- Start with the repo’s documented baseline tests/build.
- Add focused tests around operation-log append, cursor replay, failure recording, and conflict resolution metadata.
- Verify an actual note edit produces an observable operation record and that replay after a stored cursor returns only later operations.

No manual infrastructure changes.
