# Decibel Tools MCP - Testing Architecture

**Status:** Active
**Owner:** Decibel (mediareason)
**Audience:** Engineers, AI agents (Claude Code, etc.)

---

## 1. Purpose

This document describes how testing works for **decibel-tools-mcp**, an MCP server exposing Designer, Architect, Sentinel, and Oracle tools.

Goals:
- Ensure MCP protocol compliance
- Validate tool behavior with deterministic tests
- Enable AI agents to safely iterate on code
- Maintain high confidence for production deployments

---

## 2. Core Principles

1. **Deterministic tests**
   - All tests run the same way in CI and locally
   - No reliance on external services or network
   - File system tests use isolated temp directories

2. **CI is the source of truth**
   - If CI is red, it doesn't ship
   - All PRs require passing tests

3. **Test isolation**
   - Each test gets its own data directory
   - No state leaks between tests
   - Cleanup happens automatically

4. **AI-readable output**
   - Clear error messages
   - Structured test reports
   - Coverage data accessible for analysis

---

## 3. Test Layers

### 3.1 Unit Tests (`tests/unit/`)

Test individual functions in isolation.

| Target | What We Test |
|--------|--------------|
| `designer.ts` | File creation, frontmatter format, slug generation |
| `architect.ts` | ADR structure, section formatting |
| `sentinel.ts` | Issue creation, severity validation |
| `oracle.ts` | File scanning, action prioritization, filtering |
| `config.ts` | Environment variable parsing, defaults |

### 3.2 Integration Tests (`tests/integration/`)

Test the MCP server with simulated client calls.

| Target | What We Test |
|--------|--------------|
| Tool registration | All 4 tools are listed via `ListTools` |
| Tool execution | `CallTool` returns expected results |
| Error handling | Invalid inputs return proper error responses |
| Schema validation | Inputs/outputs match declared schemas |

### 3.3 End-to-End Tests (`tests/e2e/`)

Test the full stdio transport flow.

| Target | What We Test |
|--------|--------------|
| Server startup | Server initializes without errors |
| Client simulation | JSON-RPC messages flow correctly |
| Round-trip | Full request → response cycle works |

---

## 4. Test Framework

We use **Vitest** for all testing:

```bash
npm test              # Run all tests
npm run test:unit     # Unit tests only
npm run test:int      # Integration tests only
npm run test:e2e      # E2E tests only
npm run test:coverage # With coverage report
npm run test:watch    # Watch mode for development
```

### Why Vitest?
- Native ESM support (matches our TypeScript config)
- Fast execution with smart caching
- Built-in coverage via v8
- Excellent TypeScript support
- Familiar Jest-like API

---

## 5. Test Utilities

### 5.1 Temporary Data Directory

All tests that touch the file system use isolated temp directories:

```typescript
import { createTestContext, cleanupTestContext } from '../utils/test-context.js';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await cleanupTestContext(ctx);
});
```

### 5.2 MCP Client Simulator

For integration tests, we have a lightweight client that speaks MCP:

```typescript
import { createTestClient } from '../utils/mcp-test-client.js';

const client = await createTestClient();
const tools = await client.listTools();
const result = await client.callTool('designer.record_design_decision', { ... });
```

### 5.3 Assertions Helpers

Custom matchers for common patterns:

```typescript
expect(result).toHaveValidTimestamp();
expect(filePath).toBeMarkdownFile();
expect(frontmatter).toMatchFrontmatter({ project_id: 'test' });
```

---

## 6. Critical Invariants

These behaviors must **never** break:

### 6.1 Data Integrity
- [ ] Files are written atomically (no partial writes)
- [ ] Frontmatter is always valid YAML
- [ ] Timestamps are ISO 8601 compliant
- [ ] Slugs contain only safe filesystem characters

### 6.2 MCP Protocol Compliance
- [ ] `ListTools` returns all 4 tools
- [ ] Tool schemas match actual input validation
- [ ] Errors include `isError: true` flag
- [ ] Response format matches MCP spec

### 6.3 Error Handling
- [ ] Missing required fields return clear errors
- [ ] Invalid severity values are rejected
- [ ] Non-existent directories are created automatically
- [ ] File system errors don't crash the server

