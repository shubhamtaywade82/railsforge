#!/usr/bin/env node
/**
 * fetch-skills - assembles dist/skills from a PINNED ruby-agent-skills commit.
 *
 *   node scripts/fetch-skills.mjs                 # fetch pinned ref (cached), build dist/skills
 *   RAILSFORGE_SKILLS_DIR=/path/to/checkout node scripts/fetch-skills.mjs   # use a local checkout (no network)
 *   node scripts/fetch-skills.mjs --update-pin    # recompute treeSha256 in skills-pin.json
 *   node scripts/fetch-skills.mjs --fixtures      # also (re)write test/fixtures/skills from the same source
 *
 * Integrity: the content hash of every shipped file must equal skills-pin.json's treeSha256
 * (unless --update-pin). Offline/dev builds that cannot fetch keep an existing dist/skills,
 * otherwise continue without skills; set RAILSFORGE_REQUIRE_SKILLS=1 (CI/release) to fail instead.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pinPath = path.join(root, 'skills-pin.json')
const outDir = path.join(root, 'dist', 'skills')
const args = new Set(process.argv.slice(2))
const pin = JSON.parse(fs.readFileSync(pinPath, 'utf8'))
const required = process.env.RAILSFORGE_REQUIRE_SKILLS === '1'

const sha256 = buf => createHash('sha256').update(buf).digest('hex')

function fail(message) {
  console.error(`fetch-skills: ${message}`)
  process.exit(required ? 1 : 0)
}

function resolveSource() {
  const local = process.env.RAILSFORGE_SKILLS_DIR
  if (local) {return { dir: path.resolve(local), ref: 'local' }}
  const cache = path.join(root, 'node_modules', '.cache', 'railsforge-skills', pin.ref)
  if (fs.existsSync(path.join(cache, 'skill-manifest.yml'))) {return { dir: cache, ref: pin.ref }}
  fs.mkdirSync(cache, { recursive: true })
  const git = (...a) => execFileSync('git', a, { cwd: cache, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_LFS_SKIP_SMUDGE: '1' } })
  git('init', '-q')
  git('remote', 'add', 'origin', `https://github.com/${pin.repo}`)
  git('fetch', '-q', '--depth', '1', 'origin', pin.ref)
  git('checkout', '-q', 'FETCH_HEAD')
  return { dir: cache, ref: pin.ref }
}

function frontMatter(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text)
  if (!m) {return {}}
  try { return yaml.load(m[1]) ?? {} } catch { return {} }
}

/** `| Task | Primary | Secondary |` table rows from router/ROUTING.md. */
function parseRoutingMatrix(markdown) {
  const rows = []
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) {continue}
    const cells = line.split('|').slice(1, -1).map(c => c.trim())
    if (cells.length !== 3 || /^-+$/.test(cells[0].replace(/\s/g, '')) || cells[0] === 'Task') {continue}
    rows.push({
      task: cells[0],
      primary: cells[1].split(',').map(s => s.trim()).filter(Boolean),
      secondary: cells[2].split(',').map(s => s.trim()).filter(Boolean),
    })
  }
  return rows
}

