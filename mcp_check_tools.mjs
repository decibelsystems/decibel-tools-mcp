import { spawn } from "node:child_process";

const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

// EDIT THESE to match your Claude MCP server entry
const command = "/usr/local/bin/node";
const args = [
  "/Users/ben/decibel-designer/node_modules/.bin/tsx",
  "/Users/ben/decibel-designer/src/server.ts",
];

const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });

child.stderr.on("data", (d) => process.stderr.write(d));

let buf = "";
let id = 1;
const pending = new Map();

child.stdout.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;

    let msg;
    try { msg = JSON.parse(line); } catch { continue; }

    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      (msg.error ? reject : resolve)(msg);
    }
  }
});

function rpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    const req = { jsonrpc: "2.0", id: id++, method, params };
    pending.set(req.id, { resolve, reject });
    child.stdin.write(JSON.stringify(req) + "\n");
  });
}

(async () => {
  try {
    await rpc("initialize", {
      protocolVersion: "2024-11-05",
      clientInfo: { name: "mcp-name-audit", version: "0.0.1" },
      capabilities: {},
    });

    const resp = await rpc("tools/list", {});
    const tools = resp?.result?.tools ?? [];

    const bad = tools
      .map((t) => t?.name)
      .filter((n) => typeof n === "string" && !NAME_RE.test(n));

    console.log(`TOOLS: ${tools.length}`);
    if (!bad.length) {
      console.log("✅ All tool names valid.");
    } else {
      console.log("❌ Invalid tool names:");
      for (const n of bad) console.log("  -", JSON.stringify(n));
      process.exitCode = 2;
    }
  } catch (e) {
    console.error("Error:", e?.error ?? e);
    process.exitCode = 1;
  } finally {
    child.kill();
  }
})();