---

## 7. Coverage Targets

| Area | Target | Current |
|------|--------|---------|
| Unit tests | 90%+ | TBD |
| Integration | 80%+ | TBD |
| Overall | 85%+ | TBD |

Coverage reports are generated in `coverage/` and uploaded to CI artifacts.

---

## 8. CI Pipeline

### 8.1 GitHub Actions Workflow

Triggers:
- Push to `main`
- All pull requests

Steps:
1. Checkout code
2. Setup Node.js 20
3. Install dependencies
4. Run linter (if configured)
5. Run all tests with coverage
6. Upload coverage report
7. Fail if coverage drops below threshold

### 8.2 Branch Protection

- `main` requires:
  - Passing CI
  - At least one approval (for human PRs)
- AI-created PRs follow the same rules

---

## 9. Running Tests

### Local Development

```bash
# Install dependencies
npm install

# Run all tests
npm test

# Run specific test file
npm test -- tests/unit/designer.test.ts

# Watch mode (re-run on changes)
npm run test:watch

# With coverage
npm run test:coverage
```

### In CI

Tests run automatically. Check the Actions tab for results.

### For AI Agents

When iterating on code:
1. Make changes
2. Run `npm test`
3. Read any failures carefully
4. Fix and repeat until green
5. Check coverage hasn't dropped: `npm run test:coverage`

---

## 10. Adding New Tests

### For a New Tool

1. Create unit test: `tests/unit/{tool-name}.test.ts`
2. Add integration test cases to `tests/integration/tools.test.ts`
3. Update invariants list if the tool has safety-critical behavior
4. Run full suite to verify

### For Bug Fixes

1. Write a failing test that reproduces the bug
2. Fix the bug
3. Verify test passes
4. Keep the test as a regression guard

### Test File Naming

```
tests/
├── unit/
│   ├── designer.test.ts
│   ├── architect.test.ts
│   ├── sentinel.test.ts
│   ├── oracle.test.ts
│   └── config.test.ts
├── integration/
│   ├── server.test.ts
│   └── tools.test.ts
├── e2e/
│   └── stdio.test.ts
└── utils/
    ├── test-context.ts
    ├── mcp-test-client.ts
    └── matchers.ts
```

---

## 11. Phase Roadmap

### Phase 1 - Foundation (Current)
- [x] Basic test harness (Vitest)
- [x] Unit tests for all tools
- [x] Integration tests for MCP server
- [x] CI pipeline with GitHub Actions

### Phase 2 - Automation
- [ ] Coverage thresholds enforced in CI
- [ ] AI agents can run full PR cycle
- [ ] Automatic test generation suggestions

### Phase 3 - Intelligence
- [ ] Coverage trend tracking
- [ ] AI-driven test gap analysis
- [ ] Property-based testing for edge cases
- [ ] Mutation testing for test quality

### Phase 4 - Production Testing
- [ ] MCP client compatibility matrix testing
- [ ] Performance benchmarks
- [ ] Load testing for high-volume scenarios
- [ ] Shadow mode for tool changes

---

## 12. Troubleshooting

### Tests fail with "ENOENT"
- Ensure temp directory creation isn't being skipped
- Check that `beforeEach` setup is running

### MCP client tests timeout
- Server might not be starting properly
- Check for unhandled promise rejections in server.ts

### Coverage is lower than expected
- Run `npm run test:coverage` and check the HTML report
- Look for uncovered branches in error handling

---

## Appendix: Test Data Examples

### Valid Design Decision Input
```json
{
  "project_id": "test-project",
  "area": "API",
  "summary": "Use REST endpoints",
  "details": "REST is simpler for our use case"
}
```

### Valid Sentinel Issue Input
```json
{
  "repo": "decibel-tools-mcp",
  "severity": "high",
  "title": "Memory leak detected",
  "details": "Process memory grows unbounded after 1000 requests"
}
```

### Expected Oracle Output Structure
```json
{
  "actions": [
    {
      "description": "Address issue: Memory leak detected",
      "source": "/path/to/file.md",
      "priority": "high"
    }
  ]
}
```