function build(src) {
  const manifest = yaml.load(fs.readFileSync(path.join(src, 'skill-manifest.yml'), 'utf8'))
  const keep = new Set(pin.keepSkills ?? [])
  const excludeFamilies = new Set(pin.excludeFamilies ?? [])
  const files = new Map() // relative output path -> Buffer
  const skills = {}

  for (const [id, def] of Object.entries(manifest.skills ?? {})) {
    if (excludeFamilies.has(def.family) && !keep.has(id)) {continue}
    const skillFile = path.join(src, def.path)
    if (!fs.existsSync(skillFile)) {continue}
    const text = fs.readFileSync(skillFile, 'utf8')
    const fm = frontMatter(text)
    const rel = `skills/${id}/SKILL.md`
    files.set(rel, Buffer.from(text))
    const references = []
    const refDir = path.join(path.dirname(skillFile), 'references')
    if (fs.existsSync(refDir)) {
      for (const f of fs.readdirSync(refDir).filter(n => n.endsWith('.md')).sort()) {
        const refText = fs.readFileSync(path.join(refDir, f), 'utf8')
        files.set(`skills/${id}/references/${f}`, Buffer.from(refText))
        const when = /Load it on demand when ([^\n]+)/.exec(refText)?.[1] ?? ''
        references.push({ file: f, title: /^#\s+(.+)$/m.exec(refText)?.[1] ?? f, when })
      }
    }
    skills[id] = {
      family: def.family,
      description: String(fm.description ?? '').trim(),
      triggers: (def.triggers ?? []).map(String),
      references,
    }
  }

  const patterns = {}
  for (const family of pin.patternFamilies ?? []) {
    for (const p of manifest.patterns?.[family]?.paths ?? []) {
      const file = path.join(src, p)
      if (!fs.existsSync(file)) {continue}
      const text = fs.readFileSync(file, 'utf8')
      const fm = frontMatter(text)
      const id = path.basename(p, '.md')
      files.set(`patterns/${family}/${id}.md`, Buffer.from(text))
      ;(patterns[family] ??= []).push({ id, description: String(fm.description ?? '').trim() })
    }
  }

  const routingText = fs.readFileSync(path.join(src, 'router', 'ROUTING.md'), 'utf8')
  files.set('router/ROUTING.md', Buffer.from(routingText))
  files.set('LICENSE', fs.readFileSync(path.join(src, 'LICENSE')))

  const catalog = {
    schema: 1,
    source: { repo: pin.repo, ref: pin.ref },
    defaults: { alwaysConsider: manifest.defaults?.always_consider ?? [] },
    retired: manifest.retired_skills ?? {},
    skills,
    patterns,
    routes: parseRoutingMatrix(routingText),
  }
  return { files, catalog, manifest }
}

function treeHash(files) {
  const h = createHash('sha256')
  for (const key of [...files.keys()].sort()) {h.update(`${key}\0${sha256(files.get(key))}\n`)}
  return h.digest('hex')
}

function writeAll(dir, files, catalog) {
  fs.rmSync(dir, { recursive: true, force: true })
  for (const [rel, buf] of files) {
    const full = path.join(dir, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, buf)
  }
  fs.writeFileSync(path.join(dir, 'catalog.json'), `${JSON.stringify(catalog)}\n`)
}

function writeFixtures(src, files, catalog) {
  const dir = path.join(root, 'test', 'fixtures', 'skills')
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'catalog.json'), `${JSON.stringify(catalog, null, 1)}\n`)
  const cases = yaml.load(fs.readFileSync(path.join(src, 'router', 'ROUTING_CASES.yml'), 'utf8')).cases
  fs.writeFileSync(path.join(dir, 'routing-cases.json'), `${JSON.stringify(cases, null, 1)}\n`)
  for (const id of ['rails-active-record', 'rails-action-controller', 'ruby-clean-code']) {
    for (const [rel, buf] of files) {
      if (rel.startsWith(`skills/${id}/`)) {
        const full = path.join(dir, rel)
        fs.mkdirSync(path.dirname(full), { recursive: true })
        fs.writeFileSync(full, buf)
      }
    }
  }
  for (const rel of ['patterns/ruby-design/service-object.md']) {
    if (files.has(rel)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
      fs.writeFileSync(path.join(dir, rel), files.get(rel))
    }
  }
}

const pinFile = path.join(outDir, '.pin.json')
if (!args.has('--update-pin') && !args.has('--fixtures') && !process.env.RAILSFORGE_SKILLS_DIR && fs.existsSync(pinFile)) {
  const current = JSON.parse(fs.readFileSync(pinFile, 'utf8'))
  if (current.ref === pin.ref && current.treeSha256 === pin.treeSha256 && pin.treeSha256) {
    console.log(`fetch-skills: dist/skills already at ${pin.ref.slice(0, 8)}`)
    process.exit(0)
  }
}

let source
try {
  source = resolveSource()
} catch (err) {
  if (fs.existsSync(path.join(outDir, 'catalog.json'))) {
    console.warn(`fetch-skills: could not fetch (${err.message.split('\n')[0]}); keeping existing dist/skills`)
    process.exit(0)
  }
  fail(`could not fetch ${pin.repo}@${pin.ref.slice(0, 8)}: ${err.message.split('\n')[0]}. Skills will be unavailable in this build.`)
  process.exit(0)
}

const { files, catalog } = build(source.dir)
const hash = treeHash(files)
if (args.has('--update-pin')) {
  pin.treeSha256 = hash
  fs.writeFileSync(pinPath, `${JSON.stringify(pin, null, 2)}\n`)
  console.log(`fetch-skills: pinned treeSha256 ${hash}`)
} else if (source.ref !== 'local' && pin.treeSha256 && hash !== pin.treeSha256) {
  fail(`content hash mismatch for ${pin.repo}@${pin.ref.slice(0, 8)}: expected ${pin.treeSha256}, got ${hash}`)
  process.exit(0)
}

writeAll(outDir, files, catalog)
fs.writeFileSync(pinFile, `${JSON.stringify({ ref: pin.ref, treeSha256: hash, source: source.ref }, null, 2)}\n`)
if (args.has('--fixtures')) {writeFixtures(source.dir, files, catalog)}
const bytes = [...files.values()].reduce((n, b) => n + b.length, 0)
console.log(`fetch-skills: ${Object.keys(catalog.skills).length} skills, ${Object.values(catalog.patterns).flat().length} patterns, ${(bytes / 1024 / 1024).toFixed(1)} MB -> dist/skills (${source.ref === 'local' ? 'local checkout' : pin.ref.slice(0, 8)})`)
