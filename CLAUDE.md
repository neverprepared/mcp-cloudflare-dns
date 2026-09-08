# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Overview

`@neverprepared/mcp-cloudflare-dns` — a Model Context Protocol (MCP) server that lets AI
agents manage Cloudflare DNS records. TypeScript, ESM, Node >= 20. Communicates over
**stdio** only (no HTTP transport in the code). Fork of `gilberth/mcp-cloudflare`, MIT.

## Architecture

```
src/cli.ts     Executable entry point (bin: mcp-cloudflare).
               Loads dotenv, hard-fails if CLOUDFLARE_API_TOKEN is unset,
               then wires createServer() to StdioServerTransport.
src/index.ts   Default export createServer(): builds the MCP Server, declares the
               tool list (ListToolsRequestSchema) and dispatches calls
               (CallToolRequestSchema) to per-tool handlers.
src/api.ts     CloudflareApi — the only module that talks to
               https://api.cloudflare.com/client/v4. Module-level config, header
               building, 15s AbortController timeout, Zod response validation.
src/types.ts   Zod schemas + inferred types for records, requests and API envelopes.
```

Flow: `cli.ts` → `createServer()` → handler → `CloudflareApi` → Cloudflare v4 REST.

`src/index.ts` exports only the server factory (no side effects), so tests import it
directly and mock `./api.js`.

### Configuration

Read from env in `api.ts` at module load (`parseEnv()`):

- `CLOUDFLARE_API_TOKEN` — **required**; sent as `Authorization: Bearer`.
- `CLOUDFLARE_ZONE_ID` — optional default zone; every tool takes an optional `zone_id`
  argument that overrides it. If neither is present, zone-scoped calls throw.
- `CLOUDFLARE_EMAIL` — optional, stored but currently unused in request headers.
- `DEBUG` — when set, dumps the raw API response on a schema-parse failure.

`CloudflareApi.configure()` exists for programmatic/host-supplied config but is not
called by any entry point.

## MCP Tools (8, all defined in `src/index.ts`)

| Tool | Required args | Notes |
| --- | --- | --- |
| `list_zones` | — | Account-wide; uses `accountApi('zones')`, not zone-scoped. |
| `list_dns_records` | — | Optional `name`, `type` filters. |
| `get_dns_record` | `recordId` | |
| `create_dns_record` | `type`, `name`, `content` | SRV/CAA use structured `data` instead of `content`. |
| `update_dns_record` | `recordId` | All other fields optional. |
| `delete_dns_record` | `recordId` | |
| `export_dns_zone` | — | Returns records as pretty JSON. |
| `import_dns_zone` | `records` | Sequential creates; per-record success/failure summary. |

All tools accept an optional `zone_id`. No MCP resources or prompts are registered —
capabilities are `{ tools: {} }` only.

Record types: `A, AAAA, CNAME, MX, TXT, NS, SRV, CAA, PTR`.

## Commands

```bash
npm run build          # tsc --build -> dist/
npm run build:swc      # alternative swc build with source maps
npm test               # vitest run
npm run test:watch
npm run test:coverage  # enforces 80% statements/lines, 75% branches, 90% functions
npm run lint           # biome lint src/
npm run lint:fix
npm run format         # biome format --write src/
npm run check          # biome check src/  <- this is what CI runs
npm run check:fix
make package           # fpm .deb into packages/ (needs fpm + ruby)
make package-docker    # same build inside an ubuntu:24.04 container
```

CI (`.github/workflows/ci.yml`, on push/PR to `main`): `npm ci` → `npm run check` →
`npm run build` → `npm run test:coverage`. Run `npm run check` (not just `lint`) before
pushing — CI fails on formatting too.

Releases: release-please on `main` opens a release PR; merging it publishes to GitHub
Packages and npm. A `v*` tag also triggers `publish-npm.yml`.

## Conventions

- **Biome**, not ESLint/Prettier. 2-space indent, width 100, single quotes, semicolons,
  trailing commas. `noExplicitAny`, `noUnusedImports`, `noUnusedVariables` are errors.
- ESM throughout: relative imports **must** carry the `.js` extension (`./api.js`).
- Zod is the single source of truth for validation; `types.ts` exports both the base
  shapes and the `refineSrvCaa*` refinements so `index.ts` can `.merge()` then re-refine.
- Tests live in `tests/*.test.ts`, mirror `src/` file-for-file, and mock at the module
  boundary (`vi.mock('../src/api.js')` for handlers, `global.fetch` for the API layer).
  Every behaviour change needs a test.
- Security invariants — preserve them when editing:
  - DNS record names/content are wrapped by `safeRecord()` as `[EXTERNAL DATA: …]`
    before reaching the model (prompt-injection guard).
  - Record IDs are checked against `/^[0-9a-f]{32}$/i` before any request.
  - Cloudflare error payloads are reduced to codes by `sanitizeApiErrors()`; full detail
    goes to stderr only. Never surface the raw message to the caller.
  - Log to `console.error` — stdout is the MCP stdio channel.
- Tool handlers never throw: they return `{ isError: true, content: [...] }`.

## Known gaps

- **No pagination.** List/export return at most Cloudflare's first page (~100 records);
  `parseRecordList` only logs a warning to stderr when `total_count` exceeds what it got.
- No retry/backoff; a single 15s timeout per request.
- `import_dns_zone` creates records one at a time, so a large import is slow and
  non-atomic.

## Commit conventions

Conventional Commits (`feat:`, `fix:`, `chore:`, `ci:`) — release-please derives the
version and CHANGELOG from them.
