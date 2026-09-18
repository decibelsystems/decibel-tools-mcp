---
uid: 019e573a-cc28-7844-bec6-a57d1ae90edb
id: 2026-05-23T23-45-31Z-sentinel-read-issue-update-issue-ignore-project-id
projectId: decibel-tools-mcp
severity: med
status: open
created_at: 2026-05-23T23:45:31.688Z
---

# sentinel read_issue/update_issue ignore project_id — fail cross-project path resolution (list_issues + create_issue work)

**Severity:** med
**Status:** open

## Details

Reported by decibel-web-hq peer, reproduced from a decibel-agent session. Independent of the daemon port fix (different code path) but same repo — flagged for after the port work lands.

## Symptom
read_issue and update_issue cannot locate an issue that list_issues returns and create_issue just created in the same project.

## Reproduction (from decibel-agent cwd, targeting decibel-tools-mcp)
1. create_issue(project_id="decibel-tools-mcp", ...) → SUCCESS, returned path /Volumes/Ashitaka/Documents/GitHub/decibel-tools-mcp/.decibel/sentinel/issues/2026-05-23T23-32-49Z-daemon-clients-hardcode-port-4888-but-daemon-runs-.md
2. list_issues(project_id="decibel-tools-mcp") → shows that issue ✓
3. read_issue(project_id="decibel-tools-mcp", issue_id="2026-05-23T23-32-49Z-daemon-clients-hardcode-port-4888-but-daemon-runs-.md") → {"success":false,"error":"Issue ... not found in project decibel-tools-mcp"} ✗

decibel-web-hq peer reports the same class with a different symptom: "not found in project Ashitaka" (Ashitaka = the volume/home dir name) even with project_id set — suggesting read/update derive the project from cwd or homedir basename instead of the project_id param.

## Diagnosis
Inconsistent project→issues-dir resolution across sentinel actions: list_issues + create_issue honor the project_id param; read_issue + update_issue do not (they resolve the base path from cwd/homedir, so they look in the wrong .decibel/sentinel/issues directory when project_id != cwd project). Fix: make read_issue/update_issue resolve the project path the same way list_issues/create_issue do (honor project_id), and ensure the resolver never falls back to the volume/home basename.

## Impact
Cross-project issue management is half-broken from any session whose cwd != the target project: you can create and list, but not read, update, or close. Blocks remote/peer issue triage.
