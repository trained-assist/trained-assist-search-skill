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
| `search_serp_free` | Keyless SERP scraping — no API key, no account, no quota under our name. Chain: DuckDuckGo html (POST) → a pool of public SearXNG instances (`format=json`) → Brave Search HTML. First backend that answers wins; every upstream block is reported with a reason, never a hang. Extracted from core PR [#1796](https://github.com/trained-assist/trained-assist-agent/pull/1796). |

### Environment

| Var | Default | Meaning |
|-----|---------|---------|
| `FREE_SEARCH_BACKEND` | `duckduckgo,searxng,brave` | Comma-separated backend chain to probe, in order |
| `SEARXNG_URL` | the three instances verified live from GCP | Comma-separated SearXNG base URLs (sticky: the instance that answered last call goes first) |

### Tests

```bash
npm run check   # every tool file loads, entrypoint parses
npm test        # offline — every live call goes through an injected fetchImpl

# live network smoke (5 control queries), never runs in CI:
SMOKE_FREE_SEARCH=1 node --test tests/*.test.cjs
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

Provenance: the file moved from core `src/mcp-skills/tools/99c-search-searxng.js`
with its tool name unchanged; the core copy is deleted once this sibling serves it.
