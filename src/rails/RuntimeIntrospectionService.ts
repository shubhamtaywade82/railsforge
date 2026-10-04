/**
 * RuntimeIntrospectionService - runs the opt-in `rails runner` introspection for a project
 * and caches the snapshot at <root>/.railsforge/runtime.json (shared with the MCP server).
 * Gated by workspace trust AND explicit user consent, because it executes application code.
 */

import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { rubyCandidates } from '../util/RubyCommand'
import { readConfig } from '../config/RailsForgeConfig'
import { Logger } from '../util/Logger'
import { INTROSPECTION_SCRIPT, RuntimeSnapshot, formatSnapshotMarkdown, parseIntrospectionOutput } from './RuntimeIntrospector'

const execFileAsync = promisify(execFile)

export function runtimeCachePath(root: string): string {
  return path.join(root, '.railsforge', 'runtime.json')
}

export function readCachedSnapshot(root: string): RuntimeSnapshot | undefined {
  try {
    return JSON.parse(fs.readFileSync(runtimeCachePath(root), 'utf8')) as RuntimeSnapshot
  } catch {
    return undefined
  }
}

async function confirmExecution(): Promise<boolean> {
  if (readConfig().runtimeIntrospectionEnabled) {return true}
  const choice = await vscode.window.showWarningMessage(
    'RailsForge will boot your Rails application (`rails runner`) to read its real models, associations, validations, callbacks and routes. This runs your app\'s initializers and eager-loads your code. Continue?',
    { modal: true },
    'Run once',
    'Always allow',
  )
  if (choice === 'Always allow') {
    await vscode.workspace.getConfiguration('railsForge').update('runtime.introspection.enabled', true, vscode.ConfigurationTarget.Workspace)
  }
  return choice === 'Run once' || choice === 'Always allow'
}

export async function refreshRuntimeSnapshot(root: string): Promise<RuntimeSnapshot | undefined> {
  if (!vscode.workspace.isTrusted) {
    vscode.window.showWarningMessage('RailsForge: Runtime introspection runs application code and is disabled in untrusted workspaces.')
    return undefined
  }
  if (!fs.existsSync(path.join(root, 'config', 'application.rb'))) {
    vscode.window.showWarningMessage('RailsForge: Runtime introspection needs a Rails application.')
    return undefined
  }
  if (!(await confirmExecution())) {return undefined}

  const dir = path.join(root, '.railsforge')
  fs.mkdirSync(dir, { recursive: true })
  const script = path.join(dir, 'introspect.rb')
  fs.writeFileSync(script, INTROSPECTION_SCRIPT)

  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'RailsForge: booting Rails to introspect…' },
    async () => {
      let lastOutput = ''
      for (const c of rubyCandidates(root, 'rails', ['runner', script])) {
        try {
          const { stdout, stderr } = await execFileAsync(c.command, c.args, { cwd: root, maxBuffer: 50 * 1024 * 1024, timeout: 120_000 })
          lastOutput = `${stdout}${stderr}`
          const snapshot = parseIntrospectionOutput(stdout)
          if (snapshot) {
            snapshot.capturedAt = new Date().toISOString()
            fs.writeFileSync(runtimeCachePath(root), JSON.stringify(snapshot, null, 2))
            return snapshot
          }
          break
        } catch (err: unknown) {
          const e = err as { code?: string; stdout?: string; stderr?: string; message?: string }
          if (e.code === 'ENOENT') {continue}
          lastOutput = `${e.stdout ?? ''}${e.stderr ?? ''}` || (e.message ?? '')
          break
        }
      }
      Logger.warn(`[runtime] introspection failed:\n${lastOutput}`)
      const choice = await vscode.window.showErrorMessage('RailsForge: could not introspect the Rails app (it failed to boot?).', 'Show Log')
      if (choice === 'Show Log') {Logger.show(false)}
      return undefined
    },
  )
}

export async function showRuntimeSnapshot(root: string, refresh: boolean): Promise<void> {
  const snapshot = (!refresh ? readCachedSnapshot(root) : undefined) ?? await refreshRuntimeSnapshot(root)
  if (!snapshot) {return}
  const doc = await vscode.workspace.openTextDocument({ content: formatSnapshotMarkdown(snapshot), language: 'markdown' })
  await vscode.window.showTextDocument(doc)
}
