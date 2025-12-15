#!/usr/bin/env python3
"""Check Experiment: MCP Tool Registration Validator

Proposal: DOJO-PROP-0001
Experiment: DOJO-EXP-0001

Validates that all MCP tool definitions in ListToolsRequestSchema have
corresponding handlers in CallToolRequestSchema, and vice versa.

Run with:
    decibel dojo run DOJO-EXP-0001
"""

import json
import os
import re
import sys
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import List, Set, Tuple


@dataclass
class Violation:
    """A check violation."""
    rule_id: str
    file: str
    line: int
    column: int
    message: str
    severity: str = "warning"  # error, warning, info
    snippet: str = ""


def extract_tool_definitions(content: str) -> Set[str]:
    """Extract tool names from ListToolsRequestSchema handler."""
    tools = set()
    # Match patterns like: name: 'tool_name' or name: "tool_name"
    pattern = r"name:\s*['\"]([^'\"]+)['\"]"

    # Find the ListToolsRequestSchema section
    list_match = re.search(r'ListToolsRequestSchema.*?tools:\s*\[', content, re.DOTALL)
    if not list_match:
        return tools

    # Find the end of the tools array (matching closing bracket)
    start = list_match.end()
    bracket_count = 1
    end = start
    for i, char in enumerate(content[start:]):
        if char == '[':
            bracket_count += 1
        elif char == ']':
            bracket_count -= 1
            if bracket_count == 0:
                end = start + i
                break

    tools_section = content[start:end]

    for match in re.finditer(pattern, tools_section):
        tools.add(match.group(1))

    return tools


def extract_case_handlers(content: str) -> Set[str]:
    """Extract case labels from CallToolRequestSchema handler."""
    handlers = set()

    # Match patterns like: case 'tool_name': or case "tool_name":
    pattern = r"case\s+['\"]([^'\"]+)['\"]:"

    # Find the CallToolRequestSchema section
    call_match = re.search(r'CallToolRequestSchema.*?switch\s*\(', content, re.DOTALL)
    if not call_match:
        return handlers

    # Find content after the switch
    start = call_match.end()

    # Extract case statements from switch block
    for match in re.finditer(pattern, content[start:]):
        handlers.add(match.group(1))

    return handlers


def find_line_number(content: str, tool_name: str, section: str) -> int:
    """Find the line number where a tool is defined/handled."""
    lines = content.split('\n')
    pattern = f"['\"]?{re.escape(tool_name)}['\"]?"

    in_section = False
    for i, line in enumerate(lines, 1):
        if section in line:
            in_section = True
        if in_section and re.search(pattern, line):
            return i
    return 0


def run_check(root_path: Path) -> Tuple[List[Violation], str]:
    """
    Run the validation check.

    Args:
        root_path: Root directory to scan

    Returns:
        Tuple of (violations list, server.ts path)
    """
    violations = []

    # Find server.ts
    server_path = root_path / "src" / "server.ts"
    if not server_path.exists():
        # Try to find it elsewhere
        candidates = list(root_path.rglob("server.ts"))
        if candidates:
            server_path = candidates[0]
        else:
            return [Violation(
                rule_id="DOJO-EXP-0001-ERR",
                file="",
                line=0,
                column=0,
                message="Could not find server.ts",
                severity="error",
            )], ""

    content = server_path.read_text()
    rel_path = str(server_path.relative_to(root_path) if server_path.is_relative_to(root_path) else server_path)

    # Extract definitions and handlers
    definitions = extract_tool_definitions(content)
    handlers = extract_case_handlers(content)

    # Find mismatches
    defined_not_handled = definitions - handlers
    handled_not_defined = handlers - definitions

    # Skip 'default' if present (it's a valid case label but not a tool)
    handled_not_defined.discard('default')

    # Report tools defined but not handled
    for tool in sorted(defined_not_handled):
        line = find_line_number(content, tool, 'ListToolsRequestSchema')
        violations.append(Violation(
            rule_id="DOJO-EXP-0001-001",
            file=rel_path,
            line=line,
            column=1,
            message=f"Tool '{tool}' is defined but has no handler in switch statement",
            severity="error",
            snippet=f"name: '{tool}'",
        ))

    # Report handlers without definitions
    for tool in sorted(handled_not_defined):
        line = find_line_number(content, tool, 'CallToolRequestSchema')
        violations.append(Violation(
            rule_id="DOJO-EXP-0001-002",
            file=rel_path,
            line=line,
            column=1,
            message=f"Handler for '{tool}' exists but tool is not defined in ListToolsRequestSchema",
            severity="error",
            snippet=f"case '{tool}':",
        ))

    return violations, rel_path


def main():
    """Run the check."""
    print("Running check: DOJO-EXP-0001 - MCP Tool Registration Validator")
    print("=" * 60)

    scan_path = os.environ.get('SCAN_PATH', '.')
    root_path = Path(scan_path).resolve()

    print(f"Scanning: {root_path}")
    print()

    violations, server_file = run_check(root_path)

    # Standard output format
    errors = [v for v in violations if v.severity == "error"]
    warnings = [v for v in violations if v.severity == "warning"]

    result = {
        "status": "fail" if errors else "pass",
        "check_id": "DOJO-EXP-0001",
        "server_file": server_file,
        "summary": {
            "total": len(violations),
            "errors": len(errors),
            "warnings": len(warnings),
        },
        "violations": [asdict(v) for v in violations],
    }

    if violations:
        print(f"Found {len(violations)} violation(s):\n")
        for v in violations:
            loc = f"{v.file}:{v.line}" if v.line else v.file or "(unknown)"
            print(f"  [{v.severity.upper()}] {loc}")
            print(f"           {v.message}")
            if v.snippet:
                print(f"           > {v.snippet}")
            print()
    else:
        print("All tools properly registered!")
        print(f"  - Tool definitions and handlers are in sync")

    print()
    print("--- JSON Output ---")
    print(json.dumps(result, indent=2))

    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
