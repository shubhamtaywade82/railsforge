/**
 * Gathers the facts for the diagnostics report from the live extension host.
 * Native modules are only *loaded* when the runtime gate says it is safe — loading
 * better-sqlite3 on an unsupported N-API aborts the whole process (see nativeSupport.ts).
 */

import * as vscode from 'vscode'
import * as path from 'path'
import { getPersistentIndexSupport, hasPrebuild } from '../indexer/nativeSupport'
import { DiagnosticsInfo, NativeModuleReport } from './Diagnostics'

const NATIVE_MODULES = ['better-sqlite3', 'tree-sitter', 'tree-sitter-ruby'] as const

function probeModule(mod: typeof NATIVE_MODULES[number], gateOpen: boolean): Pick<NativeModuleReport, 'loaded' | 'error'> {
  if (mod === 'better-sqlite3' && !gateOpen) {return { loaded: 'skipped' }}
  try {
     
    if (mod === 'better-sqlite3') {
      const Database = require('better-sqlite3')
      const db = new Database(':memory:')
      db.exec('CREATE TABLE t (v TEXT)')
      db.close()
    } else if (mod === 'tree-sitter') {
      require('tree-sitter')
    } else {
      const Parser = require('tree-sitter')
      const parser = new Parser()
      parser.setLanguage(require('tree-sitter-ruby'))
      parser.parse('class A; end')
    }
    return { loaded: true }
  } catch (err) {
    return { loaded: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export interface DiagnosticsInputs {
  context: vscode.ExtensionContext
  activeRoot?: string
  astRoots: Record<string, string>
  project: DiagnosticsInfo['project']
  skills?: DiagnosticsInfo['skills']
  ai: DiagnosticsInfo['ai']
}

export function collectDiagnostics(inputs: DiagnosticsInputs): DiagnosticsInfo {
  const { context } = inputs
  const platformKey = `${process.platform}-${process.arch}`
  const support = getPersistentIndexSupport()
  const nativeModules: NativeModuleReport[] = NATIVE_MODULES.map(name => ({
    name,
    platformKey,
    prebuildPresent: hasPrebuild(path.join(context.extensionPath, 'dist', 'node_modules'), name),
    ...probeModule(name, support.supported),
  }))
  return {
    extension: { id: context.extension.id, version: String((context.extension.packageJSON as { version?: string }).version ?? 'unknown') },
    host: { vscodeVersion: vscode.version, appName: vscode.env.appName, remoteName: vscode.env.remoteName, trusted: vscode.workspace.isTrusted },
    runtime: { platform: process.platform, arch: process.arch, node: process.versions.node, electron: process.versions.electron, napi: process.versions.napi ?? 'unknown' },
    astIndex: { supported: support.supported, reason: support.reason, roots: inputs.astRoots },
    nativeModules,
    project: inputs.project,
    tools: {
      rubyLsp: Boolean(vscode.extensions.getExtension('Shopify.ruby-lsp')),
      rdbg: Boolean(vscode.extensions.getExtension('KoichiSasada.vscode-rdbg')),
    },
    skills: inputs.skills,
    ai: inputs.ai,
  }
}
