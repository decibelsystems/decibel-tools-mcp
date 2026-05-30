#!/usr/bin/env python3
# ----------------------------------------------------------------------------
# Repair tool for the sentinel log_epic char-per-line corruption.
# Vendored from the machina peer's repair script (with thanks). Tracks bug
# 2026-05-25T15-16-24Z in decibel-tools-mcp.
#
# Detect:  grep -cE '^- .$' .decibel/sentinel/epics/*.md
#          (any nonzero = that epic's Motivation/Outcomes/Acceptance sections
#           are garbled; frontmatter + Summary are unaffected.)
# Repair:  python3 scripts/repair-epics.py .decibel/sentinel/epics/EPIC-*.md
#
# Lossless: each garbled `## ` section body is a char-by-char split of the
# original JSON array; concatenating the single chars reconstructs the JSON
# string and json.loads yields the original list. The decoder preserves the
# original list style (plain `- ` or checkbox `- [ ] `).
# ----------------------------------------------------------------------------
"""
Decoder for log_epic char-per-line corruption.

Each garbled section body is a sequence of `- X` (or `- [ ] X`) lines where
the original JSON-array string was iterated char-by-char. Concatenating the
single chars reconstructs the JSON string; parsing it yields the original list.
Frontmatter + Summary are intact (per decibel-tools-mcp peer).
"""
import re
import json
import sys
from pathlib import Path

CHECKBOX = re.compile(r"^- \[ \] (.)$")
PLAIN    = re.compile(r"^- (.)$")

def try_decode(body_lines):
    """Return (items, is_checkbox) if this body is garbled, else (None, False)."""
    chars = []
    is_checkbox = False
    n = 0
    for line in body_lines:
        if line.strip() == "":
            continue
        m = CHECKBOX.match(line)
        if m:
            chars.append(m.group(1))
            is_checkbox = True
            n += 1
            continue
        m = PLAIN.match(line)
        if m:
            chars.append(m.group(1))
            n += 1
            continue
        # any non-matching line means this is not the pure char-split pattern
        return None, False
    # Soft floor: a valid `["X"]` is 5 chars; an empty `[]` would only be 2 lines
    # and wouldn't trip the detect grep meaningfully anyway.
    if n < 4:  # need at least `["X"]` worth of chars
        return None, False
    joined = "".join(chars)
    try:
        items = json.loads(joined)
        if isinstance(items, list):
            return items, is_checkbox
    except Exception:
        return None, False
    return None, False

def repair_file(path):
    lines = Path(path).read_text().split("\n")
    out = []
    repairs = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("## "):
            header = line
            j = i + 1
            while j < len(lines) and not lines[j].startswith("## "):
                j += 1
            body = lines[i+1:j]
            if header.strip() != "## Summary":
                items, is_checkbox = try_decode(body)
                if items is not None:
                    out.append(header)
                    out.append("")
                    prefix = "- [ ] " if is_checkbox else "- "
                    for it in items:
                        out.append(f"{prefix}{it}")
                    out.append("")
                    repairs.append((header.strip(), len(items), "checkbox" if is_checkbox else "plain"))
                    i = j
                    continue
            out.append(header)
            out.extend(body)
            i = j
            continue
        out.append(line)
        i += 1
    return "\n".join(out), repairs

def main():
    files = sys.argv[1:]
    if not files:
        print("usage: repair_epics.py FILE [FILE ...]", file=sys.stderr)
        sys.exit(1)
    for f in files:
        print(f"\n=== {f} ===")
        new_text, repairs = repair_file(f)
        if not repairs:
            print("  (no garbled sections detected)")
            continue
        for header, n, kind in repairs:
            print(f"  repaired {header}: {n} items ({kind})")
        Path(f).write_text(new_text)
        print("  written.")

if __name__ == "__main__":
    main()
