# Configuration layering

Every Fabric setting has exactly ONE home. There is no key you can set in two
places, and therefore no "which one wins" to reason about — only "where does this
one live".

That is a deliberate design (KT-MOD-0004): as long as two files can both hold a
key, some user will eventually be looking at a value that is not the value in
effect, which is the most expensive kind of configuration bug to diagnose.

## The three homes

| Home | File | Owns | Who it describes |
| --- | --- | --- | --- |
| Preference | `~/.fabric/fabric-global.json` → `projects[<project_id>]` then `defaults` | Retrieval tuning, nudge cadence, behaviour policies | How *you* want Fabric to behave |
| Corpus | `<store-root>/store-config.json` | Staleness, similarity, and scale thresholds | What a *knowledge base* is like |
| Global root | `~/.fabric/fabric-global.json` top level | `language` | This machine's tone |

`<repo>/.fabric/fabric-config.json` is **identity only** — `project_id`,
`required_stores`, `active_write_store`, `active_project`, `write_routes`,
`default_write_store`. It holds no policy knobs. A policy key left in it from an
older layout has no effect; `fabric doctor` reports it as a
`config_key_relocated` INFO advisory and names its new home.

## Resolution order

The cascade is per class, not global:

```text
preference   env (see below) > projects[<project_id>] > defaults > code default
corpus       env (see below) > store-config.json > code default
global root  ~/.fabric/fabric-global.json > code default
```

`projects[<project_id>]` is this repository's exception to your machine-wide
`defaults`; the `project_id` linking them is the one key the repo config still
owns.

Each layer is validated independently. A missing, malformed, or unrecognised
value falls through to the next layer and never throws — one bad field does not
discard its valid siblings.

## Environment variables

Env is **not** a uniform override layer. Only these four settings have a reader
that consults the environment:

| Setting | Variable | Read by |
| --- | --- | --- |
| `default_layer_filter` | `FABRIC_DEFAULT_LAYER_FILTER` | MCP server |
| `fusion` | `FABRIC_FUSION` | MCP server |
| `nudge_mode` | `FABRIC_NUDGE_MODE` | hooks |
| `underseed_node_threshold` | `FABRIC_UNDERSEED_NODE_THRESHOLD` | hooks |

For every other setting, exporting a `FABRIC_`-prefixed variable does nothing.
The authoritative list is `PANEL_ENV_OVERRIDES`
(`packages/shared/src/schemas/config-env-registry.ts`); a census test fails if it
disagrees with the code in either direction, so it cannot quietly go stale.

Additional `FABRIC_*` variables exist for non-panel internals (embedding
transport, credibility half-lives, orphan-demotion thresholds); those are read
where they are defined and are not part of the settings surface.

Both `fabric config` and the console configuration page label the layer each
value came from, including `environment`. A value the environment is deciding
cannot be edited from either surface — writing it to a file would persist a
value that nothing reads.

## The console configuration page is machine-scoped

`fabric preview` serves a configuration page that shows **this machine**, not the
directory it was started from. It lists the machine-wide `defaults`, every
project that has settings of its own, and every mounted store — and it lists the
same things whether you launched it inside a repo or from your home directory.

The working directory decides exactly two things, both cosmetic: which row is
badged as the one you are standing in, and — when that project appears in
neither `~/.fabric/state/projects.json` nor the `projects` segment — that it gets
a row at all, so the project you are in is never invisible on its own machine.
That row carries nothing but the id. Nothing else about the page moves, including
the order of the list.

Two consequences worth knowing:

- **The project list is merged from two half-complete sources.** The registry has
  paths but a project registered without a store binding has no `project_id`;
  the `projects` segment has ids and the actual overrides but can never supply a
  path. A project with a path and no id is shown but cannot be configured —
  per-project settings live under `projects[<id>]`, so there is nowhere to write.
  Run `fabric store bind` first.
- **The environment layer can only be read for one project.** A console process
  sees its own `process.env`, but the processes that actually consult
  `FABRIC_NUDGE_MODE` and friends are each project's own hooks and MCP server.
  So the page states an env override as fact only for the launch directory's
  project and locks that field; for every other project it says the variable is
  set in *this console's* environment, as a possibility, and leaves the field
  editable.

Writes from the page go to the home of the key being written — machine defaults
and per-project overrides to `~/.fabric/fabric-global.json`, corpus keys to the
chosen store's `store-config.json`. The request names a project id or a store
uuid, never a path; the server derives the file and refuses anything outside the
set it enumerated itself.

## Store configuration

`store-config.json` sits beside `store.json` at the shared store root. A new
store gets an empty object. `storeConfigSchema`
(`packages/shared/src/schemas/store.ts`) is the sole definition of what a store
may configure — corpus properties only: staleness and credibility windows,
conflict-lint similarity, index scale thresholds.

Preference knobs are not accepted here. A preference key written into a
store-config is simply not part of that shape and is ignored; there is no
allow-list to keep in sync, which is what removed a long-standing drift between
a declared set of overridable knobs and the smaller set that actually worked.

Unknown store keys are tolerated for forward compatibility and are not used as
configuration.

## Remote embeddings

Remote embedding configuration moves as one unit, under `embed_remote` in the
global config:

- `endpoint`, `api_key`, and `model` travel together — a remote endpoint paired
  with a local model name is an unusable combination, so they are one object
  rather than three independent keys.
- Presence of the object IS the mode switch: set means remote, absent means the
  local `fastembed` provider.
- Secrets are never read from or written to `store-config.json`.
- `FABRIC_EMBED_ENDPOINT` / `FABRIC_EMBED_API_KEY` / `FABRIC_EMBED_MODEL`
  override the corresponding fields for one process.

With an endpoint and key present, recall uses the remote OpenAI-compatible
endpoint. With an endpoint but no key, recall degrades to text-only ranking and
emits a one-time hint — it does not silently fall back to a local model. Without
a remote endpoint, Fabric uses the optional local `fastembed` provider and
degrades to text-only ranking when it is unavailable.

Vector caches are isolated by transport, model, and an endpoint fingerprint. The
fingerprint never includes the API key.

The console configuration page reports remote embedding as shape only — host,
whether a key is set, and the model. The key itself is never sent to the browser
and cannot be edited there; use `fabric config` or edit the global config
directly.

## Deferred work

Intentionally outside the current implementation:

- A repo-local `fabric-config.local.json` overlay.
- `fabric info` remote-readiness reporting and model warm-up behaviour.
