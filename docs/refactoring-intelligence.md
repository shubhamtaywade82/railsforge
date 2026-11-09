# Refactoring Intelligence

Architectural refactoring recommendations for Ruby and Rails code, from one method to a whole class.

RailsForge measures the code first, decides which findings deserve attention second, and asks an AI model only when a developer requests analysis. Every recommendation names the measurements that justify it.

Source: [`src/refactoring-intelligence/`](../src/refactoring-intelligence/). Editor integration: [`src/providers/RefactoringCodeLensProvider.ts`](../src/providers/RefactoringCodeLensProvider.ts), [`src/providers/RefactoringCodeActionProvider.ts`](../src/providers/RefactoringCodeActionProvider.ts), [`vscode/RefactoringCommand.ts`](../src/refactoring-intelligence/vscode/RefactoringCommand.ts).

## Pipeline

| Stage | Module | Model call |
| --- | --- | --- |
| Scope: the method, class or selection the developer pointed at | `core/ScopeResolver.ts` | no |
| Candidates: deterministic findings with measured facts and evidence | `analyzers/*` | no |
| Techniques: which design techniques pass their validators for each candidate | `patterns/*` | no |
| Recommendations: the contract, ranked; priority and confidence derived | `recommendations/*` | no |
| Refinement: the model decides on the findings (recommend one allowed technique, or skip) | `core/RefactoringAdvisor.refine` | **yes, on request** |
| Plan: the model writes a unified diff over the recommendation's files | `core/RefactoringAdvisor.plan` | **yes, on a further request** |
| Validation and approval: the diff must apply, stay in scope and parse as Ruby; the user approves | `planning/*`, `vscode/RefactoringCommand.ts` | no |

CodeLens and the lightbulb run the first four stages only. Choosing a suggestion runs refinement; previewing a change runs plan.

## Where AI hints come from, and how long they last

The AI produces hints in two ways. Both store the result per scope (class, method or block), so it can be shown again without another model call.

| Source | When it runs | What is stored |
| --- | --- | --- |
| **Suggest Refactorings** (on request) | when you run it from the lightbulb, CodeLens or palette | the AI's recommendations for the scope; an empty result when it found nothing |
| **Background review** (opt-in, `railsForge.refactoring.aiHints: "on-save"`) | after you save a Ruby file | one scope per save: the highest-ranked scope whose current text has no observation |

An observation is kept in the workspace state (per project root), so it survives a reload. An observation is shown only while two things still match what the AI saw:

- **the scope's own text:** an edit inside the method or class hides its hints, but an edit elsewhere in the file does not, and moving a method does not invalidate it (scopes are keyed by name);
- **the context fingerprint:** a hash of what the advice depends on outside the scope, which is the definitions of constants the scope references, its spec, its callers and the project's conventions. Changing a referenced constant's file, or a spec, makes the hint stale even though the scope did not change.

The fingerprint deliberately excludes the primary file, because its own text is already covered by the scope hash.

An observation is in one of three states:

| State | Meaning | What the editor shows |
| --- | --- | --- |
| unobserved | never reviewed, or stale for either reason | rule-based findings, if any |
| observed with recommendations | the AI proposed at least one | the AI's hints (medium and high confidence only) |
| observed without recommendations | the AI looked and proposed nothing | "AI reviewed: nothing to change", and the review shows the AI's reasons for skipping |

When a scope is observed only with low-confidence recommendations, the rule-based findings still show, because a low-confidence AI item never takes the place of a stronger finding. The CodeLens and the lightbulb both follow this order, implemented once in `core/HintPrecedence.ts`.

Background reviews are queued, not dropped: a save of another file while a review runs waits its turn, and a document saved twice while queued is reviewed once, with its newest text.

Where observed hints appear:

- **CodeLens:** `✦ AI: 2 hints observed · high` (click to review them, no model call), or `✦ AI reviewed: nothing to change at this level` when the AI looked and found nothing. Without an observation, the rule-based lens (`✦ RailsForge: 1 refactoring opportunity`) is shown, and clicking it asks the AI.
- **Lightbulb:** `RailsForge: 2 AI hints observed for method X` opens the review without a model call. It takes precedence over the rule-based suggestion.
- **Command:** `RailsForge: Review AI Hints (observed)` lists the observed hints for the cursor's scope.

Choosing a hint opens its document. The AI writes a diff only when you then choose **Preview change**, and the diff is applied only after approval.

## The recommendation contract

Each recommendation has these fields, in this order in the document view:

| Field | Source |
| --- | --- |
| Scope | the anchor class, method or block |
| Problem | the candidate's headline, from the measured rule |
| Evidence | file, line range and note for each measurement |
| Confidence | from the rule's strength: strong = high, moderate = medium, weak = low. Never from the model |
| Priority | from severity and strength: severity 3 strong = critical; severity 3 moderate, or severity 2 strong = high; severity 2 moderate = medium; otherwise low. Never from the model |
| Technique | the best validated technique, or the model's choice among the validated ones |
| Design | the technique's design text, or the model's design for this code |
| Alternatives | the model's alternatives, then other validated techniques, techniques rejected here with the reason, declared alternatives marked "not validated", and "Keep the current code" |
| Benefit and risk | the technique's text, or the model's text for this code |
| Affected files | the primary file and any others the model names, each checked against the path rules |
| Steps and verification | the technique's text, or the model's text for this code |

