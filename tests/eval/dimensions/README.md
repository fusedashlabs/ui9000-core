# Five-dimension eval harness (S4-01 / FUS-4107)

Adding an eval case is adding a JSON file. No `it()`, no harness edit, no engine
edit. If a case needs engine source to change, it is not a case — it is a ticket.

```
dimensions.ts        closed dimension enum + fixture parser (the only place a dimension name lives)
harness.ts           runs one fixture down the shipping path, one checker per dimension
dimensions.test.ts   one `it` per fixture, plus the tests that keep the enum closed
cases/*.json         the eval set
```

## Add a case

1. Pick the dimension. The enum is **closed**:

   | dimension | the question it answers |
   | --- | --- |
   | `selection` | did `decide()` pick the right component for this intent and profile? |
   | `schema` | is the emitted spec the shape we promised — component, actions, binds, fields? |
   | `data_accuracy` | do the numbers and columns match the dataset, and do rows stay behind the signed handle? |
   | `a11y` | is the winner named, are its fields labelled, are its actions ones the catalog allows? |
   | `policy` | does one hostile edit to the *real* emitted spec still fail closed? |

   Anything else — `latency`, `accessibility`, `data-accuracy` — fails at parse
   time with the closed set in the message. Adding a sixth dimension is three
   deliberate edits (the enum, its `expect` parser, the checker table), not a
   fixture.

2. Create `cases/<id>.json`. The file name must equal the `id`.

   ```json
   {
     "id": "selection-summary-kpi-over-table",
     "dimension": "selection",
     "intent": "summary",
     "profile": "category-metric",
     "expect": { "winner": "kpi-widget", "alsoEligible": ["table"], "outscores": ["table"] }
   }
   ```

3. Run it:

   ```
   yarn workspace @fusedashlabs/ui9000-workspace test tests/eval/dimensions
   ```

   The failure names your file, the claim that broke, and what the engine
   actually did — so a red case is either a fixed fixture or a real finding.

## The five fields

- **`id`** — kebab-case, matches the file name, unique across `cases/`.
- **`dimension`** — one of the five above.
- **`intent`** — the closed engine intent: `spatial | comparison | summary | form | evidence | graph`.
- **`profile`** — where the DataProfile comes from:
  - `"category-metric"` — a fixture under `tests/fixtures/profiles/`. Its CSV is
    profiled, and its recorded `.json` is what `data_accuracy` holds the
    profiler to.
  - `{ "name": "geo-lat-lng", "hasMapToken": true }` — the same, plus overrides
    for facts no column can prove. `hasMapToken` is the host's capability, not
    the table's; that is why `selection-spatial-without-map-token` and
    `selection-spatial-with-map-token` differ in one key and end up in different
    workspaces.
  - `{ "hasCategory": true, "hasNumericMetric": true }` — an inline profile, no
    dataset. `selection` only. Every other dimension reads the emitted spec, so
    it needs real columns and the parser insists on `name`.

  Override keys are the closed `DataProfile` keys. A typo is a parse error, not
  a silently ignored field.
- **`expect`** — dimension-specific, and every key is checked, so a misspelled
  key fails instead of passing vacuously. At least one key is required.

### `selection`

| key | meaning |
| --- | --- |
| `winner` (required) | component id, or `null` to assert the engine picked nothing |
| `alsoEligible` | these ids must be eligible (contested, not excluded) |
| `notEligible` | these ids must not be eligible |
| `outscores` | the winner must be eligible *and* strictly outscore each of these |
| `rejectedWith` | `[{ id, reason }]` — the exact refusal sentence, not a code |

### `schema`

`specValid` (default `true`) runs `show_workspace` and revalidates its spec.
`component`, `actions`, `bindRoles`, `fieldNames` compare exactly and in order;
`closedProfileKeys` asserts the trace profile carries only `DataProfile` keys.
For a known gap, record it honestly with `"specValid": false` and the
`failCode` the tool answers with (see
`schema-network-graph-has-no-node-columns.json`: the profiler proves nodes and
links, but the column classifier has no `node`/`link` role, so `graph` wins the
choice and then cannot bind).

### `data_accuracy`

`matchesRecordedProfile` compares the CSV-derived profile against the committed
`.json`, key for key. `profile` witnesses individual keys of what the engine
saw. `rowCount` and `columns` check what the tool reported; `noRowsInTrace` and
`noRowsInSpec` check that dataset rows are in neither, and `hasDataUrl` that the
widget has a signed handle to read them from. Every bind is also checked to
point at a real column of the CSV.

### `a11y`

`label` (the accessible name the spec carries), `everyFieldLabelled`,
`actions` (exact list) and `actionsAllowedByCatalog` (every declared action is a
closed spec action the winner's catalog entry allows — this is what keeps
`pan`/`zoom` off a map spec). `refusedWith` takes the same `[{ id, reason }]`
shape as `selection`, for cases where the a11y answer is a refusal:
`a11y-unlabelled-control-is-refused.json` has no winner at all.

### `policy`

Two keys: `probe` and `refusalCode`. The probe applies one hostile edit to the
spec the engine *actually emitted* for this case, then revalidates:

`none` · `script-url` · `data-url` · `handler-prop` · `inline-rows` ·
`unknown-action` · `unknown-component` · `unnamed-tool` · `unbound-field` ·
`strip-label`

`refusalCode` is a `VALIDATION_CODES` value, or `null` to assert the probed spec
is still accepted (`none` + `null` is the honest "the emitted spec is clean"
case). Every probe has at least one case, and a test enforces that.

`strip-label` only refuses on components the catalog names from a label — point
it at a form control, not a chart.

Hostile *documents* are not this folder's job. `tests/adversarial` owns those,
and S4-01 does not touch it.

## Boundaries

This folder does not import engine source for writing, does not edit
`tests/eval/four-intents.test.ts`, `src/engine`, or `tests/adversarial`, and
holds no dataset rows of its own — it reuses the profile fixtures in
`tests/fixtures/profiles/`. To eval a new dataset shape, add the CSV and its
recorded profile there (see `src/profiler/profile-columns.test.ts`, which locks
that folder), then point a case at it by name.
