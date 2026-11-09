/**
 * Logger - Centralized, level-filtered logging to the 'RailsForge' Output Channel,
 * with an optional mirror to <workspace>/.railsforge/railsforge.log.
 *
 * The verbosity comes from the railsForge.log.level setting (applied via setLevel):
 * 'debug' adds AI request/response summaries and diff-parse results, 'trace' adds
 * raw HTTP request/response payloads sent to the AI provider.
 */

import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'

export type LogLevelName = 'error' | 'warn' | 'info' | 'debug' | 'trace'

const LOG_LEVEL_RANK: Record<LogLevelName, number> = {
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
}

export class Logger {
  private static channel?: vscode.LogOutputChannel | vscode.OutputChannel
  private static level: LogLevelName = 'info'
  private static logFile?: string
  private static fileQueue: Promise<void> = Promise.resolve()

  static init(context: vscode.ExtensionContext): void {
    try {
      Logger.channel = vscode.window.createOutputChannel('RailsForge', { log: true })
    } catch {
      // Older VS Code/Cursor versions do not support the { log: true } option.
      Logger.channel = vscode.window.createOutputChannel('RailsForge')
    }
    context.subscriptions.push(Logger.channel)
  }

  static setLevel(level: LogLevelName): void {
    Logger.level = level
  }

  /** Mirrors every log line to `filePath`. Best-effort: a failing sink is disabled, never throws. */
  static setLogFile(filePath?: string): void {
    Logger.logFile = filePath
  }

  static error(message: string, ...args: unknown[]): void { Logger.write('error', message, args) }
  static warn(message: string, ...args: unknown[]): void { Logger.write('warn', message, args) }
  static info(message: string, ...args: unknown[]): void { Logger.write('info', message, args) }
  static debug(message: string, ...args: unknown[]): void { Logger.write('debug', message, args) }
  static trace(message: string, ...args: unknown[]): void { Logger.write('trace', message, args) }

  static show(preserveFocus = true): void {
    Logger.channel?.show(preserveFocus)
  }

  private static write(level: LogLevelName, message: string, args: unknown[]): void {
    if (LOG_LEVEL_RANK[level] > LOG_LEVEL_RANK[Logger.level]) { return }
    if (!Logger.channel) { return }

    const label = level.toUpperCase()
    const extra = formatArgs(args)
    if ('info' in Logger.channel) {
      Logger.channel[level](message, ...args)
    } else {
      Logger.channel.appendLine(`[${new Date().toISOString()}] [${label}] ${message}${extra}`)
    }

    Logger.appendToFile(`[${new Date().toISOString()}] [${label}] ${message}${extra}`)
  }

  private static appendToFile(line: string): void {
    const file = Logger.logFile
    if (!file) { return }
    Logger.fileQueue = Logger.fileQueue
      .then(() => new Promise<void>(resolve => {
        fs.mkdir(path.dirname(file), { recursive: true }, mkErr => {
          if (mkErr) { Logger.logFile = undefined; return resolve() }
          fs.appendFile(file, `${line}\n`, appendErr => {
            if (appendErr) { Logger.logFile = undefined }
            resolve()
          })
        })
      }))
      .catch(() => {})
  }
}

function formatArgs(args: unknown[]): string {
  if (args.length === 0) { return '' }
  return ` ${args.map(a => {
    if (a instanceof Error) {
      return a.stack ?? a.message
    }
    try {
      return typeof a === 'object' ? JSON.stringify(a) : String(a)
    } catch {
      return String(a)
    }
  }).join(' ')}`
}