## Candidate rules

Thresholds are conservative. Each is a measurement a reviewer would call a smell on its own. None is evidence for a pattern by itself; techniques decide that.

| Kind | Rule | Strength | Severity |
| --- | --- | --- | --- |
| `method.long` | 15 or more code lines (30 or more = 3) | strong | 2 |
| `method.deep-nesting` | block nesting depth 3 or more (4 or more = 3) | strong | 2 |
| `method.many-parameters` | 4 or more parameters (6 or more = 2) | strong | 1 |
| `method.mixed-collaborators` | 2 or more project collaborators and a persistence or external effect; not a controller | moderate | 2 |
| `method.conditional-chain` | 3 or more branches comparing the same discriminator (`if`/`elsif` or `case`/`when`) | moderate | 2 |
| `method.feature-envy` | 4 or more calls on one foreign receiver, at most one call to the class's own methods | weak | 2 |
| `method.complex-query` | 4 or more chained relation calls | moderate | 2 |
| `method.duplicate` | identical body (3 or more lines) in two methods of the same file | strong | 2 |
| `duplicate.cross-file` | a method whose body has token overlap of at least 0.75 (Jaccard) with a method in another file, as indexed at the last save. Strong at 0.90 or more, otherwise moderate. The method must still be at the same lines with the same name in the current file. | strong or moderate | 2 |
| `class.large` | 250 or more lines (500 or more = 3) | strong | 2 |
| `class.many-methods` | 15 or more methods (25 or more = 3) | strong | 2 |
| `class.hard-wired-collaborators` | 2 or more project classes created with `.new`; not a controller | moderate | 2 |
| `class.many-responsibilities` | 4 or more collaborators across 6 or more methods | moderate | 2 |
| `class.callback-heavy` | 4 or more lifecycle callbacks | moderate | 2 |
| `class.side-effect-callbacks` | 2 or more callbacks whose method or block mails, enqueues, publishes or persists | moderate | 2 |
| `rails.controller-workflow` | a public action that coordinates 2 or more project collaborators with a persistence or external effect (3 or more collaborators = 3) | moderate | 2 or 3 |
| `rails.inline-authorization` | 3 or more inline authorization checks in a controller | moderate | 2 |
| `rails.n-plus-one` | an association read inside a loop over a relation, from the existing N+1 analyzer and the schema tables | moderate | 2 |
| `rails.presentation-in-model` | a view helper (`number_to_currency`, `link_to`, ...) called in a model | moderate | 1 |
| `principle.srp-fat-class`, `principle.demeter`, `principle.yagni-unused-private` | findings from the existing design-principle linter, lifted into candidates | moderate | from the linter |

Project collaborators exclude the standard library and framework constants. When the semantic index is available, a constant counts only if the project defines it.

## Techniques and their validators

A technique is offered for a candidate only when its validator passes on the measured facts. Rejected techniques are kept with their reason and shown to the reviewer.

| Technique | Offered when | Counter-indications (always shown) |
| --- | --- | --- |
| Extract Method | the method is long or deeply nested | steps must share awkward local state; the length is a literal table |
| Extract Class | two or more collaborators, 15 or more methods, 250 or more lines, or the linter's SRP finding | one cohesive concept that is merely long |
| Service Object | a controller workflow, or a mixed-collaborator method, with two or more collaborators and a persistence or effect | a single CRUD action; a one-step workflow |
| Dependency Injection | two or more project classes created with `.new` | one stable collaborator; no test needs to replace it |
| Strategy | three or more branches **with real bodies** (two or more lines each) | one-line branches (use a Hash); a closed, small set of cases |
| Policy Object | three or more inline authorization checks | one role check; a policy gem already used consistently |
| Decorator | a view helper in a model | a plain accessor; one view and a small model |
| Domain Event | two or more callbacks with side effects | callbacks that only normalise data; effects that must share the save's transaction |
| Eager Loading | the N+1 finding is present | a bounded collection; the association is not read on each iteration |
| Query Object | four or more chained relation calls | one scope already expresses it; the chain is used once |
| Extract Shared Method | an identical duplicate in the same file | coincidental duplicates that will diverge |
| Extract Shared Collaborator | a cross-file duplicate with at least one partner file | copies in unrelated domains that will diverge; copies in specs or generated code |
| Move Method | one foreign receiver, few own-class calls | an adapter; a move that creates a cycle |
| Delegate | the linter's demeter finding | a deliberate fluent interface |
| Remove Unused Code | the linter's YAGNI finding | `send`/`public_send` or a framework hook calls it |

Form Object, Value Object, Factory, Adapter, Composition, Template Method and Specification are in the brief's catalog but are not modelled yet (see *Not yet built*).

## Operating rules, and where they are enforced

