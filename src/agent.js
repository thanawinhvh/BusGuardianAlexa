// Simulated Alexa+ agent: Claude decides which Bus Guardian tools to call, and every call goes
// through the MCP JSON-RPC handler (tools/call) — the same code path a remote MCP client hits.
// Manual loop (not the SDK tool runner) because tools execute through our own MCP transport
// inside the Durable Object.
import Anthropic from "@anthropic-ai/sdk";
import { TOOLS, INSTRUCTIONS, handleMessage } from "./mcp.js";

const SYSTEM = `You are Alexa+, a voice assistant for a school's teachers and van drivers, with the Bus Guardian skill.
${INSTRUCTIONS}
- Earlier assistant turns may end with "[tools used this turn: ...]". That is a record of what really ran; never repeat it in your reply and never contradict it.
- Answer in the language the person used (English or Thai). In Thai, sound like a polite woman: use ค่ะ/คะ, short spoken sentences, and write numbers as Thai words (หกคน, ห้าคน) because the voice reads digits badly. Keep child names exactly as on the roster (the roster may be in English: map Thai spellings such as มิ้นท์ → Mint, and pass the roster name to tools).
- Your reply is spoken aloud: one or two short sentences, plain words, no markdown, no lists, no IDs.`;

const tools = TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
const MAX_STEPS = 8;

// history: [{ role: "user" | "assistant", content: string }] — text turns only, appended in order.
export async function runAgent({ apiKey, model, history, state }) {
  const client = new Anthropic({ apiKey });
  const messages = history.map((m) => ({ role: m.role, content: String(m.content) }));
  const trace = [];
  const outbox = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await client.beta.messages.create({
      model: model || "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "low" }, // short spoken answers; raise if tool choice gets sloppy
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default", // a policy decline is retried server-side on a fallback model
      system: SYSTEM,
      tools,
      messages,
    });

    if (response.stop_reason === "refusal") {
      return { reply: "Sorry, I can't help with that one.", trace, outbox };
    }
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }

    const calls = response.content.filter((b) => b.type === "tool_use");
    if (!calls.length) {
      const reply = response.content.filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
      // memo goes back into the chat history so the next turn remembers which tools actually ran
      const acts = trace.map((t) => `${t.tool}(${JSON.stringify(t.arguments)})${t.isError ? " refused" : ""}`).join("; ");
      return { reply: reply || "Done.", memo: (reply || "Done.") + (acts ? ` [tools used this turn: ${acts}]` : ""), trace, outbox };
    }

    messages.push({ role: "assistant", content: response.content }); // verbatim, incl. thinking blocks
    const results = [];
    for (const call of calls) {
      const rpc = { jsonrpc: "2.0", id: call.id, method: "tools/call", params: { name: call.name, arguments: call.input || {} } };
      const r = handleMessage(state, rpc);
      const result = r.response.result || { content: [{ type: "text", text: r.response.error?.message || "Tool error" }], isError: true };
      outbox.push(...r.outbox);
      trace.push({ tool: call.name, arguments: call.input || {}, isError: !!result.isError, result: result.structuredContent ?? null });
      results.push({ type: "tool_result", tool_use_id: call.id, content: result.content[0].text, is_error: !!result.isError });
    }
    messages.push({ role: "user", content: results }); // all results in one message
  }
  return { reply: "I'm still checking. Please look at the dashboard.", trace, outbox };
}
