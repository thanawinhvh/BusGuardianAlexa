// MCP (spec 2025-11-25) JSON-RPC handler — transport-free so it can be tested without a server.
// index.js wraps it in Streamable HTTP. Every tool works on the shared state object from guard.js.
import * as G from "./guard.js";

export const PROTOCOL_VERSION = "2025-11-25";
export const SERVER_INFO = { name: "bus-guardian", title: "Bus Guardian", version: "0.1.0" };

export const INSTRUCTIONS = `Bus Guardian keeps children from being left on school vehicles.
Rules you must follow:
- Never tell anyone a child is safe or off the vehicle unless get_trip_status says so.
- When the teacher or driver says a child boarded or got off, treat that as their eyewitness report and record it right away; do not ask them to confirm. Never record a scan from your own guess, or for a child nobody mentioned.
- The back-seat check needs the code posted at the back of the vehicle. You do not know it. Ask the person to walk to the back and read it to you.
- Boarding is normal; never alert because children boarded or are on board during the trip. Call alert_teacher_and_parents only when (a) the person asks for an alert, or (b) the person says the trip is over / the vehicle has arrived and a child is not scanned off, or (c) a back-seat check is overdue. You may raise an alarm on your own in those cases. You may never clear one. Never say an alert was requested unless the person asked.
- Keep spoken answers short. Say names first, then numbers.`;

const tripId = { type: "string", description: "Trip ID. Leave empty to use the trip that is currently running." };