| Rule | Enforced by |
| --- | --- |
| No pattern without evidence | a technique is offered only after its validator passes; the model may only choose from the validated list |
| Never invent a problem | the model's decisions must name a candidate id that exists; anything else is rejected and retried once |
| Inspect related files before cross-file changes | the context builder sends the constants the target references, their defining files, the conventional spec, the callers and the project's pattern instances |
| Preserve conventions | the project's pattern instances are in the prompt; the plan keeps public names and transactions unless the recommendation says otherwise |
| Allow no recommendation | the model may skip a finding with a reason; "Keep the current code" is always offered |
| No cloud call per keystroke | CodeLens and the lightbulb use only the deterministic engine; the cache is keyed by file text and engine facts |
| Review before applying multi-file changes | the diff is previewed per file and approved in a modal; the buffers are re-checked before writing |
| Confidence from measurement | the model cannot change priority or confidence (its values are ignored) |

Safety boundaries for the diff: every path must be a workspace-relative `.rb` file under `app/`, `lib/`, `spec/` or `test/`; traversal, absolute paths, control characters, deletions and files outside the recommendation are rejected; each hunk must match the current buffer text; a new file may only be created from `/dev/null`; the diff must change something; every changed file must parse with `ruby -c`.

## Settings

- `railsForge.refactoring.codeLens` (default `true`): show the CodeLens. Turning it off does not affect the lightbulb or the command.
- `railsForge.refactoring.aiHints` (default `"off"`): `"on-save"` enables the background review. It sends the scope and related files to your AI provider after a save, without a request from you. It is restricted in untrusted workspaces, so a workspace settings file cannot turn it on. The review is debounced (2 seconds), runs one at a time, and asks about one scope per save.
- The AI provider is configured by `railsForge.ai.provider`, as for the chat agent. Code is sent to that provider when you request analysis or a preview.
- Apply limits: a recommendation's files must total 16,000 characters or fewer for an in-editor apply. For a local Ollama model, raise `railsForge.ollama.numCtx` for larger files.

## Status

**Batch 1 (this release).** Symbol-level analysis: scope resolution; method, class, Rails and principle-linter candidates; the technique catalog with validators; the recommendation contract; AI refinement and planning; CodeLens and lightbulb; the command. Covered by unit tests for each analyzer threshold, each validator, the contract, the parsers, the change planner's safety rules, the advisor's refusals, and the editor providers.

**Batch 2, first slice (this release).** Cross-file duplicate methods. `SemanticIndexAdapter.duplicateMethods()` now returns the groups from the persistent index's `DuplicateMethodDetector`, cached per completed index write. The engine turns each group into `duplicate.cross-file` candidates, and the advisor can propose a shared collaborator across the affected files, validated like every other plan. The lightbulb's "Extract shared method" quick fix is removed: it was never reachable, and its edit would have replaced the method, from its `def` line to just before the closing `end`, with one comment line.

**Not yet built.**

- *Batch 2, remainder.* Authorization and query duplication across controllers and files (`duplicate.authorization`, `duplicate.query`); collaborator evidence for cross-file candidates; cycle and coupling evidence beyond the callers list in the prompt.
- *Batch 3, execution.* A dedicated multi-file applier with checks for symlink targets and stale proposals; RuboCop and targeted test runs after applying; bounded repair from test failures; rollback reporting.
- *Batch 4, workspace view.* An architecture panel grouping recommendations across the project; background incremental analysis; health trends.
- *Catalog gaps.* Form Object, Value Object, Factory, Adapter, Composition, Template Method, Specification.
- *Evaluation.* A recommendation-quality evaluator (`evaluation/` in the brief) that measures precision against known-good fixtures.

**Known limitations.**

- The analyzers are line-based heuristics. Branch points include modifier forms; nesting follows `do`, `{ |x|` and block keywords; method bodies are read from the text. The evidence names each measurement so a reviewer can check it.
- The N+1 rule depends on the schema tables and on association names inferred from column names. It reports nothing when the schema is unknown.
- Project-collaborator checks depend on the semantic index. Until it is ready, collaborator-based rules report nothing rather than guessing.
- The design-principle findings exist only after the linter has analysed the file.
- **Cross-file copies come from the last save.** The index is written when a file is saved, so a copy in another file can be stale. A finding is raised only when this file's current parse still shows the method at the same lines under the same name. Every partner file is read from the editor buffers again before a plan is written, so a stale partner fails validation rather than producing an edit.
- **The duplicate scan is synchronous.** It runs once per completed index write, not per request. It compares every eligible pair of methods, skipping pairs whose token-set sizes are too far apart to reach the threshold (an exact prefilter, so no pair is lost). The cost is not measured on a large project yet.
- **One project root.** The analysis and the editor integration are bound to the project root that is active when the extension activates. Files in other workspace folders get no hints. Observations are stored per root, so the same relative path in two roots never shares one. Analysis of every folder is not built yet.
- The context fingerprint covers what the advice was built from. It does not detect a change in an unrelated file that would change the advice in some other way, for example a new caller in a file that is not yet indexed.
- The model's answers were exercised with scripted replies in the tests. Output quality against a live local or cloud model has not been measured.
