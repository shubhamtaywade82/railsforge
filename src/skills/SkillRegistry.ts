/**
 * SkillRegistry - read access to the bundled ruby-agent-skills pack plus optional workspace
 * skills (`.agents/skills/<id>/SKILL.md` and configured extra directories). Workspace skills
 * override pack skills of the same id, so a team can adapt a skill without forking the pack.
 */

import * as fs from 'fs'
import * as path from 'path'
import { SkillCatalog, SkillEntry, parseCatalog } from './SkillCatalog'

export interface RegistryOptions {
  /** `<extension>/dist/skills`; undefined when the pack was not built into this install. */
  packDir?: string
  /** Project root whose `.agents/skills` is also read. */
  workspaceRoot?: string
  extraDirs?: readonly string[]
}

function frontMatter(text: string): { name?: string; description?: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) {return {}}
  const get = (key: string): string | undefined => {
    const line = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(m[1])
    if (!line) {return undefined}
    const value = line[1].trim()
    if (value === '>' || value === '|' || value === '') {
      // folded block: collect indented lines
      const after = m[1].slice(m[1].indexOf(line[0]) + line[0].length).split('\n').slice(1)
      const block: string[] = []
      for (const l of after) {
        if (/^\s+\S/.test(l)) {block.push(l.trim())} else {break}
      }
      return block.join(' ')
    }
    return value.replace(/^["']|["']$/g, '')
  }
  return { name: get('name'), description: get('description') }
}

export class SkillRegistry {
  readonly catalog: SkillCatalog | undefined
  private readonly packDir: string | undefined
  private readonly workspaceSkills = new Map<string, SkillEntry & { file: string }>()

  constructor(options: RegistryOptions) {
    this.packDir = options.packDir
    this.catalog = this.loadCatalog()
    const dirs = [
      ...(options.workspaceRoot ? [path.join(options.workspaceRoot, '.agents', 'skills')] : []),
      ...(options.extraDirs ?? []),
    ]
    for (const dir of dirs) {this.loadWorkspaceDir(dir)}
  }

  private loadCatalog(): SkillCatalog | undefined {
    if (!this.packDir) {return undefined}
    try {
      return parseCatalog(JSON.parse(fs.readFileSync(path.join(this.packDir, 'catalog.json'), 'utf8')))
    } catch {
      return undefined
    }
  }

  private loadWorkspaceDir(dir: string): void {
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (!entry.isDirectory()) {continue}
      const file = path.join(dir, entry.name, 'SKILL.md')
      try {
        const text = fs.readFileSync(file, 'utf8')
        const fm = frontMatter(text)
        const id = fm.name ?? entry.name
        this.workspaceSkills.set(id, {
          id, origin: 'workspace', family: 'workspace', description: fm.description ?? '', triggers: [], references: [], file,
        })
      } catch { /* not a skill directory */ }
    }
  }

  get available(): boolean {
    return this.catalog !== undefined || this.workspaceSkills.size > 0
  }

  get source(): { repo: string; ref: string } | undefined {
    return this.catalog?.source
  }

  /** Resolves a retired id (e.g. `rails-activerecord`) to its current name. */
  resolveId(id: string): string {
    return this.catalog?.retired[id] ?? id
  }

  get(id: string): SkillEntry | undefined {
    const resolved = this.resolveId(id)
    const workspace = this.workspaceSkills.get(resolved)
    if (workspace) {return workspace}
    const packSkill = this.catalog?.skills[resolved]
    return packSkill ? { id: resolved, origin: 'pack', ...packSkill } : undefined
  }

  list(): SkillEntry[] {
    const byId = new Map<string, SkillEntry>()
    for (const [id, s] of Object.entries(this.catalog?.skills ?? {})) {byId.set(id, { id, origin: 'pack', ...s })}
    for (const [id, s] of this.workspaceSkills) {byId.set(id, s)}
    return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
  }

  /** Full SKILL.md text, or undefined. */
  readSkill(id: string): string | undefined {
    const resolved = this.resolveId(id)
    if (!/^[\w-]+$/.test(resolved)) {return undefined}
    const workspace = this.workspaceSkills.get(resolved)
    return this.readFile(workspace ? workspace.file : this.packPath('skills', resolved, 'SKILL.md'))
  }

  readReference(id: string, file: string): string | undefined {
    const resolved = this.resolveId(id)
    if (!/^[\w-]+$/.test(resolved) || !/^[\w.-]+\.md$/.test(file) || file.includes('..')) {return undefined}
    return this.readFile(this.packPath('skills', resolved, 'references', file))
  }

  listPatterns(): Array<{ family: string; id: string; description: string }> {
    return Object.entries(this.catalog?.patterns ?? {}).flatMap(([family, items]) => items.map(p => ({ family, ...p })))
  }

  readPattern(id: string): string | undefined {
    if (!/^[\w-]+$/.test(id)) {return undefined}
    for (const family of Object.keys(this.catalog?.patterns ?? {})) {
      const text = this.readFile(this.packPath('patterns', family, `${id}.md`))
      if (text) {return text}
    }
    return undefined
  }

  private packPath(...segments: string[]): string | undefined {
    return this.packDir ? path.join(this.packDir, ...segments) : undefined
  }

  private readFile(file: string | undefined): string | undefined {
    if (!file) {return undefined}
    try { return fs.readFileSync(file, 'utf8') } catch { return undefined }
  }
}