export const TOOLS = [
  {
    name: "get_trip_status",
    title: "Get trip status",
    description: "Live headcount for a trip: who is still on board, who got off, who never boarded, whether the back-seat check is done, and any open alerts. Call this before answering any question about where a child is.",
    inputSchema: { type: "object", properties: { trip_id: tripId } },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "list_trips",
    title: "List trips",
    description: "List recent trips with their status.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "create_trip",
    title: "Start a trip",
    description: "Start a new trip for one vehicle with its rider list. A secret back-seat code is generated for the vehicle; staff print it from the dashboard and post it at the back seat. The code is never returned to you.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Trip name, e.g. 'Zoo field trip'." },
        plate: { type: "string", description: "Vehicle plate or name, e.g. 'Van 2'." },
        driver: { type: "string" },
        teacher: { type: "string", description: "Teacher in charge. Gets every alert." },
        riders: {
          type: "array",
          description: "Children on this vehicle.",
          items: { type: "object", properties: { name: { type: "string" }, parent: { type: "string", description: "Parent name or contact for alerts." } }, required: ["name"] },
        },
      },
      required: ["riders"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "record_scan",
    title: "Record that a child boarded or got off",
    description: "Record that a child boarded or got off, as reported by the teacher or driver you are talking to. If the name matches more than one child, ask for the full name instead of guessing.",
    inputSchema: {
      type: "object",
      properties: {
        child_name: { type: "string" },
        event: { type: "string", enum: ["boarded", "got_off"] },
        trip_id: tripId,
      },
      required: ["child_name", "event"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "confirm_back_seat_check",
    title: "Confirm the back-seat check",
    description: "Confirm that a person walked to the back of the vehicle after everyone got off. Needs the code posted at the back seat, read out by that person. Only works once every child has been scanned off.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "The code read from the card at the back of the vehicle." },
        checked_by: { type: "string", description: "Name of the person who walked to the back." },
        trip_id: tripId,
      },
      required: ["code", "checked_by"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "finish_trip",
    title: "Finish the trip",
    description: "Close the trip. Refuses while any child is still on board or the back-seat check is missing, and says what is blocking it.",
    inputSchema: { type: "object", properties: { trip_id: tripId } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "alert_teacher_and_parents",
    title: "Alert the teacher and parents",
    description: "Send an urgent alert to the teacher in charge and to the parent of every child still on board. Use whenever a child may be missing or a back-seat check is overdue. A false alarm is acceptable; a missed child is not.",
    inputSchema: {
      type: "object",
      properties: { reason: { type: "string", description: "One short sentence on what is wrong." }, trip_id: tripId },
      required: ["reason"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
];

// A parent session (bearer = a paired device token) sees ONE read-only tool. Roles are enforced here, in code:
// a parent cannot record scans, close trips, send alerts or see other children, whatever the model is told.
export const PARENT_INSTRUCTIONS = `Bus Guardian tells a parent where their own child is on the school vehicle.
- You can only answer about this parent's child, using my_child_status. Call it before answering.
- You cannot record scans, close trips, send alerts, or look at any other child. Say so briefly if asked.
- If the status says an alert is open, tell the parent the school has raised it and the teacher is checking; do not guess more.
- Say only what the status says. You do not know the destination, the route, or an arrival time: never mention them or guess.
- Keep spoken answers short.`;

export const PARENT_TOOLS = [{
  name: "my_child_status",
  title: "My child's status",
  description: "Where this parent's child is right now: not boarded, on the vehicle, or got off, since when, and whether the school has an open alert. Read-only.",
  inputSchema: { type: "object", properties: {} },
  annotations: { readOnlyHint: true, openWorldHint: false },
}];

const ROLE = { staff: { tools: TOOLS, instructions: INSTRUCTIONS }, parent: { tools: PARENT_TOOLS, instructions: PARENT_INSTRUCTIONS } };
export const roleOf = (ctx) => ROLE[ctx && ctx.role] || ROLE.staff;

function callParentTool(state, ctx) {
  const v = G.parentView(state, ctx.device);
  if (v.err) return { result: fail(v.err) };
  const where = { NOT_BOARDED: "not on the vehicle yet", ON_BOARD: "on the vehicle", GOT_OFF: "got off the vehicle" }[v.state];
  return { result: ok({
    child: v.child,
    status: where || "no trip today",
    since: v.since ? new Date(v.since).toISOString() : null,
    trip: v.trip ? `${v.trip.name}${v.trip.vehicle ? " (" + v.trip.vehicle + ")" : ""}` : null,
    trip_finished: !!(v.trip && v.trip.status === "FINISHED"),
    school_alert_open: !!v.alert,
    live_map: v.location ? "available on the Bus Guardian parent page while the child is on the vehicle" : "not available",
  }) };
}

function text(obj) {
  return typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
}
function ok(obj) {
  return { content: [{ type: "text", text: text(obj) }], structuredContent: typeof obj === "string" ? { message: obj } : obj };
}
function fail(msg, extra) {
  const body = { error: msg, ...(extra || {}) };
  return { content: [{ type: "text", text: text(body) }], structuredContent: body, isError: true };
}

// Runs one tool. Mutates `state`. Returns { result, outbox } where outbox = new messages to deliver.
export function callTool(state, name, args = {}, now = Date.now()) {
  const needTrip = () => {
    const t = G.findTrip(state, args.trip_id);
    if (!t) throw new Error(args.trip_id ? `No trip with ID ${args.trip_id}.` : "There is no trip running right now.");
    return t;
  };
  try {
    switch (name) {
      case "get_trip_status": {
        const t = needTrip();
        G.raiseAlerts(state, G.dueAlerts(state, now), now);
        return { result: ok(G.summary(state, t)) };
      }
      case "list_trips":
        return { result: ok({ trips: state.trips.slice(0, 20).map((t) => ({ trip_id: t.id, trip: t.name, vehicle: t.plate, status: t.status, riders: t.riders.length })) }) };
      case "create_trip": {
        const r = G.createTrip(state, args, now);
        if (r.err) return { result: fail(r.err) };
        return { result: ok({ trip_id: r.trip.id, message: `Trip "${r.trip.name}" started with ${r.trip.riders.length} riders. Print the back-seat code card from the dashboard and post it at the back seat before leaving.` }) };
      }
      case "record_scan": {
        const t = needTrip();
        const m = G.matchRider(t, args.child_name);
        if (m.err) return { result: fail(m.err, m.candidates ? { candidates: m.candidates } : undefined) };
        const type = args.event === "boarded" ? "BOARD" : args.event === "got_off" ? "ALIGHT" : null;
        if (!type) return { result: fail('event must be "boarded" or "got_off".') };
        const r = G.recordScan(state, t, m.rider.id, type, "voice", now);
        if (r.err) return { result: fail(r.err) };
        return { result: ok({ recorded: `${m.rider.name} ${args.event === "boarded" ? "boarded" : "got off"}`, ...G.summary(state, t) }) };
      }
      case "confirm_back_seat_check": {
        const t = needTrip();
        const r = G.confirmBackSeatCheck(state, t, args.code, args.checked_by, now);
        if (r.err) return { result: fail(r.err) };
        return { result: ok({ confirmed: `Back-seat check done by ${t.inspection.by}.`, can_finish: G.canFinish(state, t) }) };
      }
      case "finish_trip": {
        const t = needTrip();
        const r = G.finishTrip(state, t, now);
        if (r.err) return { result: fail(r.err, { blockers: r.blockers }) };
        return { result: ok({ finished: `Trip "${t.name}" is closed. Every child who boarded got off, and the back seat was checked.` }) };
      }
      case "alert_teacher_and_parents": {
        const t = needTrip();
        const msgs = G.escalate(state, t, String(args.reason || "A child may still be on the vehicle."), now);
        return { result: ok({ sent: msgs.map((m) => ({ to: m.to, role: m.role })), message: `Alert sent to ${msgs.length} people.` }), outbox: msgs };
      }
      default:
        return { error: { code: -32602, message: `Unknown tool: ${name}` } };
    }
  } catch (e) {
    return { result: fail(e.message) };
  }
}

// One JSON-RPC message in, { response | null, outbox, changed } out. Notifications get no response.
export function handleMessage(state, msg, now = Date.now(), ctx = { role: "staff" }) {
  const isRequest = msg && msg.jsonrpc === "2.0" && typeof msg.method === "string" && msg.id !== undefined && msg.id !== null;
  const isNotification = msg && msg.jsonrpc === "2.0" && typeof msg.method === "string" && (msg.id === undefined || msg.id === null);
  if (isNotification) return { response: null, outbox: [], changed: false };
  if (!isRequest) {
    // A client response (we never send requests) or garbage.
    if (msg && msg.jsonrpc === "2.0" && ("result" in msg || "error" in msg)) return { response: null, outbox: [], changed: false };
    return { response: { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } }, outbox: [], changed: false };
  }
  const reply = (result) => ({ response: { jsonrpc: "2.0", id: msg.id, result }, outbox: [], changed: false });
  const p = msg.params || {};
  switch (msg.method) {
    case "initialize":
      return reply({ protocolVersion: PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: roleOf(ctx).instructions });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: roleOf(ctx).tools });
    case "tools/call": {
      if (!roleOf(ctx).tools.some((t) => t.name === p.name)) {
        return { response: { jsonrpc: "2.0", id: msg.id, error: { code: -32602, message: `Unknown tool: ${p.name}` } }, outbox: [], changed: false };
      }
      const r = ctx.role === "parent" ? callParentTool(state, ctx) : callTool(state, p.name, p.arguments || {}, now);
      // Always persist: even get_trip_status can raise an overdue alert.
      return { response: { jsonrpc: "2.0", id: msg.id, result: r.result }, outbox: r.outbox || [], changed: true };
    }
    default:
      return { response: { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } }, outbox: [], changed: false };
  }
}
