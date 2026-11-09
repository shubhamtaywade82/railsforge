/**
 * TechniqueCatalog - the design techniques RailsForge may recommend, each guarded by validators.
 *
 * A technique is eligible for a candidate only when its validator passes on the candidate's measured
 * facts. That is the rule that stops "a case statement exists, so introduce Strategy": Strategy needs
 * at least three branches with real bodies, otherwise the validator rejects it and the advisor never
 * sees the option. Each technique also states when it should be avoided, and the AI and the user see
 * those conditions next to the recommendation.
 *
 * Texts are original to RailsForge. Catalog ids link to the Design Patterns sidebar where an entry exists.
 */

import type { Candidate, CandidateKind } from '../core/types'

export type Verdict = { ok: true } | { ok: false; reason: string }

export interface Technique {
  id: string
  name: string
  /** Link into the Design Patterns catalog (src/patterns/PatternCatalog), when one exists. */
  catalogId?: string
  intent: string
  appliesTo: readonly CandidateKind[]
  /** Facts that must hold before this technique can be recommended. */
  validate(candidate: Candidate): Verdict
  whenToUse: readonly string[]
  /** Counter-indications: the situations where the technique is the wrong answer. */
  avoidWhen: readonly string[]
  /** Other techniques that could fit the same candidate. */
  alternatives: readonly string[]
  design(candidate: Candidate): string
  benefit: string
  risk: string
  steps(candidate: Candidate): string[]
  verification(candidate: Candidate): string[]
}

const ok: Verdict = { ok: true }
const no = (reason: string): Verdict => ({ ok: false, reason })

function scopeName(c: Candidate): string {
  if (c.anchor === 'method' && c.methodName) {return c.className ? `${c.className}#${c.methodName}` : c.methodName}
  return c.className ?? c.path
}

