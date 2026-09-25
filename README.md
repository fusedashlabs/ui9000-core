# `@fusedashlabs/ui9000-workspace`

Stage 3 workspace MCP: one tool, `show_workspace`. The model sends a closed `intent`; this package picks the widget from `@fusedashlabs/widgets` and a `DataProfile`. It does **not** call mcp-ui `generate_*`.

**FuseDash client / gateway keep using mcp-ui.** This package is what Cursor and Claude Desktop run as MCP. In Cursor and Claude, Approve is displayed, not enforced; blocking an unapproved action is Stage 5, on a page we own.

**npm:** [`@fusedashlabs/ui9000-workspace`](https://www.npmjs.com/package/@fusedashlabs/ui9000-workspace)  
**Server key** in Cursor / Claude: `UI9000-Workspace`

---

## Install in Cursor or Claude

Node.js 22+. No env required. Chart JSON is POSTed to `https://mcp.ui9000.com/v1/data-links`.

### Cursor

Replace `@fusedashlabs/ui9000-mcp` in `~/.cursor/mcp.json` (leave FuseDash's mcp-ui install alone):

```json
{
  "mcpServers": {
    "UI9000-Workspace": {
      "command": "npx",
      "args": ["-y", "@fusedashlabs/ui9000-workspace"]
    }
  }
}
```

Restart Cursor. Attach or paste a CSV, then ask with an intent (`comparison`, `spatial`, `summary`, `form`). The model should call `show_workspace` with `csv` (the table including the header) or `path` to a local file. Keep `datasetId` from the result for the next chart on the same table.

`WORKSPACE_DATA_PATH` is only a fallback when no `csv` / `path` / `url` / `datasetId` is passed (shipped demo CSV). Chat attachments are not that env file — they must go through `csv` or `path`.

### Claude.ai (custom connector)

Claude web cannot run `npx`. Add a custom connector:

1. **Customize → Connectors → Add custom connector**
2. Name: `UI9000-Workspace`
3. URL:

```
https://mcp.ui9000.com/workspace/mcp
```

No auth. Enable the connector in the new chat. Paste CSV via `show_workspace.csv` (or `datasetId` from a previous call). `url` / `path` are disabled on this hosted server. Without a source, the shipped demo CSV (`regional-incidents`) is used.

Do **not** use `https://mcp.ui9000.com/mcp` — that is mcp-ui (`generate_*`), not `show_workspace`.

### Claude Desktop

Edit `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "UI9000-Workspace": {
      "command": "npx",
      "args": ["-y", "@fusedashlabs/ui9000-workspace"]
    }
  }
}
```

---

## Run from this repo (stdio)

```bash
# from the ui9000-widgets repo root
yarn build
yarn workspace @fusedashlabs/ui9000-workspace start
```

Catalog import is `@fusedashlabs/widgets/catalog` (`dist/`). If that file is missing, `yarn build` first.

Optional: `WORKSPACE_DATA_PATH` to a CSV the server already holds (the model still sends only `{ "intent": "…" }`). Relative paths resolve against `packages/core`, not `$HOME`.

Cursor / Claude open `ui://ui9000/chart`. In this multi-repo checkout the HTML
is the sibling `mcp-ui` generated App View; otherwise the server fetches
`https://mcp.ui9000.com/mcp-app/chart`. The data-link URL is for the widget
`fetch`, not a page — do not open it in a browser.

stdio JSON-RPC on stdin/stdout. Do not log to stdout — that breaks the frame stream.

### Environment

None required to start. Overrides:

| Variable | Default | What |
|----------|---------|------|
| `MCP_BASE_URL` | `https://mcp.ui9000.com` | Hosted data-link origin (same remote as mcp-ui). Loopback (`http://127.0.0.1:8088`) uses a local TTL store instead of POST. |
| `MCP_DATA_LINK_SECRET` | dev fallback outside prod-like envs | HMAC key for **local** signing only. Hosted POST is signed by `mcp.ui9000.com`. **Required** in production-like envs when not using hosted persist. |
| `MAPBOX_ACCESS_TOKEN` / `MAPBOX_TOKEN` | baked public FuseDash charts key | Always present so `spatial` can pick `map-chart`. Override to use another token. |
| `DATA_LINK_TTL_HOURS` | `24` | Signed-link lifetime. Floored, minimum 1. |
| `MAX_PAYLOAD_SIZE_MB` | `1.5` | Cap on serialized payload bytes. |
| `STORAGE_DIR` | `<packages/core>/.data` | Local TTL store (also a cache of hosted ids). |
| `WORKSPACE_DATA_PATH` | shipped demo CSV (`regional-incidents`) | Fallback table when the tool call has no `csv` / `url` / `path` / `datasetId`. |

`tools/list` is length 1. Pass a table with `csv`, `url`, `path`, or `datasetId` — never `data[]` / `rows`. Dataset rows never appear in the MCP result or the description.

## Publish to npm

Does **not** use the widgets `v*` tag (that workflow publishes only `@fusedashlabs/widgets`).

From GitHub: **Actions → Release — workspace MCP → Run workflow** (`NPM_TOKEN` is already on this repo).

Locally (after `npm login` to the `@fusedashlabs` org):

```bash
yarn build
yarn workspace @fusedashlabs/ui9000-workspace npm publish
```

Yarn rewrites `workspace:*` to the published `@fusedashlabs/widgets` version.

## Folder map

| Path | Owner | What |
|------|--------|------|
| `src/spec/` | senior | spec schema, `Intent`, `DataProfile` |
| `src/validate/` | senior | three-layer validator |
| `src/engine/` | senior | rules, score, disqualify |
| `src/trace/` | senior | decision trace shape |
| `src/tool/` | senior | `show_workspace` contract |
| `src/interpreter/` | senior | `ui://` receives spec, validates, renders |
| `src/workspace-server.ts` | senior | `createServer` (tests) + SDK stdio `startWorkspaceServer` |
| `src/index.ts` | senior | public re-exports |
| `src/catalog/` | junior | loader over widgets 0.6.0 (`tier: engine` only) |
| `src/profiler/` | junior | columns → `DataProfile` |
| `src/server/` | junior | hand-rolled JSON-RPC for in-process tests; MCP SDK + ext-apps for live stdio |
| `src/migrate/datalink/` | junior | copy from mcp-ui |
| `src/migrate/map-validation/` | junior | copy from mcp-ui |
| `tests/adversarial/` | junior | 9 fail-closed cases |
| `tests/eval/` | junior | same dataset × 4 intents |
| `tests/fixtures/` | junior | data only |

Engine code does **not** live in the widgets package or in mcp-ui.

## Public API

`validateSpec`, `decide`, `INTENTS`, `DATA_PROFILE_KEYS`, `loadWorkspaceCatalog`, `profileColumns`, `signDataLink`, `readDataLink`, `handleShowWorkspace`, `createServer`, `createWorkspaceServer`, `startWorkspaceServer`, `applyWorkspaceHostDefaults`.
