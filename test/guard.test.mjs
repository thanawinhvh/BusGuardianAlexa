// npm test  — runs the whole safety story through the MCP handler, no server needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as G from "../src/guard.js";
import { handleMessage, TOOLS, PROTOCOL_VERSION } from "../src/mcp.js";

let id = 0;
const call = (state, name, args, now) => {
  const r = handleMessage(state, { jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }, now);
  return { ...r.response.result, outbox: r.outbox };
};

function demo() {
  const state = G.emptyState();
  G.createTrip(state, { name: "Zoo trip", plate: "Van 2", teacher: "Teacher Earn", tailCode: "TAIL-ABCD2345",
    riders: [{ name: "Mint", parent: "Mint's mom" }, { name: "Bank", parent: "Bank's dad" }, { name: "Nong Kao", parent: "Kao's mom" }] });
  return state;
}

test("initialize + tools/list follow MCP 2025-11-25", () => {
  const s = G.emptyState();
  const init = handleMessage(s, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "t", version: "1" } } });
  assert.equal(init.response.result.protocolVersion, "2025-11-25");
  assert.ok(init.response.result.capabilities.tools);
  assert.equal(handleMessage(s, { jsonrpc: "2.0", method: "notifications/initialized" }).response, null);
  const list = handleMessage(s, { jsonrpc: "2.0", id: 2, method: "tools/list" }).response.result.tools;
  assert.deepEqual(list.map((t) => t.name), TOOLS.map((t) => t.name));
  assert.equal(handleMessage(s, { jsonrpc: "2.0", id: 3, method: "nope" }).response.error.code, -32601);
});

test("R1+R2: cannot finish while a child is on board, nor before the back-seat check", () => {
  const s = demo();
  for (const n of ["Mint", "Bank", "Nong Kao"]) assert.ok(!call(s, "record_scan", { child_name: n, event: "boarded" }).isError);
  call(s, "record_scan", { child_name: "Mint", event: "got_off" });
  call(s, "record_scan", { child_name: "Bank", event: "got_off" });

  const st = call(s, "get_trip_status", {}).structuredContent;
  assert.deepEqual(st.still_on_board, ["Nong Kao"]);

  const fin = call(s, "finish_trip", {});
  assert.equal(fin.isError, true);
  assert.match(fin.structuredContent.blockers.join(" "), /Nong Kao/);

  // Back-seat check is refused while someone is still on board.
  assert.equal(call(s, "confirm_back_seat_check", { code: "TAIL-ABCD2345", checked_by: "Somchai" }).isError, true);

  call(s, "record_scan", { child_name: "kao", event: "got_off" }); // partial name, unique -> ok
  assert.equal(call(s, "finish_trip", {}).isError, true, "R2: still needs the back-seat check");
  assert.equal(call(s, "confirm_back_seat_check", { code: "TAIL-WRONG111", checked_by: "Somchai" }).isError, true);
  assert.ok(!call(s, "confirm_back_seat_check", { code: "tail-abcd2345", checked_by: "Somchai" }).isError);
  assert.ok(!call(s, "finish_trip", {}).isError);
});

test("never guesses between two children with similar names", () => {
  const s = G.emptyState();
  G.createTrip(s, { riders: [{ name: "Mint A" }, { name: "Mint B" }] });
  const r = call(s, "record_scan", { child_name: "Mint", event: "boarded" });
  assert.equal(r.isError, true);
  assert.deepEqual(r.structuredContent.candidates, ["Mint A", "Mint B"]);
});

test("R3: overdue back-seat check raises one CRITICAL alert; escalation reaches teacher + parents of children on board", () => {
  const s = demo();
  const t0 = 1_000_000;
  for (const n of ["Mint", "Bank", "Nong Kao"]) call(s, "record_scan", { child_name: n, event: "boarded" }, t0);
  for (const n of ["Mint", "Bank", "Nong Kao"]) call(s, "record_scan", { child_name: n, event: "got_off" }, t0 + 1000);
  assert.equal(G.dueAlerts(s, t0 + 60_000).length, 0);
  const due = G.dueAlerts(s, t0 + 1000 + G.TAIL_GRACE_MS + 1);
  assert.equal(due.length, 1);
  assert.equal(G.raiseAlerts(s, due).length, 1);
  assert.equal(G.raiseAlerts(s, due).length, 0, "no duplicate while open");

  const s2 = demo();
  call(s2, "record_scan", { child_name: "Nong Kao", event: "boarded" });
  const r = call(s2, "alert_teacher_and_parents", { reason: "Van is back at school but Kao was not scanned off." });
  assert.deepEqual(r.outbox.map((m) => m.to).sort(), ["Kao's mom", "Teacher Earn"]);
});

test("the back-seat code never leaks through tools or the public view", () => {
  const s = demo();
  const everything = JSON.stringify([
    call(s, "get_trip_status", {}), call(s, "list_trips", {}),
    call(s, "create_trip", { riders: [{ name: "X" }] }), G.publicTrip(s.trips[1]),
  ]);
  assert.ok(!everything.includes("TAIL-ABCD2345"));
  assert.ok(!everything.includes(s.trips[0].tailCode));
});

test("scan log is append-only", () => {
  const s = demo();
  call(s, "record_scan", { child_name: "Mint", event: "boarded" });
  call(s, "record_scan", { child_name: "Mint", event: "got_off" });
  call(s, "record_scan", { child_name: "Mint", event: "boarded" });
  assert.equal(s.scans.length, 3);
  assert.deepEqual(call(s, "get_trip_status", {}).structuredContent.still_on_board, ["Mint"]);
});
