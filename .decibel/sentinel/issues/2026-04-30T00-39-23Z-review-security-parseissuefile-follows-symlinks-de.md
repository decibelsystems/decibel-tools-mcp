---
uid: 019ddbd3-7adb-7d79-8bff-514b297e089f
id: 2026-04-30T00-39-23Z-review-security-parseissuefile-follows-symlinks-de
projectId: decibel-tools-mcp
severity: low
status: open
created_at: 2026-04-30T00:39:23.099Z
---

# [review/security] parseIssueFile follows symlinks (defense-in-depth)

**Severity:** low
**Status:** open

## Details

parseIssueFile uses fs.readFile which follows symlinks. A malicious symlink placed in .decibel/sentinel/issues/ pointing to /etc/passwd or another sensitive file would be read silently (returning null on YAML parse failure, no log).

Currently auth-gated (only daemon writers can place files there) but on shared filesystems with mixed permissions, this could be a privilege-escalation path.

Defense: fs.lstat the file before reading; require S_IFREG (regular file). Reject symlinks, sockets, device files.

Cheap fix:

  const stat = await fs.lstat(filePath);
  if (!stat.isFile()) return null;
  const content = await fs.readFile(filePath, 'utf-8');

Filed during fix/sentinel-epic-issue-relationship review.
