# Devpost fields — paste after the video is uploaded

Track: **Alexa+** · Repo: https://github.com/thanawinhvh/BusGuardianAlexa (MIT) · Live: https://bus-guardian.persuaded-mix.workers.dev
Video: (YouTube Unlisted link here)

---

## Inspiration
My nephew fell asleep on a school bus after a field trip. Everyone else got off, and the bus drove away while his mother was waiting. The driver found him only when he checked the bus before parking at home. He was lucky. In 2022 a 7-year-old in Chonburi, Thailand, died after being left in a school van. California's SB 1072 (2016, after the death of Paul Lee) requires a check of the back of every school bus. The rule is simple; making sure it happens every single time is the hard part. Teachers and drivers are busy, and they talk, they don't tap screens. So I asked: what if the person in charge could just say "Alexa, did every kid get off the van?" and get a true answer?

## What it does
Bus Guardian is a self-hosted MCP server (spec 2025-11-25, Streamable HTTP) that gives Alexa+ a school's live van headcount and rules it cannot break.

- The teacher talks: "Five kids got off." Alexa records each one.
- "Did every kid get off?" Alexa checks the live count. If a child is still on board, it says so and alerts the teacher and that child's parent on its own.
- Alexa can never close a trip while a child is on board (R1), and never before a person walks to the back seat and reads a random code posted there (R2). No tool returns that code, so the model cannot guess it or skip the check.
- If nobody does the back-seat check within 5 minutes of the last child getting off, a cron job raises a critical alert and notifies people without anyone asking (R3).
- Parents link their phone once with a six-letter code from the school. Through the same server, a parent's Alexa gets one read-only tool for their own child only. It cannot close a trip, clear an alarm, or see any other child, whatever it is told.
- Works in English and Thai: Thai speech in, Thai alerts out, Thai voice answers.

Design rule: the AI may raise an alarm on its own, but it can never clear one.

## How we built it
- **Cloudflare Workers + one Durable Object** hold all state, so every scan and check is serialized with no locking code.
- **`src/guard.js`**: the safety rules as pure functions, ported from the Bus Guardian module of our School OS, covered by unit tests.
- **`src/mcp.js`**: a transport-free MCP JSON-RPC handler with role-scoped tool lists (staff vs parent), also unit-tested.
- **Streamable HTTP**: POST /mcp returns JSON; GET returns 405; Origin, protocol version and an optional bearer token are validated.
- **Simulated Alexa+**: we did not have Alexa+ developer access on a device, so a Claude tool-use loop plays Alexa and calls the exact same MCP handler. Every tool call is shown on screen.
- Thai voice via BytePlus TTS; browser speech recognition for voice input.

## Challenges we ran into
- Making the safety rules hold even if the model is wrong or manipulated. We moved every rule out of the prompt and into server code, and gave the parent role a separate, read-only tool list.
- The first agent asked the teacher to confirm every scan. We fixed it by stating in the server instructions that a staff report is eyewitness evidence.
- The agent forgot which tools it had already run between voice turns. We now append a short "tools used this turn" line to the stored assistant message.
- Thai voice read digits awkwardly, so numbers are converted to Thai words before speech.

## Accomplishments that we're proud of
- An AI agent that can raise an alarm but provably cannot clear one: the server refuses, whatever the prompt says.
- One server, two roles, with different powers, tested.
- It speaks Thai, the language of the people this problem actually happened to.

## What we learned
Tool descriptions and server-side checks are the real safety contract. A rule written only in the prompt is a suggestion; a rule enforced in the tool handler is a guarantee.

## What's next for Bus Guardian
- Test on a real Alexa+ device once we have developer access.
- Pilot with one school van route (consent and a data processing agreement first, no real child data before that).
- QR boarding scans from the driver's phone feeding the same server, and LINE alerts for Thai parents.

---

## Product feedback (per tool)
- **MCP (Streamable HTTP, 2025-11-25)**: small, clear surface for a stateless tool server. A minimal conformant server example (what to return for GET on a POST-only server, how to test Origin validation) would save time.
- **Cloudflare Workers + Durable Objects**: one Durable Object serialized every scan with zero locking code; ideal for a safety log.
- **Claude (agent loop standing in for Alexa+)**: tool descriptions do most of the work. Forced `tool_choice` is rejected on newer models, so "always call this tool" had to move into the prompt and tool description.
- **Alexa+**: not tested on a device. We built against the MCP spec so the same endpoint can be added to Alexa+ as a Streamable HTTP server.

## Friction log (in order, real)
1. `wrangler dev` rejected my compatibility_date: wrangler 4.110 supports up to 2026-07-15, and the error did not say the maximum.
2. `node --test test/` fails on a bare directory; it needs a glob (`test/*.test.mjs`).
3. The MCP spec leaves open what a POST-only server returns for GET; 405 is allowed but I had to infer it.
4. Origin validation is hard to test from a browser on the same origin; a server conformance test kit would help.
5. Forced `tool_choice` rejected on newer Claude models (see above).
6. The agent asked for confirmation on every scan until the server instructions declared staff reports as eyewitness evidence.
7. The agent lost track of tools between voice turns; fixed by storing a tools-used line with each reply.
8. `prompt()` is blocked in embedded browsers, so the admin key field had to become an inline input.

---

## Testing instructions for judges
The live deployment protects chat (admin key, it spends API credit) and /mcp (bearer token), because it sends real alerts. To try everything, run it locally in two minutes: `npm test`, then `npx wrangler dev`, open http://localhost:8787 (see README for the MCP curl example).

<!-- ธนวินท์เลือก: ถ้าอยากให้กรรมการลองของจริง ใส่ MCP token / admin key เฉพาะในช่องที่กรรมการเห็นคนเดียว ห้ามใส่ในหน้าโปรเจกต์สาธารณะ แล้วเปลี่ยนรหัสใหม่หลังประกาศผล 3 ธ.ค. -->

