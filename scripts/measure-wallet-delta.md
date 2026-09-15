# Wallet delta instructions (S3-20 / C15)

Lab proof is `tools-list-tokens.json` (same-machine `tools/list` tokens).
**C15 is not that file.** C15 is the production wallet delta on the same
calendar window, signed at cutover (S3-21). Do not paste an estimate here.

## What to record

| Field | Fill at S3-21 |
|-------|----------------|
| Window start (UTC) | `YYYY-MM-DD` — flag ON for the cutover tenant |
| Window stop (UTC) | `YYYY-MM-DD` — end of the comparison window (exclusive) |
| Tenant / company id | FuseDash `company.id` on the cutover tenant |
| Flag | `customAttributes.workspace_mcp=true` **or** `WORKSPACE_MCP_COMPANY_IDS` contains that company id (`*` = every company) |
| Control | Same tenant **before** the flag, or a sibling tenant still on mcp-ui (`CHART_MCP_SERVER_URL`) |
| Wallet figure | `SUM(amount)` where `amount < 0` (usage), FuseDash wallet tokens, **not** raw LLM tokens |

## Where to read the wallet

1. **Billing service** — `getWallet({ userId })` via gateway `TokensService.getWallet` (`gateway/src/modules/tokens/tokens.service.ts`). Balance is the live remaining wallet, not the window delta.
2. **Usage delta (C15)** — production Postgres token ledger used in `reports/TOKEN_SPEND_STATISTICS.md` (mcp multi-repo checkout): read-only `SUM(amount) FILTER (WHERE amount < 0)` for the window, scoped to the cutover company/users. Source labels that move with chat MCP: `mcp_smart_router`, `*_smart_routing*`, `mcp_chat`.
3. **Do not** use `tools-list-tokens.json` `delta_pct` as the wallet number. That is prompt-size lab proof only.

## Flag / routing to compare

| Path | Env / flag | Server |
|------|------------|--------|
| Incumbent | `CHART_MCP_SERVER_URL` (mcp-ui). `MCP_UI_READ_ONLY` **unset**. `workspace_mcp` off. | generate_* in `tools/list` |
| Cutover | `WORKSPACE_MCP_SERVER_URL` + `workspace_mcp=true` (or `WORKSPACE_MCP_COMPANY_IDS`). After go-live, mcp-ui `MCP_UI_READ_ONLY=1` on that tenant. | one tool `show_workspace` |

Same model, same tenant cohort, same window length on both sides.

## How to compute delta_pct

```
delta_pct = (wallet_usage_workspace - wallet_usage_mcp_ui) / wallet_usage_mcp_ui * 100
```

Negative means the workspace path spent fewer wallet tokens. Record both raw
sums and `delta_pct` in the S3-21 cutover PR.

## Blank for S3-21 (do not invent)

```
window_start_utc:
window_stop_utc:
company_id:
flag:
wallet_usage_mcp_ui:
wallet_usage_workspace:
delta_pct:
reader:
```
