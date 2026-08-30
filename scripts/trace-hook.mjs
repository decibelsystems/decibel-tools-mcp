let port = null;
export function initialize(data) { port = data.port; }
export async function resolve(spec, ctx, next) {
  const r = await next(spec, ctx);
  if (port) { try { port.postMessage(r.url); } catch {} }
  return r;
}
