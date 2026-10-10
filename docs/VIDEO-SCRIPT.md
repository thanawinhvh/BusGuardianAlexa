# Demo video script (target 2:40, limit 3:00) — English, read aloud

Screen: dashboard at the live URL, Alexa+ panel visible. Reset the demo trip before recording.
Voice: read each line as its own take (10 takes). No music.

| # | Time | On screen | Say |
|---|------|-----------|-----|
| 1 | 0:00 | Title card: "Bus Guardian" | A child fell asleep on a school bus. Everyone else got off. The bus drove away. |
| 2 | 0:12 | Same card | The driver found him only when he checked the bus before parking at home. That child is my nephew. |
| 3 | 0:25 | Dashboard, 6 riders | Bus Guardian is an MCP server for Alexa+. It gives Alexa the school's headcount, and one rule it cannot break: no child is left behind. |
| 4 | 0:45 | Tap "Five got off" | The teacher just talks. Five children got off. Alexa records each one. |
| 5 | 1:05 | Tap "Did every kid get off?" | Did every kid get off? Alexa checks the live count, says no, and alerts the teacher and the parent on its own. |
| 6 | 1:30 | Tap "Close trip?" then "Wrong code" | The agent tries to close the trip. The server refuses. Someone must walk to the back seat and read a secret code. Alexa does not know it, so it cannot guess it. A wrong code is refused. |
| 7 | 1:55 | Admin card, then type the real code | Here is the card posted at the back of the van. The right code is accepted, and only now can the trip close. |
| 8 | 2:15 | Code: guard.js + mcp.js | The safety rules live in the server, not in the prompt. The model can raise an alarm, but it can never clear one. |
| 9 | 2:30 | Architecture line | Seven MCP tools, Streamable HTTP, on Cloudflare Workers with one Durable Object so every scan is serialized. |
| 10 | 2:40 | Repo URL | Open source, MIT. Bus Guardian: Alexa, is every kid off the van? |

Notes
- Show the refusals (red tool lines) — they are the point of the demo.
- Do not show real children's names, photos, or the school's name.
- No copyrighted music.
