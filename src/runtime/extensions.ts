// ============================================================================
// Extension Loader — EPIC-0038 Phase 7
// ============================================================================
// Private facades are not compiled into the published package. They arrive at
// boot as extensions: modules named by absolute path in an allowlist under
// ~/.decibel/config.yaml, registered into the same registry core facades use.
//
// The security model is registration, not permission. A facade that was never
// registered cannot be dispatched to, cannot appear in tools/list, and cannot
// be reached by a name-prefix trick — there is nothing on the other end. That
// is a stronger guarantee than a runtime tier check, which is one missed branch
// away from failing open. It replaces the DECIBEL_APPS env gate, which had the
// opposite failure mode: the flag lived in a launchd plist, so regenerating the
// plist silently dropped four facades with no error anywhere.
//
// TRUST BOUNDARY — read before changing anything here.
// An extension runs in-process with the runtime's full filesystem and database
// access. There is no sandbox and this loader does not pretend to be one. The
// allowlist is what makes that proportionate: for single-user private use,
// "the owner named this exact file" is a real boundary. It stops being one the
// moment a path can come from somewhere other than the owner's config, so:
//
//   - Only absolute paths are accepted. A bare specifier ("senken") would be
//     resolved by Node against node_modules, which makes the allowlist
//     decorative — anything that can write a package into the tree chooses
//     what runs.
//   - The path is never read from the environment. Config file only.
//   - An extension may not shadow an already-registered facade name.
// ============================================================================

import { existsSync } from 'fs';
import { isAbsolute, normalize } from 'path';
import { pathToFileURL } from 'url';
import type { FacadeSpec } from '../facades/types.js';
import type { ToolSpec } from '../tools/types.js';
import { loadConfig } from '../daemonConfig.js';
import { log } from '../config.js';
import { RUNTIME_PROTOCOL_VERSION, isProtocolCompatible } from './protocol.js';

// ============================================================================
// Types
// ============================================================================

export interface DecibelExtensionManifest {
  /** Facade-style identifier, e.g. "senken". Must not collide with a core facade. */
  name: string;
  /** The extension's own version, independent of the runtime's. */
  version: string;
  /** Runtime wire contract this extension was built against. See protocol.ts. */
  protocolVersion: string;
  /** Extensions are never core — core is what ships in the package. */
  tier: 'pro' | 'apps';
}

export interface DecibelExtension {
  manifest: DecibelExtensionManifest;
  facades: FacadeSpec[];
  tools: ToolSpec[];
}

export interface RejectedExtension {
  /** The allowlist entry as written, so the owner can find it in their config. */
  entry: string;
  reason: string;
}

export interface ExtensionLoadResult {
  extensions: DecibelExtension[];
  facades: FacadeSpec[];
  tools: ToolSpec[];
  rejected: RejectedExtension[];
}

const EMPTY_RESULT: ExtensionLoadResult = {
  extensions: [],
  facades: [],
  tools: [],
  rejected: [],
};

/** Facade names must look like facade names — this is also what the kernel keys on. */
const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

// ============================================================================
// Manifest validation
// ============================================================================

function validateManifest(value: unknown): { ok: true; manifest: DecibelExtensionManifest } | { ok: false; reason: string } {
  if (!value || typeof value !== 'object') {
    return { ok: false, reason: 'manifest is missing or not an object' };
  }
  const m = value as Record<string, unknown>;

  if (typeof m.name !== 'string' || !NAME_PATTERN.test(m.name)) {
    return { ok: false, reason: `manifest.name must match ${NAME_PATTERN} (got ${JSON.stringify(m.name)})` };
  }
  if (typeof m.version !== 'string' || m.version.length === 0) {
    return { ok: false, reason: 'manifest.version must be a non-empty string' };
  }
  if (m.tier !== 'pro' && m.tier !== 'apps') {
    return { ok: false, reason: `manifest.tier must be "pro" or "apps" (got ${JSON.stringify(m.tier)}) — "core" is what ships in the package, so it cannot be an extension` };
  }
  if (typeof m.protocolVersion !== 'string') {
    return { ok: false, reason: 'manifest.protocolVersion must be a string' };
  }

  // The extension is a client of the runtime's wire contract, so the runtime is
  // the "server" side of the comparison. A stale extension fails here with a
  // version mismatch rather than later with a missing endpoint.
  const compat = isProtocolCompatible(RUNTIME_PROTOCOL_VERSION, m.protocolVersion);
  if (!compat.compatible) {
    return { ok: false, reason: `protocol mismatch — ${compat.reason}` };
  }

  return {
    ok: true,
    manifest: {
      name: m.name,
      version: m.version,
      protocolVersion: m.protocolVersion,
      tier: m.tier,
    },
  };
}

