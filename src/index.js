// Cloudflare Worker: Streamable HTTP transport for the MCP server + a small REST API for the
// driver/teacher dashboard. All state lives in one Durable Object so every scan and check is
// serialized (no race between "last child got off" and "finish trip").
import { DurableObject } from "cloudflare:workers";
import * as G from "./guard.js";
import { handleMessage, PROTOCOL_VERSION } from "./mcp.js";
import { runAgent } from "./agent.js";

const SUPPORTED_VERSIONS = [PROTOCOL_VERSION, "2025-06-18", "2025-03-26"];

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...headers } });

const cleanHistory = (body) => (Array.isArray(body.messages) ? body.messages : []).slice(-12)
  .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string").map((m) => ({ role: m.role, content: m.content.slice(0, 1000) }));

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/mcp" || url.pathname.startsWith("/api/")) {
      // ponytail: one store for the whole deployment; one Durable Object per school when multi-tenant.
      return env.GUARD.get(env.GUARD.idFromName("default")).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
  // Every minute: raise overdue back-seat-check alerts and notify people without waiting for anyone to ask.
  async scheduled(_event, env, ctx) {
    const stub = env.GUARD.get(env.GUARD.idFromName("default"));
    ctx.waitUntil(stub.fetch("https://guard/internal/tick", { method: "POST" }));
  },
};

export class GuardStore extends DurableObject {
  async load() {
    return (await this.ctx.storage.get("state")) || G.emptyState();
  }
  async save(state) {
    // Keep the log bounded for the demo; the real product archives instead of trimming.
    state.outbox = state.outbox.slice(-200);
    await this.ctx.storage.put("state", state);
  }

