# Prompt: rickydata_bench SDK Contract Rollout

You are working in `/Users/riccardoesclapon/Documents/github/rickydata_bench`.

Adopt the RickyData SDK `1.6.0` KFDB helper surface on the server side only.

Requirements:
- Do not expose KFDB system tenant keys in browser code.
- Browser code must continue calling app-owned API routes; only server-side code may use `rickydata_SDK` / KFDB credentials.
- Replace ad hoc KFDB query/write construction with SDK helpers where useful:
  - `queryKql`
  - `querySql`
  - `explainKql`
  - `kfdbValue.*`
- For local validation before publish, use `/tmp/rickydata-1.6.0.tgz`.
- Keep benchmark public/private data boundaries unchanged.
- If benchmark run progress becomes streamed, use durable stream IDs and cursor replay instead of broad polling.

Test plan:
- Run the repo’s documented baseline tests/build before changing dependencies.
- Add server-side tests proving SDK-generated KFDB payloads do not reach browser bundles.
- Verify benchmark pages still render public-only data.

No manual infrastructure changes.