function validateShape(value: unknown): { ok: true; extension: DecibelExtension } | { ok: false; reason: string } {
  if (!value || typeof value !== 'object') {
    return { ok: false, reason: 'module does not export `extension`' };
  }
  const ext = value as Record<string, unknown>;

  const manifestResult = validateManifest(ext.manifest);
  if (!manifestResult.ok) return manifestResult;

  if (!Array.isArray(ext.facades) || ext.facades.length === 0) {
    return { ok: false, reason: 'extension.facades must be a non-empty array' };
  }
  if (!Array.isArray(ext.tools) || ext.tools.length === 0) {
    return { ok: false, reason: 'extension.tools must be a non-empty array' };
  }

  const manifest = manifestResult.manifest;

  // Every facade the extension declares must carry the manifest's tier. An
  // extension cannot smuggle a facade in at a laxer tier than it was allowed at.
  for (const facade of ext.facades as FacadeSpec[]) {
    if (!facade || typeof facade.name !== 'string' || !NAME_PATTERN.test(facade.name)) {
      return { ok: false, reason: 'every entry in extension.facades must be a FacadeSpec with a valid name' };
    }
    if (facade.tier !== manifest.tier) {
      return {
        ok: false,
        reason: `facade "${facade.name}" declares tier "${facade.tier}" but the manifest declares "${manifest.tier}"`,
      };
    }
  }

  return { ok: true, extension: ext as unknown as DecibelExtension };
}

// ============================================================================
// Allowlist
// ============================================================================

/**
 * Read the extension allowlist from ~/.decibel/config.yaml.
 *
 * Deliberately config-only. Reading a path from the environment would let
 * anything that can set an env var — a plist, a shell profile, a parent
 * process — choose code that runs in-process with full access, which is
 * exactly the property the allowlist exists to provide.
 */
export function readAllowlist(): string[] {
  const config = loadConfig();
  const entries = config.extensions?.allow;
  if (!Array.isArray(entries)) return [];
  return entries.filter((e): e is string => typeof e === 'string');
}

/** Path rules, split out so the test suite can exercise them without a filesystem. */
export function checkAllowlistEntry(entry: string): { ok: true; path: string } | { ok: false; reason: string } {
  const trimmed = entry.trim();

  if (trimmed.length === 0) {
    return { ok: false, reason: 'empty allowlist entry' };
  }
  if (!isAbsolute(trimmed)) {
    return {
      ok: false,
      reason: 'not an absolute path — a bare specifier would be resolved against node_modules, which makes the allowlist decorative',
    };
  }

  // normalize() collapses any ".." segments. Compare against the original so a
  // path that only *looks* like the allowed one is rejected rather than quietly
  // rewritten into something else.
  const normalized = normalize(trimmed);
  if (normalized !== trimmed) {
    return { ok: false, reason: `path is not normalized (resolves to ${normalized})` };
  }

  return { ok: true, path: normalized };
}

// ============================================================================
// Loader
// ============================================================================

/**
 * Load every allowlisted extension.
 *
 * Never throws. A broken extension is reported in `rejected` and the runtime
 * boots without it — one bad private module must not take down core. Callers
 * that care (the daemon's startup log, /health) surface the rejections.
 *
 * @param reservedNames Facade names already registered. An extension may not
 *   shadow one; that would let a private module silently replace `sentinel`.
 */
export async function loadExtensions(reservedNames: ReadonlySet<string> = new Set()): Promise<ExtensionLoadResult> {
  const entries = readAllowlist();
  if (entries.length === 0) return EMPTY_RESULT;

  const extensions: DecibelExtension[] = [];
  const facades: FacadeSpec[] = [];
  const tools: ToolSpec[] = [];
  const rejected: RejectedExtension[] = [];
  const claimed = new Set(reservedNames);

  for (const entry of entries) {
    const pathCheck = checkAllowlistEntry(entry);
    if (!pathCheck.ok) {
      rejected.push({ entry, reason: pathCheck.reason });
      continue;
    }
    if (!existsSync(pathCheck.path)) {
      rejected.push({ entry, reason: 'file does not exist' });
      continue;
    }

    let mod: Record<string, unknown>;
    try {
      mod = (await import(pathToFileURL(pathCheck.path).href)) as Record<string, unknown>;
    } catch (error) {
      rejected.push({ entry, reason: `import failed — ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }

    const shape = validateShape(mod.extension);
    if (!shape.ok) {
      rejected.push({ entry, reason: shape.reason });
      continue;
    }

    const extension = shape.extension;
    const collision = extension.facades.find(f => claimed.has(f.name));
    if (collision) {
      rejected.push({ entry, reason: `facade "${collision.name}" is already registered — an extension may not shadow it` });
      continue;
    }

    for (const facade of extension.facades) claimed.add(facade.name);
    extensions.push(extension);
    facades.push(...extension.facades);
    tools.push(...extension.tools);
  }

  for (const r of rejected) {
    log(`Extensions: rejected ${r.entry} — ${r.reason}`);
  }
  if (extensions.length > 0) {
    const names = extensions.map(e => `${e.manifest.name}@${e.manifest.version}`).join(', ');
    log(`Extensions: loaded ${extensions.length} (${names}) — ${facades.length} facades, ${tools.length} tools`);
  }

  return { extensions, facades, tools, rejected };
}
