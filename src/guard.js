// Bus Guardian safety core — pure functions over one state object, so the same rules run in
// the Durable Object, in tests, and anywhere else. Ported from School OS busguard.js.
//
// Safety rules (do not weaken):
//   R1  A trip can only finish when everyone who boarded has got off (boarded === got off, > 0).
//   R2  A trip can only finish after the back-seat check: a human walks to the back of the
//       vehicle and reads the code posted there. The code is never returned by any tool.
//   R3  If the back-seat check is still missing 5 minutes after the last child got off -> CRITICAL alert.
//   R4  The scan log is append-only. There is no delete.
// Design rule: the agent may raise alarms freely, but it can never clear one on its own.

export const TAIL_GRACE_MS = 5 * 60 * 1000;

export function emptyState() {
  return { trips: [], scans: [], alerts: [], outbox: [] };
}

function uid(prefix) {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return prefix + Array.from(b, (x) => x.toString(36).padStart(2, "0")).join("").slice(0, 10);
}

// 32 unambiguous characters x 8 = ~1.1 trillion codes. Not derived from the plate (v1 was "TAIL-"+plate).
export function randomTailCode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return "TAIL-" + Array.from(b, (x) => A[x % 32]).join("");
}

export function createTrip(state, o, now = Date.now()) {
  const riders = (o.riders || [])
    .map((r) => ({ id: uid("s"), name: String(r.name || "").trim(), parent: String(r.parent || "").trim() }))
    .filter((r) => r.name);
  if (!riders.length) return { err: "A trip needs at least one rider." };
  const trip = {
    id: uid("t"),
    name: String(o.name || "Field trip").trim(),
    plate: String(o.plate || "").trim(),
    driver: String(o.driver || "").trim(),
    teacher: String(o.teacher || "").trim(),
    tailCode: o.tailCode ? String(o.tailCode).trim().toUpperCase() : randomTailCode(),
    riders,
    status: "ACTIVE",
    allOffAt: 0,
    inspection: null,
    finishedAt: 0,
    createdAt: now,
  };
  state.trips.unshift(trip);
  return { trip };
}

export function findTrip(state, tripId) {
  if (tripId) return state.trips.find((t) => t.id === tripId) || null;
  // Voice-friendly default: the most recent trip that is still running.
  return state.trips.find((t) => t.status === "ACTIVE") || null;
}

// Match a spoken name to exactly one rider. Never guess between two children.
export function matchRider(trip, spoken) {
  const q = String(spoken || "").trim().toLowerCase();
  if (!q) return { err: "No name given." };
  const exact = trip.riders.filter((r) => r.name.toLowerCase() === q);
  if (exact.length === 1) return { rider: exact[0] };
  const partial = trip.riders.filter((r) => r.name.toLowerCase().split(/\s+/).includes(q) || r.name.toLowerCase().includes(q));
  if (partial.length === 1) return { rider: partial[0] };
  if (!partial.length) return { err: `No rider named "${spoken}" on this trip.` };
  return { err: `More than one rider matches "${spoken}": ${partial.map((r) => r.name).join(", ")}. Say the full name.`, candidates: partial.map((r) => r.name) };
}

export function recordScan(state, trip, riderId, type, src = "manual", now = Date.now()) {
  if (trip.status !== "ACTIVE") return { err: "This trip is already finished." };
  if (type !== "BOARD" && type !== "ALIGHT") return { err: "Scan type must be BOARD or ALIGHT." };
  if (!trip.riders.some((r) => r.id === riderId)) return { err: "That child is not on this trip's rider list." };
  const scan = { id: uid("x"), tripId: trip.id, riderId, type, src, at: now };
  state.scans.push(scan); // R4: append-only
  const c = counts(state, trip);
  if (!trip.allOffAt && c.boarded > 0 && c.boarded === c.gotOff) trip.allOffAt = now;
  if (trip.allOffAt && c.onBoard.length) trip.allOffAt = 0; // someone re-boarded
  return { scan };
}

// Latest scan per child decides where they are.
export function counts(state, trip) {
  const last = {};
  for (const s of state.scans) if (s.tripId === trip.id) last[s.riderId] = s.type;
  const boardedIds = trip.riders.filter((r) => last[r.id]).map((r) => r.id);
  const onBoard = trip.riders.filter((r) => last[r.id] === "BOARD").map((r) => r.name);
  const gotOff = trip.riders.filter((r) => last[r.id] === "ALIGHT").length;
  const neverBoarded = trip.riders.filter((r) => !last[r.id]).map((r) => r.name);
  return { total: trip.riders.length, boarded: boardedIds.length, gotOff, onBoard, neverBoarded };
}