export const TECHNIQUES: readonly Technique[] = [
  {
    id: 'extract-method',
    name: 'Extract Method',
    intent: 'Name each separable step so the method reads as an outline.',
    appliesTo: ['method.long', 'method.deep-nesting'],
    validate: c => {
      const lines = c.metrics.lines ?? 0
      const depth = c.metrics.depth ?? 0
      return lines >= 15 || depth >= 3 ? ok : no('the method is neither long nor deeply nested')
    },
    whenToUse: ['A block of the method performs one named step that could be described in a short method name.'],
    avoidWhen: [
      'The steps must run in order and share local state that is awkward to pass around.',
      'The method is long only because it is a literal table or a data setup.',
    ],
    alternatives: ['extract-class', 'service-object'],
    design: c => `Extract the separable steps of ${scopeName(c)} into private methods named after what they do; keep the original method as a short outline.`,
    benefit: 'Shorter methods that are easier to test and to read; each step gets a name.',
    risk: 'Low. Behaviour is unchanged if local variables are passed explicitly and the early returns are preserved.',
    steps: c => [`Choose the steps inside ${scopeName(c)} that have a single purpose.`, 'Move each into a private method and pass the locals it needs as arguments.'],
    verification: () => ['Run the existing specs for this file.', 'Check that early returns and exceptions behave as before.'],
  },
  {
    id: 'extract-class',
    name: 'Extract Class',
    intent: 'Split a class that carries more than one responsibility into focused classes.',
    appliesTo: ['class.large', 'class.many-methods', 'class.many-responsibilities', 'principle.srp-fat-class'],
    validate: c => {
      // The linter has already measured the SRP violation; its finding is the evidence.
      if (c.metrics.principleId === 'SRP-FAT-CLASS') {return ok}
      const collaborators = c.metrics.collaborators?.length ?? 0
      const methods = c.metrics.methods ?? 0
      const lines = c.metrics.lines ?? 0
      return collaborators >= 2 || methods >= 15 || lines >= 250 ? ok : no('no measurable split (fewer than two collaborators, under 15 methods, under 250 lines)')
    },
    whenToUse: ['Methods group into clusters that use disjoint sets of fields or collaborators.', 'Two or more clusters would have different reasons to change.'],
    avoidWhen: ['The class is one cohesive concept that is merely long.', 'Splitting would create classes with one method and no state of their own.'],
    alternatives: ['extract-method', 'service-object'],
    design: c => `Split ${scopeName(c)} into classes along its responsibility clusters, keeping the original class as a facade if callers depend on it.`,
    benefit: 'Each class has one reason to change and can be tested on its own.',
    risk: 'Medium. Callers that reach into the class directly must keep working; check public method names.',
    steps: () => ['List the methods and the fields or collaborators each one uses.', 'Group methods by the state they touch.', 'Move each group into its own class and delegate from the original.'],
    verification: () => ['Run the specs for the original class and the new classes.', 'Confirm no public method was removed from the original class.'],
  },
  {
    id: 'service-object',
    name: 'Service Object',
    catalogId: 'service-object',
    intent: 'Move a multi-step business workflow out of the controller or model into one callable object.',
    appliesTo: ['rails.controller-workflow', 'method.mixed-collaborators'],
    validate: c => {
      const collaborators = c.metrics.collaborators?.length ?? 0
      const effects = (c.metrics.persistenceCalls ?? 0) + (c.metrics.externalEffects ?? 0)
      return collaborators >= 2 && effects >= 1 ? ok : no('the workflow has fewer than two collaborators or no persistence or external effect')
    },
    whenToUse: ['An action coordinates several collaborators and persists or calls an external system.', 'The same workflow is needed from more than one entry point.'],
    avoidWhen: [
      'The action is a single create, update or destroy with no other collaborator.',
      'The workflow has one step; a service would only rename the method.',
    ],
    alternatives: ['extract-method', 'domain-event'],
    design: c => `Move the workflow in ${scopeName(c)} into a service object with one public entry point. The controller keeps HTTP concerns: params, redirects and rendering.`,
    benefit: 'The controller becomes orchestration only, and the workflow can be tested without a request.',
    risk: 'Medium. Transactions, callbacks and the order of side effects must be preserved exactly. External calls are not rolled back by a database transaction.',
    steps: c => [
      `Create the service with the workflow currently inside ${scopeName(c)}.`,
      'Inject the collaborators it uses.',
      'Replace the workflow in the action with a call to the service, keeping params and response handling in the controller.',
    ],
    verification: () => ['Run the request or controller specs for this action.', 'Run the new service specs for the success path and each failure path.'],
  },
  {
    id: 'dependency-injection',
    name: 'Dependency Injection',
    intent: 'Pass collaborators in instead of creating them with .new inside the class.',
    appliesTo: ['class.hard-wired-collaborators'],
    validate: c => {
      const instantiated = c.metrics.instantiated?.length ?? 0
      return instantiated >= 2 ? ok : no('fewer than two project collaborators are instantiated directly')
    },
    whenToUse: ['The class is tested with real collaborators that should be doubles.', 'More than one implementation of a collaborator is expected.'],
    avoidWhen: [
      'There is one stable collaborator and no test needs to replace it.',
      'The collaborator is a value object created on the spot, not a service.',
    ],
    alternatives: ['service-object'],
    design: c => `Accept ${(c.metrics.instantiated ?? []).join(', ')} as keyword arguments with the current classes as defaults, so callers and tests can substitute them.`,
    benefit: 'Collaborators are visible in the constructor, and tests can substitute doubles without stubbing constants.',
    risk: 'Low. Defaults keep existing call sites working; check that no caller relied on a fresh instance per call.',
    steps: () => ['Add keyword arguments for each instantiated collaborator, defaulting to the current class.', 'Replace the inline .new calls with the stored collaborators.'],
    verification: () => ['Run the specs for the class.', 'Confirm one spec injects a double for each collaborator.'],
  },
  {
    id: 'strategy',
    name: 'Strategy',
    catalogId: 'strategy',
    intent: 'Replace a conditional that selects between behaviours with objects that implement one interface.',
    appliesTo: ['method.conditional-chain'],
    validate: c => {
      const branches = c.metrics.discriminatorBranches ?? 0
      const nonTrivial = c.metrics.nonTrivialBranches ?? 0
      if (branches < 3) {return no(`only ${branches} branches; a Strategy needs at least three behaviours`)}
      if (nonTrivial < 3) {return no(`only ${nonTrivial} branches have real bodies; one-line branches are a lookup table, not behaviour`)}
      return ok
    },
    whenToUse: ['Each branch runs a different algorithm with its own helpers.', 'New cases are expected, and each one needs its own tests.'],
    avoidWhen: [
      'The branches only map a value to a constant or a string (use a Hash).',
      'The set of cases is closed, small and unlikely to grow.',
      'The behaviours do not vary independently of the discriminator.',
    ],
    alternatives: ['extract-method', 'remove-unused-code'],
    design: c => `Introduce one strategy object per branch of the ${c.metrics.discriminator ?? 'discriminator'} conditional in ${scopeName(c)}, selected by a small factory or lookup. Confirm the branches will keep varying before adding it.`,
    benefit: 'Adding a case means adding a class; each behaviour is tested in isolation.',
    risk: 'Medium. Adds indirection; the selection logic moves and must still cover every current value, including the default.',
    steps: c => [
      `List every value of ${c.metrics.discriminator ?? 'the discriminator'} and the behaviour of each branch.`,
      'Create one class per branch with a single public method.',
      'Replace the conditional with a lookup that returns the strategy, and keep a default for unknown values.',
    ],
    verification: () => ['Add a spec that exercises every current value and the default.', 'Run the existing specs for this method.'],
  },
  {
    id: 'policy-object',
    name: 'Policy Object',
    catalogId: 'policy-object',
    intent: 'Gather scattered authorization checks into one policy that answers "can this user do this?".',
    appliesTo: ['rails.inline-authorization'],
    validate: c => ((c.metrics.authChecks ?? 0) >= 3 ? ok : no('fewer than three inline authorization checks')),
    whenToUse: ['The same role or ownership rule is checked in several actions.', 'Authorization rules are the same across entry points.'],
    avoidWhen: ['One role check in one place, which is clearer inline.', 'The project already authorizes through a policy gem consistently.'],
    alternatives: ['extract-method'],
    design: () => 'Move the repeated checks into a policy object with one predicate per action, and call it from the controller before the workflow runs.',
    benefit: 'Authorization is in one place and can be tested without a request.',
    risk: 'High. A missed check is a security defect. Each predicate must match the current inline check exactly.',
    steps: () => ['List each inline check and the action it guards.', 'Create one predicate per action with the same logic.', 'Replace each inline check with the predicate and keep the same failure response.'],
    verification: () => ['Add one spec per action for the allowed and the denied user.', 'Confirm every previously guarded action is still guarded.'],
  },
  {
    id: 'decorator',
    name: 'Decorator',
    catalogId: 'decorator',
    intent: 'Move presentation logic out of the model and into a decorator around it.',
    appliesTo: ['rails.presentation-in-model'],
    validate: c => ((c.metrics.presentationCalls ?? 0) >= 1 ? ok : no('the model method calls no view helper')),
    whenToUse: ['A model method formats a value for display.', 'The formatting differs between views or formats.'],
    avoidWhen: ['A plain attribute accessor with no formatting.', 'Only one view uses the method and the model is small.'],
    alternatives: ['extract-method'],
    design: c => `Move the formatting in ${scopeName(c)} into a decorator that wraps the model and is used by the view.`,
    benefit: 'Models stay free of view helpers and presentation can change without touching domain code.',
    risk: 'Low. Views must call the decorator instead of the model method.',
    steps: () => ['Create a decorator that delegates to the model.', 'Move the formatting method to it.', 'Update the views to call the decorated method.'],
    verification: () => ['Run the view or helper specs for the affected views.', 'Check that formatted output is unchanged.'],
  },
  {
    id: 'domain-event',
    name: 'Domain Event',
    intent: 'Publish one event when a business fact happens, and let subscribers perform the side effects.',
    appliesTo: ['class.side-effect-callbacks', 'class.callback-heavy'],
    validate: c => ((c.metrics.sideEffectCallbacks ?? 0) >= 2 ? ok : no('fewer than two callbacks perform a side effect; callbacks that only normalise data should stay')),
    whenToUse: ['Callbacks send mail, enqueue jobs or call external systems.', 'Several unrelated effects hang off the same save.'],
    avoidWhen: ['The callbacks only normalise or validate attributes.', 'The side effect must happen in the same transaction as the save.'],
    alternatives: ['service-object'],
    design: c => `Publish a domain event from ${c.className ?? 'the model'} after the business change, and move the side effects to subscribers or jobs.`,
    benefit: 'Side effects are visible in one place and can be added or removed without editing the model.',
    risk: 'High. Ordering and transactional guarantees change: a subscriber that fails after commit does not roll back the save.',
    steps: () => ['List each callback and the side effect it triggers.', 'Publish one event at the point of the business change.', 'Move each side effect into a subscriber, keeping its current transaction semantics.'],
    verification: () => ['Test that the event fires once for each successful change.', 'Test each subscriber in isolation.', 'Check the ordering of side effects against the current callbacks.'],
  },
  {
    id: 'eager-loading',
    name: 'Eager Loading',
    intent: 'Load an association for the whole collection before the loop reads it.',
    appliesTo: ['rails.n-plus-one'],
    validate: c => (c.metrics.nPlusOne ? ok : no('no N+1 finding was produced for this loop')),
    whenToUse: ['The loop reads an association on every record.', 'The collection can hold many records.'],
    avoidWhen: ['The collection is bounded to a handful of records.', 'The association is not read on every iteration.'],
    alternatives: ['query-object'],
    design: c => `Preload ${c.metrics.nPlusOne?.association ?? 'the association'} on the relation that feeds the loop with includes or preload.`,
    benefit: 'One query for the association instead of one per record.',
    risk: 'Low. Preloading changes what is loaded, not the result; verify the association name is declared on the model.',
    steps: c => [`Confirm ${c.metrics.nPlusOne?.association ?? 'the association'} is declared on the loop's model.`, 'Add includes to the relation feeding the loop.'],
    verification: () => ['Check the SQL log: one query for the association, not one per record.', 'Run the specs for this loop.'],
  },
  {
    id: 'query-object',
    name: 'Query Object',
    catalogId: 'query-object',
    intent: 'Move a complex relation chain into a named query object that can be reused and tested.',
    appliesTo: ['method.complex-query'],
    validate: c => ((c.metrics.queryCalls ?? 0) >= 4 ? ok : no('the query chain has fewer than four calls')),
    whenToUse: ['The same relation chain appears in more than one place.', 'The chain is hard to read inline.'],
    avoidWhen: ['A single scope on the model already expresses it.', 'The chain is used exactly once and reads clearly.'],
    alternatives: ['eager-loading'],
    design: c => `Move the relation chain in ${scopeName(c)} into a query object with one method that returns the relation.`,
    benefit: 'The query has a name and can be composed and tested without a request.',
    risk: 'Low. The returned relation must keep the same ordering and preloads.',
    steps: () => ['Create the query object with the current chain.', 'Return a relation from one public method.', 'Replace the chain with a call to the query object.'],
    verification: () => ['Compare the generated SQL before and after.', 'Run the specs for the callers.'],
  },
  {
    id: 'extract-shared-method',
    name: 'Extract Shared Method',
    intent: 'Keep one copy of a method body that is repeated verbatim.',
    appliesTo: ['method.duplicate'],
    validate: c => ((c.metrics.duplicateOf?.length ?? 0) >= 1 ? ok : no('no duplicate partner was found')),
    whenToUse: ['The copies must change together.', 'The duplicated logic is a business rule.'],
    avoidWhen: ['The copies are coincidentally identical and will diverge.', 'The copies belong to unrelated domains.'],
    alternatives: ['extract-method'],
    design: c => `Keep one implementation of the duplicated body in a shared private method and call it from ${scopeName(c)} and its duplicates.`,
    benefit: 'A change to the rule happens in one place.',
    risk: "Low within one class. Check that each copy's callers expect the same behaviour.",
    steps: () => ['Move the shared body into a private method.', 'Replace each copy with a call to it.'],
    verification: () => ['Run the specs for each method that now delegates.'],
  },
  {
    id: 'move-method',
    name: 'Move Method',
    intent: 'Move a method to the class whose data it uses most.',
    appliesTo: ['method.feature-envy'],
    validate: c => {
      const calls = c.metrics.receiverCalls ?? 0
      const own = c.metrics.ownMethodCalls ?? 0
      const receivers = c.metrics.receivers?.length ?? 0
      if (receivers !== 1) {return no('the method calls more than one foreign receiver')}
      return calls >= 4 && own <= 1 ? ok : no('the method uses its own class too much to be envious')
    },
    whenToUse: ['The method reads almost only another object\'s data.', 'The other class is the natural home for the behaviour.'],
    avoidWhen: ['The method is a deliberate adapter between two classes.', 'Moving it would create a dependency cycle.'],
    alternatives: ['delegate', 'extract-method'],
    design: c => `Move ${scopeName(c)} to the class behind ${(c.metrics.receivers ?? ['the receiver'])[0]}, or extract the envious part into a method on that class.`,
    benefit: 'Behaviour sits next to the data it uses.',
    risk: 'Medium. Callers must be updated and the method may need to access the old class through an argument.',
    steps: () => ['Check the target class does not already depend on the current class.', 'Move the method and update its callers.'],
    verification: () => ['Run the specs for both classes.', 'Check for dependency cycles introduced by the move.'],
  },
  {
    id: 'delegate',
    name: 'Delegate',
    intent: 'Hide a message chain behind one method on the object that owns it.',
    appliesTo: ['principle.demeter'],
    validate: c => (c.metrics.principleId === 'DEMETER-VIOLATION' ? ok : no('the finding is not a message-chain violation')),
    whenToUse: ['A caller walks through several objects to reach data it needs.'],
    avoidWhen: ['The chain is a fluent interface designed to be chained.', 'A single hop already exists and reads clearly.'],
    alternatives: ['move-method'],
    design: () => 'Add a delegating method on the object closest to the caller and call that method instead of the chain.',
    benefit: 'Callers depend on one object instead of the internals of several.',
    risk: 'Low. The delegate must return the same value as the chain.',
    steps: () => ['Add the delegating method.', 'Replace the chain at the call site.'],
    verification: () => ['Run the specs for the caller.'],
  },
  {
    id: 'remove-unused-code',
    name: 'Remove Unused Code',
    intent: 'Delete a private method nothing calls.',
    appliesTo: ['principle.yagni-unused-private'],
    validate: c => (c.metrics.principleId === 'YAGNI-UNUSED-PRIVATE' ? ok : no('the finding is not an unused-private finding')),
    whenToUse: ['No caller exists in the project and the method is private.'],
    avoidWhen: ['The method is called with send or public_send.', 'A framework hook or callback calls it by name.'],
    alternatives: [],
    design: () => 'Delete the unused private method.',
    benefit: 'Less code to read and maintain.',
    risk: 'Low for private methods, unless the method is invoked dynamically.',
    steps: () => ['Search the project for the method name, including send and public_send.', 'Delete the method.'],
    verification: () => ['Run the full spec suite for the file.'],
  },
]

export function techniqueById(id: string): Technique | undefined {
  return TECHNIQUES.find(t => t.id === id)
}
