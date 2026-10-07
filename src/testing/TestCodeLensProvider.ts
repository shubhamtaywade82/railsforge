/**
 * TestCodeLensProvider - Injects inline Run/Debug CodeLens above RSpec & Minitest blocks
 */

import * as vscode from 'vscode'
import { isWorkspaceTrusted } from '../workspace/Trust'

export class TestCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    // Run/Debug lenses launch project code: not offered in Restricted Mode.
    if (!isWorkspaceTrusted()) {return []}
    if (!document.fileName.endsWith('_spec.rb') && !document.fileName.endsWith('_test.rb')) {
      return []
    }

    const lenses: vscode.CodeLens[] = []
    const lines = document.getText().split('\n')

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const isTestBlock = /^\s*(?:describe|context|it|scenario|specify|test)\b/.test(line)

      if (isTestBlock) {
        const range = new vscode.Range(i, 0, i, line.length)
        const lineNum = i + 1

        lenses.push(
          new vscode.CodeLens(range, {
            title: '▶ Run Test',
            command: 'railsforge.runSingleTest',
            arguments: [document.uri, lineNum],
          }),
        )

        lenses.push(
          new vscode.CodeLens(range, {
            title: '🐞 Debug (rdbg)',
            command: 'railsforge.debugSingleTest',
            arguments: [document.uri, lineNum],
          }),
        )
      }
    }

    return lenses
  }
}
