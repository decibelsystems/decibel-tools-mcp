---
uid: 01a0bc47-c0f9-7121-9789-356f4124e9ea
id: ISS-0179
projectId: decibel-tools-mcp
severity: high
status: open
priority: high
tags:
  - daemon-discovery
  - hooks
  - silent-wrong-answer
  - machine-global
  - found-in-session
created_at: 2026-09-20T00:46:54.201Z
---
# Any --http run hijacks machine-global daemon discovery, and a stale entry is never detected

**Severity:** high
**Status:** open

## Details

SYMPTOM. Every hook on this machine silently stopped working, and nothing said so.
A `git commit` with a `Closes: ISS-0168` trailer did not close the issue. The hook
printed `{}` and exited 0, which is indistinguishable from "nothing to do".

CAUSE. httpServer.ts:2457, inside httpServer.listen(), calls setDaemonPort(port)
unconditionally — so ANY `--http` run advertises itself in ~/.decibel/daemon.meta,
not just `--daemon`. The file is machine-global discovery: the session-init hook,
the issue-close hook, the HQ client (hq/defineAgent.ts:34) and ensureRuntime all
read the port from it.

I started a throwaway server on port 4899 to verify a fix against the built
artifact. It rewrote daemon.meta to {"port":4899,"pid":39878}. Killing it left
that entry behind. From then on every hook resolved port 4899 — a port nothing
was listening on — and the real daemon sat on 4888 untouched.

    $ cat ~/.decibel/daemon.meta
    {"started_at":"...","crash_count":0,"port":4899,"pid":39878}

    hook trace:
    + curl ... http://localhost:4899/batch ...
    + RESP=
    + MSG=
    (exit 0, prints {})

TWO DEFECTS, and the second is the worse one:

1. A non-daemon `--http` run claims machine-global discovery. Advertising is the
   daemon's job — that is what `--daemon` means. A plain `--http` server is a
   process someone started for a reason of their own, including CI, tests, and
   the hosted deployment (senken.pro runs this repo under gunicorn).

2. Nothing removes a stale entry, and no reader validates one. daemon.meta
   carries the pid that wrote it, so a reader can check whether that process is
   still alive before trusting the port, and a writer can decline to overwrite an
   entry whose pid IS alive. Neither happens. The failure is silent at every
   layer: curl gets connection-refused, the hook treats empty output as "no
   issues to close", and the user sees a successful commit.

CONSEQUENCE. Anyone who runs the server on a second port for any reason — a test,
a second checkout, a port conflict, a demo — silently disables the completion
ritual, the session-init digest, and HQ's daemon discovery for every Claude
instance on that machine, for as long as it takes someone to notice that hooks
stopped firing. There is no error anywhere.

SUGGESTED FIX.
- Only advertise when the process IS the daemon (`--daemon`), or behind an
  explicit `--advertise` flag. `--http` alone should not touch daemon.meta.
- On the read side, treat an entry whose pid is dead as absent and fall back to
  the default port rather than dialling a dead one.
- A writer should refuse to overwrite an entry whose pid is alive and is not
  itself, or at minimum log loudly that it is taking over discovery.
- Remove the entry on graceful shutdown when we wrote it.

FOUND while fixing ISS-0168, by the fix's own verification step — the hook went
quiet on the very commit that fixed the hook. Repaired by hand for now:
daemon.meta put back to port 4888 / pid 1002.