export function canFinish(state, trip) {
  const c = counts(state, trip);
  const blockers = [];
  if (c.boarded === 0) blockers.push("No child has boarded yet.");
  if (c.onBoard.length) blockers.push(`Still on board: ${c.onBoard.join(", ")}.`);
  if (!trip.inspection) blockers.push("The back-seat check has not been done.");
  return { ok: blockers.length === 0, blockers };
}

export function confirmBackSeatCheck(state, trip, code, by, now = Date.now()) {
  if (trip.status !== "ACTIVE") return { err: "This trip is already finished." };
  const c = counts(state, trip);
  if (c.boarded === 0 || c.onBoard.length) {
    return { err: `Not everyone is off yet (${c.onBoard.length} still on board). Do the back-seat check after the last child gets off.` };
  }
  if (String(code || "").trim().toUpperCase().replace(/\s+/g, "") !== trip.tailCode.replace(/\s+/g, "")) {
    return { err: "That code does not match the one posted at the back of this vehicle. Walk to the back and read it again." };
  }
  trip.inspection = { at: now, by: String(by || "").trim() || "unknown" };
  resolveAlerts(state, trip.id, "NO_BACK_SEAT_CHECK", now);
  return { ok: true };
}

export function finishTrip(state, trip, now = Date.now()) {
  if (trip.status !== "ACTIVE") return { err: "This trip is already finished." };
  const f = canFinish(state, trip);
  if (!f.ok) return { err: "Cannot finish the trip yet.", blockers: f.blockers };
  trip.status = "FINISHED";
  trip.finishedAt = now;
  return { ok: true };
}

// Pure check: what should be alarming right now?
export function dueAlerts(state, now = Date.now()) {
  const out = [];
  for (const t of state.trips) {
    if (t.status !== "ACTIVE") continue;
    if (t.allOffAt && !t.inspection && now - t.allOffAt > TAIL_GRACE_MS) {
      out.push({ tripId: t.id, type: "NO_BACK_SEAT_CHECK", level: "CRITICAL",
        text: `${t.plate || t.name}: everyone scanned off ${Math.round((now - t.allOffAt) / 60000)} min ago, but nobody has done the back-seat check.` });
    }
  }
  return out;
}

// Store new alerts once (no duplicates while an alert of the same type is still open).
export function raiseAlerts(state, found, now = Date.now()) {
  const fresh = [];
  for (const f of found) {
    if (state.alerts.some((a) => a.tripId === f.tripId && a.type === f.type && !a.resolvedAt)) continue;
    const a = { id: uid("a"), ...f, at: now, resolvedAt: 0 };
    state.alerts.push(a);
    fresh.push(a);
  }
  return fresh;
}

export function resolveAlerts(state, tripId, type, now = Date.now()) {
  for (const a of state.alerts) if (a.tripId === tripId && a.type === type && !a.resolvedAt) a.resolvedAt = now;
}

// Notify the teacher, and the parent of every child still on board. Stored in the outbox;
// index.js also delivers it to a webhook (e.g. LINE) when one is configured.
export function escalate(state, trip, reason, now = Date.now()) {
  const c = counts(state, trip);
  const msgs = [];
  const head = `Bus Guardian alert - ${trip.name}${trip.plate ? " (" + trip.plate + ")" : ""}: ${reason}`;
  msgs.push({ to: trip.teacher || "teacher", role: "teacher", text: `${head} Still on board: ${c.onBoard.join(", ") || "none"}.` });
  for (const r of trip.riders) {
    if (c.onBoard.includes(r.name)) {
      msgs.push({ to: r.parent || `parent of ${r.name}`, role: "parent", text: `${head} Our records show ${r.name} has not been scanned off the vehicle yet. The teacher is checking now.` });
    }
  }
  for (const m of msgs) state.outbox.push({ id: uid("m"), tripId: trip.id, at: now, ...m });
  raiseAlerts(state, [{ tripId: trip.id, type: "ESCALATED", level: "CRITICAL", text: head }], now);
  return msgs;
}

// What a voice agent should say. Short, specific, names first.
export function summary(state, trip) {
  const c = counts(state, trip);
  const open = state.alerts.filter((a) => a.tripId === trip.id && !a.resolvedAt);
  return {
    trip_id: trip.id,
    trip: trip.name,
    vehicle: trip.plate,
    status: trip.status,
    riders_total: c.total,
    boarded: c.boarded,
    got_off: c.gotOff,
    still_on_board: c.onBoard,
    never_boarded: c.neverBoarded,
    back_seat_check: trip.inspection ? `done by ${trip.inspection.by} at ${new Date(trip.inspection.at).toISOString()}` : "not done",
    can_finish: canFinish(state, trip),
    open_alerts: open.map((a) => ({ type: a.type, level: a.level, text: a.text })),
  };
}

// Public view for the dashboard: everything except the tail code.
export function publicTrip(trip) {
  const { tailCode, ...rest } = trip;
  return rest;
}
