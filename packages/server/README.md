# @fenglimg/fabric-server

Fabric MCP knowledge server. Runs over stdio transport and serves Claude Code and Codex CLI from a single `.fabric/` directory.

## Tools exposed

- `fab_recall` — single-step recall: returns candidate descriptions + native read paths (no body delivery over MCP; read a body on demand via a native Read of the returned path)
- `fab_archive_scan` — scan recent work for archive-worthy knowledge candidates
- `fab_propose` — persist a pending knowledge entry
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
