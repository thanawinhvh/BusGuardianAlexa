// Cloudflare Worker: Streamable HTTP transport for the MCP server + a small REST API for the
// driver/teacher dashboard. All state lives in one Durable Object so every scan and check is
// serialized (no race between "last child got off" and "finish trip").
import { DurableObject } from "cloudflare:workers";
import * as G from "./guard.js";
import { handleMessage, PROTOCOL_VERSION } from "./mcp.js";

const SUPPORTED_VERSIONS = [PROTOCOL_VERSION, "2025-06-18", "2025-03-26"];

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...headers } });

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
      return json({
        trips: state.trips.slice(0, 5).map((t) => ({
          ...G.publicTrip(t),
          summary: G.summary(state, t),
          lastScan: Object.fromEntries(state.scans.filter((s) => s.tripId === t.id).map((s) => [s.riderId, s.type])),
        })),
        outbox: state.outbox.slice(-20).reverse(),
      }, 200, { "cache-control": "no-store" });
    }

    let body = {};
    if (request.method === "POST") {
      try { body = await request.json(); } catch { return json({ error: "Body must be JSON." }, 400); }
    }
    if (!this.isAdmin(request, url, body)) return json({ error: "Admin key required." }, 401);

    if (path === "/api/scan" && request.method === "POST") {
      const state = await this.load();
      const t = G.findTrip(state, body.trip_id);
      if (!t) return json({ error: "No such trip." }, 404);
      const r = G.recordScan(state, t, body.rider_id, body.type, "qr");
      if (r.err) return json({ error: r.err }, 400);
      await this.save(state);
      return json({ ok: true, summary: G.summary(state, t) });
    }

    if (path === "/api/demo" && request.method === "POST") {
      const state = G.emptyState();
      G.createTrip(state, {
        name: "Zoo field trip",
        plate: "Van 2",
        driver: "Mr. Somchai",
        teacher: "Teacher Earn",
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
    if (env.MCP_TOKEN && request.headers.get("authorization") !== `Bearer ${env.MCP_TOKEN}`) {
      return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } }, 401, { "www-authenticate": "Bearer" });
    }
    const pv = request.headers.get("mcp-protocol-version");
    if (pv && !SUPPORTED_VERSIONS.includes(pv)) {
      return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: `Unsupported MCP-Protocol-Version: ${pv}` } }, 400);
    }

    let msg;
    try { msg = await request.json(); } catch { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400); }
    if (Array.isArray(msg)) return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Batching is not supported" } }, 400);

    const state = await this.load();
    const r = handleMessage(state, msg);
    if (r.changed) await this.save(state);
    this.deliver(r.outbox);
    if (!r.response) return new Response(null, { status: 202 });
    return json(r.response);
  }
}
