# Changelog

## 0.4.0 (2026-02-14)

### Added
- **Voice tree view** — pro-gated sidebar showing voice inbox messages grouped by status (queued, processing, completed, failed)
- **License validation via Supabase** — pro keys are verified against the `licenses` table with 24-hour local cache and graceful offline fallback
- **Error states in tree views** — sentinel, dojo, and voice trees now show helpful messages when disconnected, empty, or on load failure

### Changed
- Categories updated from "Other" to "Data Science", "Machine Learning"
- `ProGate.initialize()` now takes `ExtensionContext` for `globalState` caching
- `ProGate.onConfigChange()` is now async (remote re-validation)
- Refresh command and auto-refresh timer now include the voice tree

## 0.3.4 (2026-02-10)

### Fixed
- Status bar correctly shows daemon vs stdio mode
- Auto-refresh config changes take effect without reload

## 0.3.0 (2026-02-08)

### Added
- Activity bar icon with Decibel sidebar
- Sentinel tree view — epics grouped by status, issues by open/closed
- Dojo tree view — wishes, proposals, experiments
- Pro gating — license key format validation, dev mode override
- Daemon bridge mode — proxy to running daemon with stdio fallback
- Status bar item showing connection mode
- Quick pick command palette with all actions
- Auto-refresh timer (configurable interval)

### Commands
- Project Status, Preflight Check
- Create Issue, Create Epic, Add Wish
- Activate/Deactivate Pro
- Sync Voice Inbox, Voice Command (pro)

## 0.1.0 (2026-01-28)

### Added
- Initial release
- Basic MCP client with stdio transport
- Extension scaffolding and esbuild pipeline
