# @fenglimg/fabric-server

Fabric MCP knowledge server. Runs over stdio transport and serves Claude Code and Codex CLI from a single `.fabric/` directory.

## Tools exposed

- `fab_plan_context` — neutral rule description index + selection token
- `fab_get_knowledge_sections` — fetch full markdown bodies by stable_id
- `fab_recall` — combined one-call recall (plan + sections), the rc.37+ default
- `fab_archive_scan` — scan recent work for archive-worthy knowledge candidates
- `fab_extract_knowledge` — persist a pending knowledge entry
- `fab_review` — list / approve / reject / modify / defer pending entries

## Install

Usually installed indirectly via [`@fenglimg/fabric-cli`](https://www.npmjs.com/package/@fenglimg/fabric-cli):

```bash
npm i -g @fenglimg/fabric-cli
fabric install
```

Direct consumption (programmatic):

```bash
npm i @fenglimg/fabric-server
```

## Repo

Source + issues + roadmap: <https://github.com/fenglimg/fabric-v2>

## License

MIT — see [LICENSE](./LICENSE).
