import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

// Audit the tool names this repo's own server advertises (ADR-0001).
//
// This used to name one developer's absolute paths — a /usr/local/bin/node and
// two files under a DIFFERENT project's checkout — so it ran nowhere but that
// machine, and pointed at the wrong server even there. Defaults now resolve to
// this repo; pass another entry point to audit something else.
//
//   node mcp_check_tools.mjs                      # this repo's dist/server.js
//   node mcp_check_tools.mjs path/to/server.js    # some other build
//   node mcp_check_tools.mjs npx tsx src/x.ts     # an arbitrary command
const repoRoot = join(dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);

const [command, args] = argv.length > 1
  ? [argv[0], argv.slice(1)]
  : [process.execPath, [argv[0] ?? join(repoRoot, "dist", "server.js")]];

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
