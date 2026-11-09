import * as fs from 'fs'
import * as path from 'path'
import { describe, it, expect } from 'vitest'

// Command IDs are case-sensitive. A contributed command whose ID differs from the one registered in
// src is a dead palette entry in VS Code, and only the Extension Host test would otherwise notice.
// This compares the exact strings, so it catches a casing mismatch on any machine, not only in CI.

const root = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  contributes: {
    commands: Array<{ command: string }>
    menus?: Record<string, Array<{ command?: string }>>
  }
}

function sourceText(dir: string): string {
  return fs.readdirSync(dir).map(name => {
    const full = path.join(dir, name)
    if (fs.statSync(full).isDirectory()) {return sourceText(full)}
    return name.endsWith('.ts') ? fs.readFileSync(full, 'utf8') : ''
  }).join('\n')
}

const source = sourceText(path.join(root, 'src'))
const contributed = pkg.contributes.commands.map(c => c.command)

describe('contributed command IDs', () => {
  it('match a registered command in src exactly, including case', () => {
    const unregistered = contributed.filter(id => !source.includes(`'${id}'`) && !source.includes(`"${id}"`))
    expect(unregistered).toEqual([])
  })

  it('are not duplicated', () => {
    expect(new Set(contributed).size).toBe(contributed.length)
  })

  it('are the only commands that menus reference', () => {
    const known = new Set(contributed)
    const referenced = Object.values(pkg.contributes.menus ?? {})
      .flat()
      .map(entry => entry.command)
      .filter((id): id is string => typeof id === 'string')
    expect(referenced.filter(id => !known.has(id))).toEqual([])
  })
})
