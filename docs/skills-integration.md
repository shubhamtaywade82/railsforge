# ruby-agent-skills + Rails Semantic Graph in RailsForge

RailsForge layers three things (see the architecture at the end):

| Layer                          | Owns                                                                                                                                                                                                | Where                                            |
|--------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------|
| Ruby LSP (+ ruby-lsp-rails)    | Ruby language facts                                                                                                                                                                                 | not in this repo                                 |
| **Rails Semantic Graph (RSG)** | Rails *application* facts: controllers/actions/routes/views, models/associations/validations/callbacks, tables/columns/indexes/foreign keys, services/policies/specs/migrations, call/include edges | `src/semantic/`                                  |
| **ruby-agent-skills**          | Engineering decisions, patterns, verification discipline                                                                                                                                            | `src/skills/` + a pinned build in `dist/skills/` |

## The pinned pack

`skills-pin.json` names a **commit** of `shubhamtaywade82/ruby-agent-skills` (the repo publishes no tags) and the
`treeSha256` of what we ship from it. `scripts/fetch-skills.mjs` (run by `pnpm run compile`) does a `git fetch --depth 1`
of that commit, builds `dist/skills/`, and **fails the build if the content hash differs** (`RAILSFORGE_REQUIRE_SKILLS=1`,
set in CI). Offline developer builds keep an existing `dist/skills` or continue without skills.

Shipped: every skill's `SKILL.md` and `references/` (87 skills; the deprecated standalone TypeScript/React skills are
excluded, `rails-react-integration` kept), the `rails`, `ruby-design`, `testing` and `stack-minimality` pattern families
(419 patterns), `router/ROUTING.md`, the LICENSE, and a `catalog.json` digest (~2 MB of text).

Contract fields consumed (from `skill-manifest.yml` v2): `skills.<id>.{family,path,triggers}`, `defaults.always_consider`,
`retired_skills` (alias map), `patterns.<family>.paths`, and the routing matrix table in `router/ROUTING.md`
(`pattern:<id>` secondaries become pattern suggestions). Skill front matter supplies `description`.

Update the pin: `RAILSFORGE_SKILLS_DIR=/path/to/checkout node scripts/fetch-skills.mjs --update-pin --fixtures`, review the
diff of `skills-pin.json` and `test/fixtures/skills/`, bump `ref` first.

## How a request flows

```
chat / agent request ──► RailsAgent.run
   ├─ semanticContext(): selectSeeds(graph, file + prompt)  → "Rails application facts" block (≤3.5k chars)
   └─ skillContext():    entity kinds of those seeds + chat command + prompt
                         → SkillRouter (triggers, routing matrix, graph kinds, command, description overlap)
                         → ≤ railsForge.skills.maxPerRequest domain skills + pack cross-cutting skills
                         → SkillContextBuilder (descriptions; decision rules / invariants / failure modes /
                           verification of the primary skills; best reference excerpt; pattern names) (≤5k chars)
```

Everything is deterministic and capped; unreadable skills contribute nothing; no pack → no skill block (features degrade).

## Surfaces

- **Language Model tools** (agent mode, `#`): `railsforge_get_semantic_context`, `railsforge_list_skills`,
  `railsforge_route_skills`, `railsforge_get_skill`.
- **MCP** (stdio server and the native MCP provider): the same tools, plus resources
  `ruby-agent-skills://catalog` and `ruby-agent-skills://skill/<id>`.
- **Native `chatSkills`**: a curated set of 20 skills contributed from `dist/skills/skills/<id>/SKILL.md`.
- **Virtual document** `railsforge:/graph.md?root=…` (also in *RailsForge: Open Project Overview*).
- **Project skills**: `<project>/.agents/skills/<id>/SKILL.md` and `railsForge.skills.extraPaths` are merged with the
  pack and override a bundled skill with the same id.

## Routing quality

`test/SkillRouter.test.ts` replays the pack's own adversarial routing cases (`router/ROUTING_CASES.yml`): at the pinned
commit an expected primary skill is in the top 3 for 20/25 cases and in the top 5 for 21/25 (the React case is out of
scope). The misses are genuine ownership-boundary ambiguities (caching vs authorization, gem authoring vs installation).
The thresholds are regression guards, not a claim of correctness; improve the router against the cases, not the other way.

## What the graph does *not* do

It is static (regex over Ruby source, `schema.rb`, `routes.rb`); the opt-in `rails runner` snapshot upgrades
associations/validations/callbacks to runtime-verified facts and wins on conflict. It does not replace Ruby LSP,
execute application code, or model engines, concerns' inherited associations, or metaprogrammed DSLs.
