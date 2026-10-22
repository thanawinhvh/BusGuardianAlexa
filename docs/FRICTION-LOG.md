# Friction log — Bus Guardian (Amazon "Build, Ship, Shape" hackathon, Alexa+ track)

Real issues hit while building, in the order they happened. Severity: Critical (blocked a goal) · Medium (cost real time) · Low (annoyance).

## 1. No way to test a self-hosted MCP server on a real Alexa+ device
- **Task:** connect our MCP server to Alexa+ and test it by voice.
- **Steps:** built the server to the MCP spec (2025-11-25, Streamable HTTP), deployed it on Cloudflare Workers, looked for a way to add it to an Alexa+ device or simulator.
- **Expected:** a developer path to point Alexa+ at a self-hosted MCP endpoint.
- **Actual:** we had no Alexa+ developer access on a device.
- **Severity:** Critical (no on-device test).
- **Workaround:** a Claude tool-use loop plays Alexa+ and calls the exact same MCP handler; every tool call is shown on screen.
- **Suggestion:** a hackathon sandbox or simulator that accepts a self-hosted MCP URL.

## 2. wrangler dev rejected the compatibility date without saying the limit
- **Task:** start the local dev server.
- **Steps:** set `compatibility_date` to the current date, ran `npx wrangler dev`.
- **Expected:** server starts, or the error names the newest supported date.
- **Actual:** the date was rejected; the message did not say the maximum (2026-07-15 for wrangler 4.110).
- **Severity:** Medium.
- **Workaround:** set the date to 2026-07-15.
- **Suggestion:** print the newest supported date in the error.

## 3. MCP spec leaves GET on a POST-only server open
- **Task:** implement Streamable HTTP for a stateless server with no SSE stream.
- **Steps:** read the transport section to decide what GET /mcp should return.
- **Expected:** a clear rule or example.
- **Actual:** 405 is allowed, but we had to infer it.
- **Severity:** Low.
- **Workaround:** return 405 Method Not Allowed.
- **Suggestion:** a minimal conformant server example in the spec.

## 4. Origin validation is hard to test
- **Task:** verify the server rejects requests from untrusted origins.
- **Steps:** tried to test from the browser on the same origin.
- **Expected:** an easy way to send a foreign Origin.
- **Actual:** the browser always sends its own origin, so the reject path cannot be hit from the page.
- **Severity:** Low.
- **Workaround:** unit tests with a fake Origin header.
- **Suggestion:** an official MCP conformance test kit that covers Origin and protocol-version checks.

## 5. `node --test test/` fails on a bare directory
- **Task:** run the unit tests.
- **Steps:** `node --test test/`.
- **Expected:** runs every test file in the folder.
- **Actual:** fails; it needs a glob.
- **Severity:** Low.
- **Workaround:** `node --test test/*.test.mjs` in package.json.
- **Suggestion:** accept a directory, or say so in the error.

## 6. Forced tool_choice rejected on newer Claude models
- **Task:** force the simulated Alexa+ to always call `get_trip_status` before answering.
- **Steps:** set `tool_choice` to a specific tool.
- **Expected:** the model calls that tool.
- **Actual:** the request was rejected on newer models.
- **Severity:** Medium.
- **Workaround:** moved "call this before answering any question about where a child is" into the tool description and server instructions.
- **Suggestion:** document which models accept forced tool choice.

## 7. The agent asked the teacher to confirm every scan
- **Task:** "Five kids got off" should record five scans at once.
- **Expected:** five `record_scan` calls.
- **Actual:** the agent asked the teacher to confirm each child before recording.
- **Severity:** Medium (unusable by voice).
- **Workaround:** server instructions now say a staff report is eyewitness evidence and must be recorded right away.
- **Suggestion:** guidance in Alexa+ MCP docs on how instructions from the server are weighed against the agent's own caution.

## 8. The agent lost track of tools between voice turns
- **Task:** multi-turn conversation where the next answer depends on what was already recorded.
- **Expected:** the agent remembers which tools it already ran.
- **Actual:** it repeated or skipped steps.
- **Severity:** Medium.
- **Workaround:** a short "tools used this turn" line is appended to the stored assistant message.
- **Suggestion:** keep tool results in conversation history by default in voice agents.

## 9. The careful agent hides the server's refusal
- **Task:** show in the demo that the server refuses to close a trip with a child on board.
- **Steps:** asked "Can we close the trip?".
- **Expected:** a refused `finish_trip` call.
- **Actual:** the agent checked status and declined on its own, so the server never had to refuse.
- **Severity:** Low (good behavior, but the guarantee is invisible).
- **Workaround:** asked the agent to "try to finish the trip and tell me what the server says".
- **Suggestion:** a debug view in Alexa+ that shows tool calls and refusals, so builders can prove server-side rules.

## 10. Thai voice read numbers awkwardly
- **Task:** speak Thai answers with numbers ("5 of 6").
- **Expected:** natural Thai numbers.
- **Actual:** digits were read in a mixed, unnatural way.
- **Severity:** Low.
- **Workaround:** convert numbers to Thai words before speech.
- **Suggestion:** number normalization for Thai in text-to-speech.

## 11. `prompt()` blocked in embedded browsers
- **Task:** ask for the admin key in the dashboard.
- **Actual:** `prompt()` did nothing inside an embedded browser.
- **Severity:** Low.
- **Workaround:** an inline password field.
