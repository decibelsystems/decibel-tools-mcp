---
id: ISS-0117
projectId: decibel-tools-mcp
severity: med
status: open
created_at: 2026-08-02T02:57:59.296Z
---

# guardian scan_deps counts devDependency advisories, so the pre-push gate blocks on vulns that never ship

**Severity:** med
**Status:** open

## Details

Symptom: after clearing every production dependency advisory (npm audit --omit=dev reports "found 0 vulnerabilities"), `guardian report` still grades D and the pre-push hook still blocks. All 6 remaining advisories are the vitest / vite / esbuild / @vitest-mocker / vite-node devDependency chain.

Those packages are never published: package.json `files` is [dist, templates, README, LICENSE]. A path-traversal advisory in vite or an esbuild dev-server advisory has zero bearing on what a consumer of @decibelsystems/tools installs, yet 2 of them are graded "critical" and dominate the overall grade.

Root cause: scanDeps runs `npm audit` without `--omit=dev` and grades every advisory equally.

Fix direction: run the audit with production and dev scopes separately. Grade on the production set; report the dev set as informational (or a separate dev_grade). Optionally weight by whether `fix_available` is non-breaking.

Second, related observation: `guardian report` as a pre-push gate also grades the http and config sections, which describe the LOCAL daemon posture on the developer's machine (no auth_token configured, no ~/.decibel/config.yaml, no TLS) — not the code being pushed. A push gate should grade the diff/repo, not the operator's local daemon settings. Consider a report(scope: 'repo' | 'runtime') split so the pre-push hook can gate on repo-scoped findings only.

Impact: the gate cannot reach a passing grade through any change to the repository, so every push requires a bypass — which trains people to ignore the gate entirely.

Found while cutting 2.1.5 (merge of origin/main into public/main). Related: ISS-0113 (dependency CVE remediation), ISS-0114 (allowlist not applied in the server process).
