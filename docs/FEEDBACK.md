# Product feedback + friction log (draft — edit before pasting into Devpost)

Honest scope: Alexa+ was **simulated** (Claude agent calling the same MCP handler). We did not test on a real Alexa+ device.

## Friction log (real, in order)
1. `wrangler dev` rejected my compatibility_date (2026-10-xx) — the installed wrangler (4.110) only supports up to 2026-07-15. Error wording didn't say what the max supported date was.
2. `node --test test/` failed on a bare directory; needs a glob (`test/*.test.mjs`).
3. MCP spec: Streamable HTTP is simple for a stateless tool server, but the spec leaves open what a POST-only server should return for GET (405 is allowed; I had to infer it). A short "minimal conformant server" example would save time.
4. Origin validation (required by spec) is hard to test from a browser on the same origin; a conformance test kit for servers would help.
5. Forced `tool_choice` is rejected on the newer Claude models, so "always call this tool" has to be done in the prompt/tool description.
6. First agent version asked the user to confirm every scan; fixed by saying in the server `instructions` that the teacher's report is eyewitness evidence.
7. Agent forgot which tools it had run between voice turns; fixed by appending a "[tools used this turn: …]" line to the stored assistant message.

## Product feedback per tool (fill with what you actually used)
- MCP (Streamable HTTP, 2025-11-25): clear, small surface; wish for server-side examples for Workers/Durable Objects.
- Cloudflare Workers + Durable Objects: a single DO serialized every scan with no locking code.
- Claude (agent loop): tool descriptions are the real safety contract; wrote the rules in `instructions` AND enforced them in server code.
- Alexa+: not tested on device — say so in the form.
