# Bus Guardian — Alexa, is every kid off the van?

An Alexa+ agent backend (self-hosted **MCP server, spec 2025-11-25, Streamable HTTP**) that keeps children from being left on school vehicles.

> "Alexa, did every kid get off the van?"
> "Not yet. Nong Kao is still on board, and nobody has done the back-seat check. I've alerted Teacher Earn and Kao's mom."

## Why

Children fall asleep on school vans and get left behind. In Thailand in 2022 a 7-year-old died after being left in a school van in Chonburi. California's SB 1072 (2016, after the death of Paul Lee) requires a check of the back of every school bus before the driver leaves. The rule is simple; making sure it happens every time is the hard part.

## Safety rules (enforced on the server, not by the AI)

| Rule | What it does |
|---|---|
| R1 | A trip cannot finish while any child who boarded is still on board. |
| R2 | A trip cannot finish until a person walks to the back of the vehicle and reads the code posted there. The code is random (not derived from the plate) and **no tool ever returns it** — the agent cannot skip the check. |
| R3 | If the back-seat check is still missing 5 minutes after the last child got off, a CRITICAL alert is raised and the teacher + parents are notified automatically (cron, every minute). |
| R4 | The scan log is append-only. |

Design rule: the agent may raise an alarm on its own, but it can never clear one. It never guesses between two children with similar names.

## MCP tools

| Tool | Purpose |
|---|---|
| `get_trip_status` | Live headcount: still on board, got off, never boarded, back-seat check, open alerts |
| `list_trips` | Recent trips |
| `create_trip` | Start a trip for one vehicle with its rider list |
| `record_scan` | Record that a child boarded / got off (only when staff saw it) |
| `confirm_back_seat_check` | Confirm the walk to the back, using the code read from the card |
| `finish_trip` | Close the trip; refuses and explains what is blocking it |
| `alert_teacher_and_parents` | Alert the teacher and the parent of every child still on board |

Endpoint: `POST /mcp` (JSON-RPC, JSON responses). `GET /mcp` returns 405 (no server-initiated stream). The server validates `Origin`, `MCP-Protocol-Version`, and an optional bearer token.

## Run locally

Requires Node 20+.

```bash
npm test                      # safety rules + MCP protocol tests, no server needed
echo "ADMIN_KEY=dev-admin-key" > .dev.vars
npx wrangler dev              # http://localhost:8787
```

Open http://localhost:8787, enter the admin key, press **Reset demo trip**, then tap Board / Off for each rider (this simulates the driver's QR scans).

Call the MCP server:

```bash
curl -s -X POST http://localhost:8787/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_trip_status","arguments":{}}}'
```

## Deploy (Cloudflare Workers + Durable Objects)

```bash
npx wrangler secret put ADMIN_KEY
npx wrangler secret put MCP_TOKEN        # optional: require "Authorization: Bearer <token>" on /mcp
npx wrangler secret put LINE_TOKEN       # optional: push alerts to LINE (with LINE_TO)
npx wrangler secret put LINE_TO
npx wrangler deploy
```

Then add `https://<your-worker>/mcp` as a Streamable HTTP MCP server in your agent (Alexa+, or any MCP client).

## Architecture

- `src/guard.js` — the safety rules as pure functions (ported from the Bus Guardian module of our School OS).
- `src/mcp.js` — MCP JSON-RPC handler and tool definitions, transport-free and unit-tested.
- `src/index.js` — Worker: Streamable HTTP transport, dashboard API, cron alerts. One Durable Object holds all state, so scans and checks never race.
- `public/index.html` — driver / teacher dashboard.

## License

MIT
