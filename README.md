# `@fusedashlabs/ui9000-workspace`

MCP server with one tool, `show_workspace`. Give it a table and a question. It returns a chart the host can draw. The cells stay on the server. The result is a chart spec plus a signed data link, not the rows.

**npm:** [`@fusedashlabs/ui9000-workspace`](https://www.npmjs.com/package/@fusedashlabs/ui9000-workspace)

## What it does

`show_workspace` reads one table, classifies the columns, and draws one chart.

- If the user named a chart this server can draw, that chart is the one drawn.
- If they named none and `TYPESAFE_API_KEY` is set, Jev chooses the chart. The result says which chart and why.
- If Jev is unset, unreachable, or does not choose a chart this server can draw, the server picks a chart from the table.
- When the named chart and Jev's chart are different kinds of drawing, `suggestion` names Jev's chart and `suggestionWhy` says why. That chart is not drawn unless the user asks for it.
- A named chart that cannot be drawn returns `awaitingUser` and does not draw a substitute.

The tool call must not include the table cells as `data`, `rows`, `points`, or `series`.

## Connect

Node.js 20 or newer for the `npx` install. Jev is optional. Without `TYPESAFE_API_KEY` the server still draws a chart. Put the key only in the `env` block below. Do not commit it.

On connect the server returns `instructions` for Cursor, Claude Desktop, and Claude.ai. The host puts that text in context before it picks a tool: for a table or a chart, call `show_workspace` and do not draw with the chat's built-in chart tools. Those other tools stay available. A host that ignores server instructions can still use them.

### Cursor

`~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "UI9000-Workspace": {
      "command": "npx",
      "args": ["-y", "@fusedashlabs/ui9000-workspace"],
      "env": {
        "TYPESAFE_API_KEY": "your-typesafe-key"
      }
    }
  }
}
```

Restart Cursor after saving.

### Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "UI9000-Workspace": {
      "command": "npx",
      "args": ["-y", "@fusedashlabs/ui9000-workspace"],
      "env": {
        "TYPESAFE_API_KEY": "your-typesafe-key"
      }
    }
  }
}
```

### Claude.ai

Claude on the web cannot run `npx`. Add a custom connector:

1. **Customize → Connectors → Add custom connector**
2. Name: `UI9000-Workspace`
3. URL: `https://mcp.ui9000.com/workspace/mcp`

Enable the connector in the chat. This hosted server accepts `csv` or `datasetId`. It does not accept `url` or `path`. The Jev key is not part of this connector. Use the `npx` install above when you want to pass `TYPESAFE_API_KEY`.

## How to call `show_workspace`

`intent` is required. It is the question, not a chart name.

| Intent | Use it for |
|--------|------------|
| `spatial` | Where something is: region, country, city, lat/lng. A map needs geo columns. |
| `comparison` | Which group is higher or lower, or how values spread. |
| `summary` | A total, a count, or a few headline numbers. |
| `form` | The user must enter or confirm labelled values. |
| `evidence` | Claims, sources, or a timeline of facts. |
| `graph` | What is connected to what. |

Pass one source:

| Field | When |
|-------|------|
| `csv` | The table is in the message, header included. |
| `url` | A local or dev file URL. Not accepted on the hosted connector. |
| `path` | A local file path. Not accepted on the hosted connector. |
| `datasetId` | The same table as an earlier call. |

Optional:

| Field | When |
|-------|------|
| `utterance` | The user's words, so Jev can read them. |
| `requestedChart` | Only when the user named a chart, such as `bar` or `line`. Omit it when they did not. |
| `columns` | Header names to keep. Later calls on the same `datasetId` keep that selection until a new `csv` omits `columns`. |

Keep `datasetId` from the result for the next chart on the same table.

## Environment

| Variable | Default | What |
|----------|---------|------|
| `TYPESAFE_API_KEY` | unset | When set, Jev chooses the chart if the user named none. |
| `WORKSPACE_DATA_PATH` | shipped demo table | Table used only when the call has no `csv`, `url`, `path`, or `datasetId`. |
| `MAPBOX_ACCESS_TOKEN` or `MAPBOX_TOKEN` | a public map token | Lets a map draw. Set another token to replace it. |
| `MCP_BASE_URL` | `https://mcp.ui9000.com` | Where chart data is stored. |
| `DATA_LINK_TTL_HOURS` | `24` | How long a data link stays valid. Minimum 1. |
| `MAX_PAYLOAD_SIZE_MB` | `1.5` | Largest table the server will store. |
