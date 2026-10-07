/**
 * RefactoringEditProvider - wraps `vscode.WorkspaceEdit` and `vscode.languages.applyEdit`.
 *
 * Every structural change RailsForge makes - extracting a Service Object, renaming a
 * Model, deleting dead code - goes through `WorkspaceEdit`. This is non-negotiable: it
 * is the only API surface that gives the user an atomic, undoable, previewable
 * transformation. Calling `fs.writeFileSync` directly would silently corrupt the
 * codebase and bypass the user's Accept/Reject Diff View.
 *
 * This class is a thin builder/facade over `WorkspaceEdit`. The actual refactoring
 * logic (ServiceExtractor, QueryExtractor, FormObjectExtractor, ValueObjectExtractor,
 * SpecFileGenerator) lives in `src/refactor/` and is fully unit-tested without VS
 * Code. Those modules return plain old `EditOperation` objects; this provider converts
 * them into a `WorkspaceEdit`, calls `applyEdit()`, and returns the user's accept/reject
 * decision.
 */

import * as vscode from 'vscode'

/** A single atomic edit operation - the lingua franca between refactor/ modules and this provider. */
export type EditOperation =
  | { kind: 'replace'; uri: vscode.Uri; range: vscode.Range; newText: string }
  | { kind: 'insert'; uri: vscode.Uri; position: vscode.Position; newText: string }
  | { kind: 'delete'; uri: vscode.Uri; range: vscode.Range }
  | { kind: 'createFile'; uri: vscode.Uri; contents?: string | Uint8Array; overwrite?: boolean }
  | { kind: 'renameFile'; oldUri: vscode.Uri; newUri: vscode.Uri; overwrite?: boolean }
  | { kind: 'deleteFile'; uri: vscode.Uri; recursive?: boolean; ignoreIfNotExists?: boolean }

/** Metadata shown in the diff view title and the Source Control commit message preview. */
export interface RefactoringMetadata {
  /** Human-readable label, e.g. "Extract CheckoutService from OrdersController#create". */
  label: string
  /** Optional commit message that Conventional Commit generation will pick up. */
  commitMessage?: string
}

/**
 * Builds a `WorkspaceEdit` from a list of `EditOperation`s and applies it atomically.
 */
export class RefactoringEditProvider {
  /**
   * Convert engine-side `EditOperation[]` to a `vscode.WorkspaceEdit` without applying
   * it. Exposed so callers (e.g. the @rails chat participant) can attach additional
   * metadata to the edit before applying.
   */
  buildWorkspaceEdit(operations: readonly EditOperation[]): vscode.WorkspaceEdit {
    const edit = new vscode.WorkspaceEdit()
    for (const op of operations) {
      switch (op.kind) {
        case 'replace':
          edit.replace(op.uri, op.range, op.newText)
          break
        case 'insert':
          edit.insert(op.uri, op.position, op.newText)
          break
        case 'delete':
          edit.delete(op.uri, op.range)
          break
        case 'createFile':
          edit.createFile(op.uri, {
            contents: op.contents instanceof Uint8Array ? op.contents : (op.contents !== undefined ? Buffer.from(op.contents, 'utf8') : undefined),
            overwrite: op.overwrite ?? false,
            ignoreIfExists: !(op.overwrite ?? false),
          })
          break
        case 'renameFile':
          edit.renameFile(op.oldUri, op.newUri, {
            overwrite: op.overwrite ?? false,
            ignoreIfExists: !(op.overwrite ?? false),
          })
          break
        case 'deleteFile':
          edit.deleteFile(op.uri, {
            recursive: op.recursive ?? false,
            ignoreIfNotExists: op.ignoreIfNotExists ?? true,
          })
          break
      }
    }
    return edit
  }

  /**
   * Apply the operations atomically. VS Code shows the user a Diff View to Accept/Reject
   * the changes before they are written to disk.
   *
   * @returns `true` if the user accepted the edit, `false` if they rejected it or the
   *          apply call failed for any other reason.
   */
  async apply(operations: readonly EditOperation[], metadata?: RefactoringMetadata): Promise<boolean> {
    const edit = this.buildWorkspaceEdit(operations)
    try {
      // VS Code's WorkspaceEditMetadata only exposes `isRefactoring?: boolean` - the
      // human-readable label is for our own logging only, not surfaced by the API.
      const accepted = await vscode.workspace.applyEdit(edit, { isRefactoring: true })
      if (!accepted && metadata) {
        console.warn(`[RailsForge] RefactoringEditProvider.apply("${metadata.label}") was rejected by the user or VS Code.`)
      }
      return accepted
    } catch (err) {
      console.warn(`[RailsForge] RefactoringEditProvider.apply("${metadata?.label ?? 'refactoring'}") failed:`, err)
      return false
    }
  }

  /**
   * Scaffold one or more new files atomically. Used by ServiceExtractor /
   * SpecFileGenerator to create `app/services/checkout_service.rb` and
   * `spec/services/checkout_service_spec.rb` together - if either file already exists
   * and `overwrite` is false, the entire operation is rejected by VS Code.
   */
  async scaffoldFiles(files: ReadonlyArray<{ uri: vscode.Uri; contents: string; overwrite?: boolean }>, label: string): Promise<boolean> {
    const ops: EditOperation[] = files.map(f => ({
      kind: 'createFile',
      uri: f.uri,
      contents: f.contents,
      overwrite: f.overwrite ?? false,
    }))
    return this.apply(ops, { label })
  }

  /**
   * Rename a Model file and update its related migration, factory, and route files
   * atomically. The `extraEdits` parameter carries the in-file text replacements the
   * rename triggers across the codebase; the rename itself is a single
   * `renameFile` operation.
   */
  async renameWithDependents(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    extraEdits: readonly EditOperation[],
    label: string,
  ): Promise<boolean> {
    const ops: EditOperation[] = [
      { kind: 'renameFile', oldUri, newUri, overwrite: false },
      ...extraEdits,
    ]
    return this.apply(ops, { label })
  }
}
