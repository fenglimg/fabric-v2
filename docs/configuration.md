# Configuration layering

Fabric configuration has three homes. Put a value in the narrowest home that
matches who owns it.

| Home | File or source | Owner | Typical values |
| --- | --- | --- | --- |
| Machine | Environment variables and `~/.fabric/fabric-config.json` | One workstation | Remote endpoint, API key, local cache path |
| Store | `<store-root>/store-config.json` | Everyone using that shared store | Recall, ranking, and embedding-model defaults |
| Repo | `<repo>/.fabric/fabric-config.json` | One repository | Store bindings and intentional repo overrides |

For knobs that support all layers, resolution is:

```text
environment > repo > store > library default
```

Each layer is validated independently. A missing or invalid value falls through
to the next layer; one invalid Store field does not discard valid sibling fields.
Repo overrides are allowed. `fabric doctor` reports an informational
`store_knob_repo_override` advisory when a Repo and Store explicitly set the
same Store-overridable knob.

## Store configuration

`store-config.json` is stored beside `store.json` at the shared Store root. A
new Store receives an empty object by default. Supported Store values include:

- Recall selection: `plan_context_top_k`, `recall_relevance_ratio`,
  `default_layer_filter`, `broad_index_backstop` and
  `underseed_node_threshold`.
- Embedding and fusion: `embed_weight`, `embed_model` and `fusion`.
- Review, conflict, credibility and orphan-demotion thresholds.

`embed_enabled` remains a Repo decision; a Store cannot enable embeddings for a
Repo. Unknown Store keys are tolerated for forward compatibility but are not
used as configuration knobs.

## Remote embeddings

Remote embedding configuration is deliberately split by ownership:

- Model selection (`embed_model`) may be a Store default, with Repo and
  environment overrides.
- Endpoint (`FABRIC_EMBED_ENDPOINT` or machine `embed_endpoint`) and API key
  (`FABRIC_EMBED_API_KEY` or machine `embed_api_key`) are Machine-only.
- Secrets are never read from or written to `store-config.json`.

When an endpoint and key are present, recall uses the remote OpenAI-compatible
embedding endpoint. When an endpoint is present without a key, recall degrades
to text-only ranking and emits a one-time hint. It does not silently switch to a
local model. Without a remote endpoint, Fabric uses the optional local
`fastembed` provider and degrades to text-only ranking when it is unavailable.

Vector caches are isolated by transport, model, and an endpoint fingerprint.
The fingerprint never includes the API key.

## Deferred work

The following are intentionally outside the current configuration-layering
implementation:

- A Repo-local `fabric-config.local.json` overlay.
- `fabric info` remote-readiness reporting and model warm-up behavior.
