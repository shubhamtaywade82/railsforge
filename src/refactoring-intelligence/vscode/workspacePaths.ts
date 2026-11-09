/**
 * VS Code helpers shared by the refactoring providers and the command: workspace-relative paths,
 * selection conversion, progress notifications, and the buffer-first source reader.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'
import type { SelectionLines } from '../core/ScopeResolver'
import type { SourceReader } from '../core/types'

/** Workspace-relative path with forward slashes, or undefined when the file lies outside the root. */
export function relativeTo(root: string, file: string): string | undefined {
  const relative = path.relative(root, file)
  if (relative === '' || path.isAbsolute(relative) || relative.split(path.sep)[0] === '..') {return undefined}
  return relative.split(path.sep).join('/')
}

/** VS Code positions are zero-based; the pipeline uses 1-based lines. */
export function toSelectionLines(range: vscode.Range | vscode.Selection): SelectionLines {
  return { startLine: range.start.line + 1, endLine: range.end.line + 1, isEmpty: range.isEmpty }
}

export function withProgress<T>(title: string, task: () => Promise<T>): Thenable<T> {
  return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, () => task())
}

/**
 * A buffer-first reader bound to one project root. Open editors win over disk, so unsaved edits are
 * what the model sees and what a change is computed against.
 */
export function vsCodeSourceReader(root: string): SourceReader {
  return {
    async read(relativePath: string): Promise<string | undefined> {
      const absolute = path.resolve(root, relativePath)
      const open = vscode.workspace.textDocuments.find(d => d.uri.scheme === 'file' && path.resolve(d.uri.fsPath) === absolute)
      if (open) {return open.getText()}
      try {
        return await fs.promises.readFile(absolute, 'utf8')
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {return undefined}
        throw err
      }
    },
  }
}
