# `@ui9000/core`

Decision engine for UI9000 Stage 3. **Private — not published.**

The model sends a closed `intent`. This package chooses the component from the `@fusedashlabs/widgets@0.5.0` engine catalog and a `DataProfile`. It does not call `mcp-ui` `generate_*` tools.

## Folder map

| Path | Owner | What |
|------|--------|------|
| `src/spec/` | senior | spec schema, `Intent`, `DataProfile` |
| `src/validate/` | senior | three-layer validator |
| `src/engine/` | senior | rules, score, disqualify |
| `src/trace/` | senior | decision trace shape |
| `src/tool/` | senior | `show_workspace` contract |
| `src/interpreter/` | senior | `ui://` receives spec, validates, renders |
| `src/index.ts` | senior | public re-exports |
| `src/catalog/` | junior | loader over widgets 0.5.0 (`tier: engine` only) |
| `src/profiler/` | junior | columns → `DataProfile` |
| `src/migrate/datalink/` | junior | copy from mcp-ui |
| `src/migrate/map-validation/` | junior | copy from mcp-ui |
| `tests/adversarial/` | junior | 9 fail-closed cases |
| `tests/eval/` | junior | same dataset × 4 intents |
| `tests/fixtures/` | junior | data only |

Engine code does **not** live in the widgets package or in mcp-ui.

## Now

Bootstrap only: closed `DataProfile` / `Intent` types and empty folders. No validator, no engine, no `show_workspace` yet.
