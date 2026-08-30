// ESM loader hook: records every module a process actually resolves.
// Registered via --import; writes to $TRACE_MODULES_OUT.
//   TRACE_MODULES_OUT=/tmp/t.txt node --import ./scripts/trace-modules.mjs dist/server.js --thin
import { register } from 'module';
import { appendFileSync } from 'fs';
import { pathToFileURL } from 'url';

const out = process.env.TRACE_MODULES_OUT;
if (out) {
  const { port1, port2 } = new MessageChannel();
  port1.on('message', url => { try { appendFileSync(out, url + '\n'); } catch {} });
  port1.unref();
  register(pathToFileURL(new URL('./trace-hook.mjs', import.meta.url).pathname), {
    parentURL: import.meta.url,
    data: { port: port2 },
    transferList: [port2],
  });
}
