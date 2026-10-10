/**
 * LanguageIntelligenceProvider - wraps every `vscode.languages.*` registration that
 * RailsForge needs. This is the largest functional domain in the VS Code API and the
 * core of the IDE-grade guardrail surface.
 *
 * Architecture rule: business logic (Tree-sitter parsing, SQLite indexing, POODR rule
 * evaluation) lives in the engine. This class is *only* the VS Code adapter - it wires
 * engine results into the right `vscode.languages.*` registration and converts engine
 * types (`PrincipleViolation`, `ProjectPatternInstance`, ...) into VS Code types
 * (`vscode.Diagnostic`, `vscode.CodeLens`, `vscode.Hover`, ...).
 *
 * The provider accepts factory callbacks for each sub-provider (CodeAction, Hover,
 * CodeLens, Definition, Reference, Completion, DocumentSymbol, Diagnostic). This keeps
 * the constructor signature stable while letting the registry pass in the right
 * engine-coupled implementation. Each factory receives the active `SemanticIndex` and
 * `PatternCatalogAccess` so the sub-providers stay decoupled from concrete engine
 * classes.
 */

import * as vscode from 'vscode'
import { SemanticIndex } from './SemanticIndex'
import { PatternCatalogAccess } from './PatternCatalogAccess'

/** Selectors RailsForge cares about - shared by every language registration.
 * Typed as `DocumentFilter[]` (not `DocumentSelector[]`) because the array form of
 * `DocumentSelector` is itself `readonly (string | DocumentFilter)[]` - declaring
 * our constant as `DocumentSelector[]` would widen each element to include the
 * nested-array variant and break assignability to the register* functions. */
export const RAILSFORGE_SELECTORS: readonly vscode.DocumentFilter[] = [
  { scheme: 'file', language: 'ruby' },
  { scheme: 'file', language: 'erb' },
  { scheme: 'file', language: 'haml' },
  { scheme: 'file', language: 'slim' },
  { scheme: 'file', language: 'plaintext' }, // db/schema.rb is sometimes detected as plaintext
]

/**
 * Factory map - one entry per `vscode.languages.register*` API. The registry supplies
 * these; if a factory is absent, that language feature is simply not registered.
 */
export interface LanguageIntelligenceFactories {
  /** Powers the lightbulb menu ("Extract to Service", "Fix Demeter Violation", ...). */
  codeActions?(index: SemanticIndex, catalog: PatternCatalogAccess): vscode.CodeActionProvider
  /** Schema Peek, APIDock community notes, Dependency Graph summaries. */
  hover?(index: SemanticIndex, catalog: PatternCatalogAccess): vscode.HoverProvider
  /** Inline metadata ("3 similar services", "4 Services - 2 Queries"). */
  codeLens?(index: SemanticIndex, catalog: PatternCatalogAccess): vscode.CodeLensProvider
  /** Sandi Metz rules, SRP violations, YAGNI warnings. */
  diagnostics?(index: SemanticIndex, catalog: PatternCatalogAccess): vscode.DiagnosticCollection
  /** Rails route helpers, Stimulus targets, DB column names. */
  completion?(index: SemanticIndex, catalog: PatternCatalogAccess): vscode.CompletionItemProvider
  /** Cmd+Click from a Stimulus `data-controller` string to the TS/JS controller file. */
  definition?(index: SemanticIndex, catalog: PatternCatalogAccess): vscode.DefinitionProvider
  /** Find all usages of a Rails concern or background job across the codebase. */
  reference?(index: SemanticIndex, catalog: PatternCatalogAccess): vscode.ReferenceProvider
  /** Structured outline of Ruby classes, modules, and methods in the Outline pane. */
  documentSymbol?(index: SemanticIndex, catalog: PatternCatalogAccess): vscode.DocumentSymbolProvider
  /** Implementation provider - jump from interface to concrete Ruby class. */
  implementation?(index: SemanticIndex, catalog: PatternCatalogAccess): vscode.ImplementationProvider
  /** Type definition provider - jump from a typed Ruby constant to its RBS signature. */
  typeDefinition?(index: SemanticIndex, catalog: PatternCatalogAccess): vscode.TypeDefinitionProvider
  /** Rename provider - updates routes, factories, and migration files atomically. */
  rename?(index: SemanticIndex, catalog: PatternCatalogAccess): vscode.RenameProvider
  /** Document formatting via RuboCop autocorrect. */
  documentFormatting?(index: SemanticIndex, catalog: PatternCatalogAccess): vscode.DocumentFormattingEditProvider
  /** Document link provider - clickable `data-controller="x"` strings in ERB. */
  documentLink?(index: SemanticIndex, catalog: PatternCatalogAccess): vscode.DocumentLinkProvider
  /** Document color provider - hex/rgb colors in ERB stylesheets. */
  documentColor?(index: SemanticIndex, catalog: PatternCatalogAccess): vscode.DocumentColorProvider
  /** Signature help - parameter hints for Rails helpers and service object constructors. */
  signatureHelp?(index: SemanticIndex, catalog: PatternCatalogAccess): vscode.SignatureHelpProvider
  /** Folding range provider - fold Ruby `do...end`, `begin...rescue`, etc. */
  foldingRange?(index: SemanticIndex, catalog: PatternCatalogAccess): vscode.FoldingRangeProvider
  /** Selection range provider - expand selection to method, then class, then module. */
  selectionRange?(index: SemanticIndex, catalog: PatternCatalogAccess): vscode.SelectionRangeProvider
  /** Call hierarchy provider - incoming/outgoing calls for a Ruby method. */
  callHierarchy?(index: SemanticIndex, catalog: PatternCatalogAccess): vscode.CallHierarchyProvider
  /** Linked editing range - rename matching `do |x|`/`end` placeholders together. */
  linkedEditingRange?(index: SemanticIndex, catalog: PatternCatalogAccess): vscode.LinkedEditingRangeProvider
  /** Inline values - show `# => "value"` hints next to assignments during debug. */
  inlineValues?(index: SemanticIndex, catalog: PatternCatalogAccess): vscode.InlineValuesProvider
  /** Inlay hints - show inferred types and method return signatures inline. */
  inlayHints?(index: SemanticIndex, catalog: PatternCatalogAccess): vscode.InlayHintsProvider
}

