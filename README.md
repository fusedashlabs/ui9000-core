# `@ui9000/core`

Decision engine for UI9000 Stage 3. **Private — not published.**

The model sends a closed `intent`. This package chooses the component from the `@fusedashlabs/widgets@0.5.0` engine catalog and a `DataProfile`. It does not call `mcp-ui` `generate_*` tools.

## Run the workspace server (stdio)

One process, one tool (`show_workspace`). The handler is the real `handleShowWorkspace`, not a stub.

```bash
# from the ui9000-widgets repo root
export MCP_DATA_LINK_SECRET='a-long-random-secret'
export MCP_BASE_URL='http://localhost:8088'
export WORKSPACE_DATA_PATH='/absolute/path/to/dataset.csv'   # optional; relative = packages/core/...
yarn workspace @ui9000/core start
```

Same entry as the bin `ui9000-workspace-server` (`packages/core/bin/ui9000-workspace-server.mjs`), which is `startWorkspaceServer()` over stdio.

The package ships TypeScript (`src/`), not an emit `dist/`. `tsx` is a runtime dependency so `start` and the bin can run `src/bin.ts` — the only `package.json` addition beyond the ticket's `bin` + `start` fields.

stdio JSON-RPC on stdin/stdout. Do not log to stdout — that breaks the frame stream.

### Environment

| Variable | Default | What |
|----------|---------|------|
| `MCP_DATA_LINK_SECRET` | dev fallback outside prod-like envs; **required** in production | HMAC key. Fail-closed if missing/unsafe when `NODE_ENV=production` (or `MCP_ENV`/`APP_ENV`/`ENV_FILE` look like prod/staging). |
| `MCP_BASE_URL` | `http://localhost:8088` | Origin for `/v1/data-links/:id?sig=&exp=` handles. A trailing `/mcp` is stripped. |
| `DATA_LINK_TTL_HOURS` | `24` | Signed-link lifetime. Floored, minimum 1. |
| `MAX_PAYLOAD_SIZE_MB` | `1.5` | Cap on serialized payload bytes. |
| `STORAGE_DIR` | `<packages/core>/.data` | Filesystem TTL store. Absolute, or resolved against the package root (not `$HOME`). |
| `WORKSPACE_DATA_PATH` | unset (empty table) | CSV the server already holds. Absolute, or resolved against `packages/core` (not `$HOME` / cwd). The model must not send rows. |
| `WORKSPACE_HAS_MAP_TOKEN` | unset | `1`/`true`/`yes` sets `hasMapToken` on the profile. |
| `MAPBOX_ACCESS_TOKEN` / `MAPBOX_TOKEN` | unset | Also sets `hasMapToken` when non-empty. |

`tools/list` is length 1. Dataset rows never appear in arguments, the MCP result, or the description.

## Folder map

| Path | Owner | What |
|------|--------|------|
| `src/spec/` | senior | spec schema, `Intent`, `DataProfile` |
| `src/validate/` | senior | three-layer validator |
| `src/engine/` | senior | rules, score, disqualify |
| `src/trace/` | senior | decision trace shape |
| `src/tool/` | senior | `show_workspace` contract |
| `src/interpreter/` | senior | `ui://` receives spec, validates, renders |
| `src/workspace-server.ts` | senior | `createServer(handleShowWorkspace)` wiring |
| `src/index.ts` | senior | public re-exports |
| `src/catalog/` | junior | loader over widgets 0.5.0 (`tier: engine` only) |
| `src/profiler/` | junior | columns → `DataProfile` |
| `src/server/` | junior | thin stdio MCP (one tool) |
| `src/migrate/datalink/` | junior | copy from mcp-ui |
| `src/migrate/map-validation/` | junior | copy from mcp-ui |
| `tests/adversarial/` | junior | 9 fail-closed cases |
| `tests/eval/` | junior | same dataset × 4 intents |
| `tests/fixtures/` | junior | data only |

Engine code does **not** live in the widgets package or in mcp-ui.

## Public API

`validateSpec`, `decide`, `INTENTS`, `DATA_PROFILE_KEYS`, `loadWorkspaceCatalog`, `profileColumns`, `signDataLink`, `readDataLink`, `handleShowWorkspace`, `createServer`, `createWorkspaceServer`, `startWorkspaceServer`.
