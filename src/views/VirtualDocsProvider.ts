/**
 * VirtualDocsProvider - serves `railsforge:/<kind>.md?root=<project>` documents (routes,
 * schema, runtime introspection, toolchain) without any file on disk. Read-only, always
 * rendered from the project named in the URI so multi-root stays correct.
 */

import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { SchemaIndexer } from '../rails/SchemaIndexer'
import { RoutesIndexer } from '../rails/RoutesIndexer'
import { EnvironmentDetector } from '../environment/EnvironmentDetector'
import { readCachedSnapshot } from '../rails/RuntimeIntrospectionService'
import { projectVersionManager } from '../util/RubyCommand'
import {
  VIRTUAL_DOC_KINDS, VIRTUAL_DOC_SCHEME, VirtualDocKind, parseVirtualDocKind, renderRoutesDoc,
  renderRuntimeDoc, renderSchemaDoc, renderToolchainDoc, virtualDocPath,
} from './VirtualDocs'

export function virtualDocUri(kind: VirtualDocKind, root: string): vscode.Uri {
  return vscode.Uri.from({ scheme: VIRTUAL_DOC_SCHEME, path: virtualDocPath(kind), query: new URLSearchParams({ root }).toString() })
}

export class VirtualDocsProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>()
  readonly onDidChange = this.emitter.event
  private readonly detector = new EnvironmentDetector()

  provideTextDocumentContent(uri: vscode.Uri): string {
    const kind = parseVirtualDocKind(uri.path)
    const root = new URLSearchParams(uri.query).get('root')
    if (!kind || !root) {return '# RailsForge\n\n_Unknown virtual document._\n'}

    switch (kind) {
      case 'routes': {
        const routes = new RoutesIndexer()
        const file = path.join(root, 'config', 'routes.rb')
        if (fs.existsSync(file)) {routes.parseRoutesDsl(fs.readFileSync(file, 'utf8'))}
        return renderRoutesDoc(routes.getAllRoutes())
      }
      case 'schema': {
        const schema = new SchemaIndexer()
        const file = path.join(root, 'db', 'schema.rb')
        if (fs.existsSync(file)) {schema.parseSchema(fs.readFileSync(file, 'utf8'))}
        return renderSchemaDoc(schema.getAllTables())
      }
      case 'runtime':
        return renderRuntimeDoc(readCachedSnapshot(root))
      case 'toolchain': {
        const env = this.detector.detectEnvironment(root)
        return renderToolchainDoc({
          root,
          rubyVersion: env.rubyVersion,
          railsVersion: env.railsVersion,
          versionManager: projectVersionManager(root),
          launcher: fs.existsSync(path.join(root, 'bin', 'rails')) ? 'bin/ stubs' : fs.existsSync(path.join(root, 'Gemfile')) ? 'bundle exec' : 'bare tools',
          testFramework: env.testFramework,
          projectType: env.projectType,
        })
      }
    }
  }

  /** Re-renders every open virtual document of `kind` (e.g. after schema.rb changed). */
  refresh(root: string, kinds: readonly VirtualDocKind[] = VIRTUAL_DOC_KINDS): void {
    for (const kind of kinds) {this.emitter.fire(virtualDocUri(kind, root))}
  }

  dispose(): void {
    this.emitter.dispose()
  }
}