  // Deliver alert messages. Always kept in the outbox (shown on the dashboard); also pushed to
  // LINE and/or a generic webhook when configured.
  deliver(msgs) {
    if (!msgs.length) return;
    const env = this.env;
    const jobs = [];
    if (env.ALERT_WEBHOOK_URL) {
      jobs.push(fetch(env.ALERT_WEBHOOK_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: msgs }) }));
    }
    if (env.LINE_TOKEN && env.LINE_TO) {
      const text = msgs.map((m) => `→ ${m.to} (${m.role})\n${m.text}`).join("\n\n").slice(0, 4900);
      jobs.push(fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${env.LINE_TOKEN}` },
        body: JSON.stringify({ to: env.LINE_TO, messages: [{ type: "text", text }] }),
      }));
    }
    for (const j of jobs) this.ctx.waitUntil(j.catch((e) => console.log("deliver failed", e.message)));
  }

  isAdmin(request, url, body) {
    const key = this.env.ADMIN_KEY;
    if (!key) return false;
    return (body && body.key === key) || url.searchParams.get("key") === key || request.headers.get("x-admin-key") === key;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/mcp") return this.mcp(request);

    if (path === "/internal/tick" && request.method === "POST") {
      const state = await this.load();
      const fresh = G.raiseAlerts(state, G.dueAlerts(state));
      const out = [];
      for (const a of fresh) {
        const t = G.findTrip(state, a.tripId);
        if (t) out.push(...G.escalate(state, t, a.text));
      }
      if (fresh.length) await this.save(state);
      this.deliver(out);
      return json({ raised: fresh.length });
    }

    if (path === "/api/state" && request.method === "GET") {
      const state = await this.load();
      if (G.raiseAlerts(state, G.dueAlerts(state)).length) await this.save(state);
      const admin = this.isAdmin(request, url, null);
      return json({
        location: admin ? state.location || null : undefined,
        trips: state.trips.slice(0, 5).map((t) => ({
          ...G.publicTrip(t),
          summary: G.summary(state, t),
          lastScan: Object.fromEntries(state.scans.filter((s) => s.tripId === t.id).map((s) => [s.riderId, s.type])),
        })),
        outbox: state.outbox.slice(-20).reverse(),
      }, 200, { "cache-control": "no-store" });
    }

    if (path === "/api/parent/me" && request.method === "GET") {
      const state = await this.load();
      const v = G.parentView(state, request.headers.get("x-device") || "");
      return json(v, v.err ? 401 : 200, { "cache-control": "no-store" });
    }

    let body = {};
    if (request.method === "POST") {
      try { body = await request.json(); } catch { return json({ error: "Body must be JSON." }, 400); }
    }
    if (path === "/api/parent/pair" && request.method === "POST") {
      const now = Date.now();
      this.fails = (this.fails || []).filter((t) => now - t < 10 * 60 * 1000);
      if (this.fails.length >= 20) return json({ error: "Too many wrong codes. Try again in a few minutes." }, 429);
      const state = await this.load();
      const r = G.pairDevice(state, body.code);
      if (r.err) { this.fails.push(now); return json({ error: r.err }, 400); }
      await this.save(state);
      return json(r);
    }
    if (path === "/api/parent/unpair" && request.method === "POST") {
      const state = await this.load(); G.unpairDevice(state, String(body.device || "")); await this.save(state);
      return json({ ok: true });
    }

    if (path === "/api/chat" && request.method === "POST" && body.persona === "parent") {
      const device = String(body.device || "");
      const state = await this.load();
      if (G.parentView(state, device).err) return json({ error: "Link your child first." }, 401);
      if (!this.env.ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY is not set on the server." }, 500);
      const now = Date.now(); this.rl ||= {};
      this.rl[device] = (this.rl[device] || []).filter((t) => now - t < 3600_000);
      if (this.rl[device].length >= 30) return json({ error: "Too many questions this hour. Try again later." }, 429);
      this.rl[device].push(now);
      const history = cleanHistory(body);
      if (!history.length || history[history.length - 1].role !== "user") return json({ error: "Send the user's message last." }, 400);
      try {
        const r = await runAgent({ apiKey: this.env.ANTHROPIC_API_KEY, model: this.env.AGENT_MODEL, history, state, persona: "parent", device });
        return json({ reply: r.reply, memo: r.memo || r.reply });   // read-only role: nothing to save, no tool trace for parents
      } catch (e) { console.log("parent agent failed", e.message); return json({ error: "Alexa could not answer right now." }, 502); }
    }

    if (!this.isAdmin(request, url, body)) return json({ error: "Admin key required." }, 401);

    // Language for alerts to teacher/parents (also used by the overdue-check cron). Dashboard sends it with chat/demo/lang.
    const setLang = async (state) => { if (body.lang === "th" || body.lang === "en") state.lang = body.lang; };
    if (path === "/api/lang" && request.method === "POST") {
      const state = await this.load(); await setLang(state); await this.save(state); return json({ ok: true, lang: state.lang || "en" });
    }

    if (path === "/api/scan" && request.method === "POST") {
      const state = await this.load();
      const t = G.findTrip(state, body.trip_id);
      if (!t) return json({ error: "No such trip." }, 404);
      const r = G.recordScan(state, t, body.rider_id, body.type, "qr");
      if (r.err) return json({ error: r.err }, 400);
      await this.save(state);
      return json({ ok: true, summary: G.summary(state, t) });
    }

    // Driver phone (public/driver.html) reports its GPS position. Keeps only a short trail.
    if (path === "/api/location" && request.method === "POST") {
      const lat = Number(body.lat), lng = Number(body.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return json({ error: "lat/lng required." }, 400);
      const state = await this.load();
      const p = { lat, lng, speed: Number.isFinite(Number(body.speed)) ? Number(body.speed) : null, acc: Number(body.acc) || null, at: Date.now() };
      const trail = (state.location?.trail || []).slice(-199);
      if (body.stop) state.location = null;
      else state.location = { ...p, trail: [...trail, [lat, lng]] };
      await this.save(state);
      return json({ ok: true });
    }

    // Alexa's voice: BytePlus Seed TTS (NDJSON of base64 mp3 chunks). Admin-key only: every call costs credits.
    if (path === "/api/tts" && request.method === "POST") {
      const text = String(body.text || "").trim().slice(0, 500);
      if (!text) return json({ error: "missing text" }, 400);
      if (!this.env.BYTEPLUS_TTS_KEY || !this.env.BYTEPLUS_TTS_SPEAKER) return json({ error: "tts not configured" }, 503);
      const up = await fetch("https://voice.ap-southeast-1.bytepluses.com/api/v3/tts/unidirectional", {
        method: "POST",
        headers: { "x-api-key": this.env.BYTEPLUS_TTS_KEY, "X-Api-Resource-Id": "seed-tts-2.0", "content-type": "application/json" },
        body: JSON.stringify({ req_params: { text, speaker: /^[a-z]{2,3}_[a-z0-9_]{3,80}$/i.test(body.speaker || "") ? body.speaker : this.env.BYTEPLUS_TTS_SPEAKER, audio_params: { format: "mp3", sample_rate: 24000, tone: 1, speech_rate: -10, volume: 32 } } }),
      });
      if (!up.ok) { console.log("tts upstream", up.status); return json({ error: "tts upstream error" }, 502); }
      const chunks = [];
      for (const line of (await up.text()).split("\n")) {
        const t = line.trim().replace(/^data:\s*/, "");
        if (!t || t === "[DONE]") continue;
        try { const e = JSON.parse(t); const b = e.data || e.audio; if (b) chunks.push(Uint8Array.from(atob(b), (c) => c.charCodeAt(0))); } catch {}
      }
      if (!chunks.length) return json({ error: "no audio" }, 502);
      const out = new Uint8Array(chunks.reduce((n, a) => n + a.length, 0)); let o = 0;
      for (const a of chunks) { out.set(a, o); o += a.length; }
      return new Response(out, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
    }

    // Simulated Alexa+: Claude chooses tools and every call goes through the MCP handler.
    if (path === "/api/chat" && request.method === "POST") {
      if (!this.env.ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY is not set on the server." }, 500);
      const history = cleanHistory(body);
      if (!history.length || history[history.length - 1].role !== "user") return json({ error: "Send the user's message last." }, 400);
      const state = await this.load(); await setLang(state);
      try {
        const r = await runAgent({ apiKey: this.env.ANTHROPIC_API_KEY, model: this.env.AGENT_MODEL, history, state });
        await this.save(state);
        this.deliver(r.outbox);
        return json({ reply: r.reply, memo: r.memo || r.reply, trace: r.trace });
      } catch (e) {
        console.log("agent failed", e.message);
        return json({ error: "The agent could not answer: " + e.message }, 502);
      }
    }

    if (path === "/api/demo" && request.method === "POST") {
      const state = G.emptyState(); await setLang(state);
      G.createTrip(state, state.lang === "th" ? {
        name: "ทัศนศึกษาสวนสัตว์", plate: "รถตู้ 2", driver: "ลุงสมชาย", teacher: "ครูมะลิ",
        riders: [
          { name: "มิ้นท์", parent: "แม่ของมิ้นท์" }, { name: "แบงค์", parent: "พ่อของแบงค์" }, { name: "ฟ้า", parent: "แม่ของฟ้า" },
          { name: "ต้น", parent: "ยายของต้น" }, { name: "พลอย", parent: "พ่อของพลอย" }, { name: "น้องเก้า", parent: "แม่ของน้องเก้า" },
        ],
      } : {
        name: "Zoo field trip",
        plate: "Van 2",
        driver: "Mr. Somchai",
        teacher: "Teacher Mali",
        riders: [
          { name: "Mint", parent: "Mint's mom" },
          { name: "Bank", parent: "Bank's dad" },
          { name: "Fah", parent: "Fah's mom" },
          { name: "Ton", parent: "Ton's grandma" },
          { name: "Ploy", parent: "Ploy's dad" },
          { name: "Nong Kao", parent: "Kao's mom" },
        ],
      });
      await this.save(state);
      return json({ ok: true, trip_id: state.trips[0].id });
    }

    // Pairing codes to hand to parents (printed or sent by the school). Admin only.
    if (path === "/api/parent-codes" && request.method === "GET") {
      const state = await this.load();
      const t = G.findTrip(state, url.searchParams.get("trip_id")) || state.trips[0];
      if (!t) return json({ error: "No trip." }, 404);
      const codes = G.pairingCodes(state, t); await this.save(state);
      return json({ trip: t.name, codes });
    }

    // The only way to see the back-seat code: an admin printing the card for the vehicle.
    if (path === "/api/tail-card" && request.method === "GET") {
      const state = await this.load();
      const t = G.findTrip(state, url.searchParams.get("trip_id"));
      if (!t) return json({ error: "No such trip." }, 404);
      return json({ trip: t.name, vehicle: t.plate, code: t.tailCode });
    }

    return json({ error: "Not found." }, 404);
  }

  // Streamable HTTP (MCP 2025-11-25): POST only, JSON responses, no server-initiated stream.
  async mcp(request) {
    const env = this.env;
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });

    // DNS-rebinding guard required by the spec: reject unexpected browser origins.
    const origin = request.headers.get("origin");
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (origin && origin !== new URL(request.url).origin && !allowed.includes(origin)) {
      return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Origin not allowed" } }, 403);
    }
    const pv = request.headers.get("mcp-protocol-version");
    if (pv && !SUPPORTED_VERSIONS.includes(pv)) {
      return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: `Unsupported MCP-Protocol-Version: ${pv}` } }, 400);
    }

    let msg;
    try { msg = await request.json(); } catch { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400); }
    if (Array.isArray(msg)) return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Batching is not supported" } }, 400);

    // Role comes from the bearer token: a paired parent device = read-only parent tools; otherwise staff
    // (which needs MCP_TOKEN when that secret is set).
    const state = await this.load();
    const bearer = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    let ctx = { role: "staff" };
    if (bearer && state.devices && state.devices[bearer]) ctx = { role: "parent", device: bearer };
    else if (env.MCP_TOKEN && bearer !== env.MCP_TOKEN) {
      return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } }, 401, { "www-authenticate": "Bearer" });
    }
    const r = handleMessage(state, msg, Date.now(), ctx);
    if (r.changed) await this.save(state);
    this.deliver(r.outbox);
    if (!r.response) return new Response(null, { status: 202 });
    return json(r.response);
  }
}
