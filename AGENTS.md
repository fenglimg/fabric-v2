# Project Knowledge

This project uses [Fabric](https://github.com/fenglimg/fabric) for cross-client AI knowledge management.

Knowledge entries live in `.fabric/knowledge/` (team) and `~/.fabric/knowledge/` (personal).
Run `fabric doctor` to verify state.

See `.fabric/knowledge/` for project decisions, pitfalls, guidelines, models, and processes.

<!-- fabric:knowledge-base:begin -->

## Fabric Knowledge Base

This project uses Fabric for persistent project knowledge under `.fabric/knowledge/`.

- **Discovery**: SessionStart lists available entries (broad menu); editing files may surface narrow hints
- **Usage**: call `fab_get_knowledge_sections` to fetch full content of any entry by id
- **Write flows**: see fabric-archive (record), fabric-review (validate), fabric-import (backfill) Skills
- **Language**: rendered per `fabric_language` in `.fabric/fabric-config.json` (current: `zh-CN-hybrid`)

<!-- fabric:knowledge-base:end -->