/**
 * Wraps every `vscode.languages.register*` call into one disposable container.
 * The registry owns the lifecycle; nothing else in the codebase calls
 * `vscode.languages.register*` directly for these features.
 */
export class LanguageIntelligenceProvider implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = []

  constructor(
    private readonly index: SemanticIndex,
    private readonly catalog: PatternCatalogAccess,
    private readonly factories: LanguageIntelligenceFactories,
  ) {}

  activate(): void {
    const f = this.factories

    if (f.codeActions) {
      this.disposables.push(
        vscode.languages.registerCodeActionsProvider(
          RAILSFORGE_SELECTORS,
          f.codeActions(this.index, this.catalog),
          { providedCodeActionKinds: [vscode.CodeActionKind.RefactorExtract, vscode.CodeActionKind.QuickFix] },
        ),
      )
    }

    if (f.hover) {
      this.disposables.push(vscode.languages.registerHoverProvider(RAILSFORGE_SELECTORS, f.hover(this.index, this.catalog)))
    }

    if (f.codeLens) {
      this.disposables.push(vscode.languages.registerCodeLensProvider(RAILSFORGE_SELECTORS, f.codeLens(this.index, this.catalog)))
    }

    if (f.diagnostics) {
      // The DiagnosticCollection is itself the disposable - the factory returns the
      // created collection, not a provider object.
      this.disposables.push(f.diagnostics(this.index, this.catalog))
    }

    if (f.completion) {
      this.disposables.push(
        vscode.languages.registerCompletionItemProvider(
          RAILSFORGE_SELECTORS,
          f.completion(this.index, this.catalog),
          '.', ':', "'", '"', '/', '_', // trigger characters for routes, schema, stimulus
        ),
      )
    }

    if (f.definition) {
      this.disposables.push(vscode.languages.registerDefinitionProvider(RAILSFORGE_SELECTORS, f.definition(this.index, this.catalog)))
    }

    if (f.reference) {
      this.disposables.push(vscode.languages.registerReferenceProvider(RAILSFORGE_SELECTORS, f.reference(this.index, this.catalog)))
    }

    if (f.documentSymbol) {
      this.disposables.push(vscode.languages.registerDocumentSymbolProvider(RAILSFORGE_SELECTORS, f.documentSymbol(this.index, this.catalog)))
    }

    if (f.implementation) {
      this.disposables.push(vscode.languages.registerImplementationProvider(RAILSFORGE_SELECTORS, f.implementation(this.index, this.catalog)))
    }

    if (f.typeDefinition) {
      this.disposables.push(vscode.languages.registerTypeDefinitionProvider(RAILSFORGE_SELECTORS, f.typeDefinition(this.index, this.catalog)))
    }

    if (f.rename) {
      this.disposables.push(
        vscode.languages.registerRenameProvider(RAILSFORGE_SELECTORS, f.rename(this.index, this.catalog)),
      )
    }

    if (f.documentFormatting) {
      this.disposables.push(vscode.languages.registerDocumentFormattingEditProvider(RAILSFORGE_SELECTORS, f.documentFormatting(this.index, this.catalog)))
    }

    if (f.documentLink) {
      this.disposables.push(vscode.languages.registerDocumentLinkProvider(RAILSFORGE_SELECTORS, f.documentLink(this.index, this.catalog)))
    }

    if (f.documentColor) {
      this.disposables.push(vscode.languages.registerColorProvider(RAILSFORGE_SELECTORS, f.documentColor(this.index, this.catalog)))
    }

    if (f.signatureHelp) {
      this.disposables.push(
        vscode.languages.registerSignatureHelpProvider(
          RAILSFORGE_SELECTORS,
          f.signatureHelp(this.index, this.catalog),
          '(', ',', // trigger characters
        ),
      )
    }

    if (f.foldingRange) {
      this.disposables.push(vscode.languages.registerFoldingRangeProvider(RAILSFORGE_SELECTORS, f.foldingRange(this.index, this.catalog)))
    }

    if (f.selectionRange) {
      this.disposables.push(vscode.languages.registerSelectionRangeProvider(RAILSFORGE_SELECTORS, f.selectionRange(this.index, this.catalog)))
    }

    if (f.callHierarchy) {
      this.disposables.push(vscode.languages.registerCallHierarchyProvider(RAILSFORGE_SELECTORS, f.callHierarchy(this.index, this.catalog)))
    }

    if (f.linkedEditingRange) {
      this.disposables.push(vscode.languages.registerLinkedEditingRangeProvider(RAILSFORGE_SELECTORS, f.linkedEditingRange(this.index, this.catalog)))
    }

    if (f.inlineValues) {
      this.disposables.push(vscode.languages.registerInlineValuesProvider(RAILSFORGE_SELECTORS, f.inlineValues(this.index, this.catalog)))
    }

    if (f.inlayHints) {
      this.disposables.push(vscode.languages.registerInlayHintsProvider(RAILSFORGE_SELECTORS, f.inlayHints(this.index, this.catalog)))
    }
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose()
    }
    this.disposables.length = 0
  }
}
