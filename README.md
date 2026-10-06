# trained-assist-search-skill

Internet-search domain skill — MCP server mounted by
[trained-assist-agent](https://github.com/trained-assist/trained-assist-agent)
as the `search-skills` sibling (domain skill server pattern, core issues
[#1648](https://github.com/trained-assist/trained-assist-agent/issues/1648) /
[#1470](https://github.com/trained-assist/trained-assist-agent/issues/1470)).

The web-search line of epic
[#1792](https://github.com/trained-assist/trained-assist-agent/issues/1792)
lives here; core only mounts this server and never keeps a copy of its tools.

## Tools

| Tool | Description |
|------|-------------|
| `search_serp_free` | **Primary.** Keyless SERP scraping — no API key, no account, no quota under our name. Chain: DuckDuckGo html (POST) → a pool of public SearXNG instances (`format=json`) → Brave Search HTML. First backend that answers wins; every upstream block is reported with a reason, never a hang. Extracted from core PR [#1796](https://github.com/trained-assist/trained-assist-agent/pull/1796). |
| `search_serper` | **Backup.** Real Google SERP via [Serper](https://serper.dev) (`POST https://google.serper.dev/search`, `X-API-KEY`) — fixed 2 500 free queries, so it is spent only when the keyless chain is blocked/failed or a guaranteed Google SERP is needed. Normalized to `{engine, results:[{title,url,snippet,position}], took_ms}`; 15 s timeout + one retry; a missing key is a readable error, never a hang. Quality measurement: [`docs/serper-search-quality-2026-09-28.md`](docs/serper-search-quality-2026-09-28.md) (issue [#1](../../issues/1)). |

### Environment

| Var | Default | Meaning |
|-----|---------|---------|
| `FREE_SEARCH_BACKEND` | `duckduckgo,searxng,brave` | Comma-separated backend chain to probe, in order |
| `SEARXNG_URL` | the three instances verified live from GCP | Comma-separated SearXNG base URLs (sticky: the instance that answered last call goes first) |
| `SERPER_API_KEY` | — (required for `search_serper`) | Serper API key, supplied by core through `mcpToolEnv`; never stored in this repo. Without it the tool answers `serper не сконфигрирован: нужен SERPER_API_KEY` instead of failing |

### Tests

```bash
npm run check   # every tool file loads, entrypoint parses
npm test        # offline — every live call goes through an injected fetchImpl

# live network smoke (5 control queries), never runs in CI:
SMOKE_FREE_SEARCH=1 node --test tests/*.test.cjs

# live Serper smoke (1 query, needs the key), never runs in CI:
SERPER_API_KEY=… SMOKE_SERPER=1 node --test tests/search-serper.test.cjs
```

CI additionally runs core's `check-mcp-conformance.js` (empty tool results are
turned into an explicit notice) and `check-skill-contract.js` (static shape of a
skill repo) — the same gates `deploy.sh` applies before moving this checkout in
prod.

## Adding a tool

1. Drop `src/mcp-skills/tools/<NN>-<name>.js` exporting `{ tools: { <name>: { description, inputSchema, handler } } }`.
2. List the file in `config/skill-catalog.json`'s section in **core**
   (trained-assist-agent) — an unlisted module could never be hidden, and
   `test/skills-resolve.test.cjs` fails on a missing entry.
3. Keep the **tool name** stable: prompts, quick answers and users refer to it.
4. Every outbound HTTP call gets a timeout; token files are written mode `0o600`.

## Standalone host provider adapter (experimental)

`src/host-provider.js` exports `createHostProvider({ version, searchOrigin, fetchImpl })` for
the standalone MCP host's provider interface. `version` must be the pinned 40-character
source commit. The adapter exposes only the existing read-only `search_serp_free` tool; it
keeps the tool name and schema from the domain handler.

The adapter pins every outbound request to the configured HTTPS origin, forces manual
redirect handling, limits a call to two requests, limits queries to 500 characters and
upstream response bodies to 1 MB, and carries the host run's cancellation signal through
to fetch. The backend and origin come from trusted host configuration, never from tool
arguments. Tests use the non-resolving `https://search.test.invalid` origin and an injected
fixture response; they do not send queries to external search services.

This adapter is not enabled in the legacy MCP entrypoint or any deployed host. Search
queries are sent to the configured upstream when a host explicitly enables real fetch, so
do not pass private user data through it without an approved query-privacy policy.

Provenance:
- `99c-search-searxng.js` moved from core `src/mcp-skills/tools/99c-search-searxng.js`
  with its tool name unchanged; the core copy is deleted once this sibling serves it.
- `99-search-serper.js` came from core PR
  [#1798](https://github.com/trained-assist/trained-assist-agent/pull/1798) (L1 of epic #1792)
  — that core PR is closed as superseded by this repo, keeping one copy of the domain code.
