# Demo video script (target 2:50, limit 3:00) — English voice-over, one Thai demo beat

Live URL: https://bus-guardian.persuaded-mix.workers.dev — dashboard `/`, parent page `/parent`.
Voice: read each line as its own take (12 takes, ~10–15 s each). No music. No real children, names, photos or school name.

| # | Time | On screen | Say |
|---|------|-----------|-----|
| 1 | 0:00 | Title card: "Bus Guardian" | A child fell asleep on a school bus. Everyone else got off. The bus drove away. |
| 2 | 0:10 | Same card | The driver found him only when he checked the bus before parking at home. That child is my nephew. |
| 3 | 0:22 | Dashboard, 6 riders on board | Bus Guardian is an MCP server for Alexa+. It gives Alexa the school's live headcount, and one rule it cannot break: no child is left behind. |
| 4 | 0:38 | Tap "Five got off" | The teacher just talks. Five children got off. Alexa records each one. |
| 5 | 0:50 | Tap "Did every kid get off?" → alert appears in Outbox | Did every kid get off? Alexa checks the live count, says no, and alerts the teacher and the parent on its own. |
| 6 | 1:08 | Phone frame: `/parent`, linked to Nong Kao — "On the van" + red alert line | Here is that parent. They linked their phone once with a six-letter code from the school. Now they see only their own child: still on the van, and the school is checking. |
| 7 | 1:28 | Parent taps "Is my child off the van yet?" → Alexa answers | The parent asks Alexa. Same server, different role. A parent gets one read-only tool. Alexa cannot close the trip, clear the alarm, or see any other child, whatever it is told. |
| 8 | 1:48 | Dashboard → switch language to ไทย → tap "เด็กลงครบไหม?" → Thai voice answers (subtitle EN) | And it works in Thai. The teacher asks in Thai, and Alexa answers in a Thai voice. |
| 9 | 2:02 | Switch back to English → tap "Close trip?" then "Wrong code" (red tool lines) | Alexa tries to close the trip. The server refuses. Someone must walk to the back seat and read a secret code. Alexa does not know it, so it cannot guess it. A wrong code is refused. |
| 10 | 2:24 | Admin → **Show back-seat code card** → type the real code → trip closes; parent phone flips to "Got off safely" after "Last one off" | The card at the back of the van has the real code. Only now can the trip close. |
| 11 | 2:36 | Code: guard.js + mcp.js (roles) | The safety rules and the roles live in the server, not in the prompt. The model can raise an alarm, but it can never clear one. |
| 12 | 2:48 | Repo URL | Open source, MIT. Bus Guardian: Alexa, is every kid off the van? |

Beat 8 subtitle (burn in): Q "Did every child get off the van?" · A = whatever Alexa actually says, translated.

---

## Recording steps (do in this order)

### A. Prep (once, before any take)
1. Chrome window 1280×800, zoom 100%, hide bookmarks bar. Close other tabs, mute notifications (Focus mode).
2. Open `/` → language **English** → Admin → enter admin key → **Reset demo trip**.
3. Voice picker: English = clearest voice; switch to ไทย once and pick **☁ Mildred · นิ่ง สมดุล**, then back to English. (Choice is saved per language.)
4. Rehearse beats 4 → 10 once on the dashboard only, then **Reset demo trip** again (a reset makes new codes).
5. Admin → **Show parent codes** → note Nong Kao's code. Do NOT film this screen (codes are private).
6. Second window, narrow (≈400×800) or iPhone: open `/parent` → enter Nong Kao's code → **Link**. Check it shows "On the van". Language English. From here on, do not reset until filming is done.

### B. Screen recording (one continuous pass, voice-over added later)
Record with QuickTime → New Screen Recording (or Cmd+Shift+5), whole screen with both windows visible. Pause ~2 s between beats so cuts are easy.
- Beat 3: hold on dashboard 3 s.
- Beat 4: tap **Five got off** → wait until the 5 rows turn to "off".
- Beat 5: tap **Did every kid get off?** → wait for the answer + Outbox alert.
- Beat 6: move focus to the parent window, hold 4 s on the red alert line.
- Beat 7: tap **Is my child off the van yet?** → wait for the full answer.
- Beat 8: dashboard → language **ไทย** → tap **เด็กลงครบไหม?** → let the Thai voice finish (screen audio ON for this beat only).
- Beat 9: language **English** → tap **Close trip?** → then **Wrong code** → hold on the red refusal lines.
- Beat 10: tap **Last one off** → Admin → **Show back-seat code card** → type the real code → trip closes; show parent window "Got off safely".
- Beat 11: VS Code, `src/guard.js` then `src/mcp.js` around `PARENT_TOOLS` (scroll slowly, 8 s).
- If any answer is slow or wrong: Reset demo trip, redo prep steps 5–6, redo from beat 4. Do not edit an answer in post.

### C. Voice-over (12 takes)
- Personal Voice / your own voice, one file per row: `vo-01.m4a` … `vo-12.m4a`. Read from this table on screen — no memorising.
- Quiet room, phone 20 cm away, same distance every take. Redo any take with a stumble; only the takes are cut, not words inside them.

### D. Edit (Canva or CapCut)
1. Lay the 12 VO takes on the timeline at the times in the table; trim the screen recording under each.
2. Keep screen audio muted except beat 8 (Thai voice) — duck the VO there.
3. Add the beat-8 English subtitle and a title card / end card with the repo URL.
4. Check length ≤ 2:59, export 1080p, upload to YouTube **Unlisted**, paste link into Devpost.
