/**
 * NPlusOneAnalyzer - schema-aware static detection of likely N+1 queries.
 *
 * Heuristic (line-based, no AST): a block iterating a collection (`.each`, `.map`, ...)
 * whose block variable is then used to call an association-looking method that the
 * schema supports (a `<name>_id` foreign key on some table, or a table name), where the
 * iterated collection expression has no includes/preload/eager_load/joins eager-loading.
 * Results are *candidates* — callers must present them as such, never as proof.
 */

export interface SchemaLike {
  name: string
  columns: Iterable<string>
}

export interface NPlusOneFinding {
  /** 1-based line of the iteration. */
  line: number
  collection: string
  variable: string
  association: string
  /** 1-based line where the association is dereferenced. */
  accessLine: number
}

const LOOP_RE = /^(\s*)(.+?)\.(?:each|map|flat_map|collect|select|reject|sum|find_each|each_with_index)\b(?:\([^)]*\))?\s*(?:do\s*\|\s*\(?([a-z_]\w*)[^|]*\|\s*$|\{\s*\|\s*\(?([a-z_]\w*)[^|]*\|)/
const EAGER_RE = /\.(?:includes|preload|eager_load)\s*\(/
const SINGULAR_ES = /(?:ss|x|z|ch|sh|us)$/

function singularize(word: string): string {
  if (word.endsWith('ies')) {return `${word.slice(0, -3)}y`}
  if (SINGULAR_ES.test(word)) {return word}
  if (word.endsWith('s')) {return word.slice(0, -1)}
  return word
}

/** Names that, when called on a record, plausibly traverse an association. */
export function candidateAssociations(tables: readonly SchemaLike[]): Set<string> {
  const names = new Set<string>()
  for (const table of tables) {
    names.add(table.name)
    names.add(singularize(table.name))
    for (const col of table.columns) {
      if (col.endsWith('_id') && col.length > 3) {names.add(col.slice(0, -3))}
    }
  }
  return names
}

export function analyzeNPlusOne(code: string, tables: readonly SchemaLike[]): NPlusOneFinding[] {
  const assocs = candidateAssociations(tables)
  if (assocs.size === 0) {return []}

  const lines = code.split('\n')
  const findings: NPlusOneFinding[] = []

  for (let i = 0; i < lines.length; i++) {
    const m = LOOP_RE.exec(lines[i])
    if (!m) {continue}
    const collection = m[2].trim()
    const variable = m[3] ?? m[4]
    if (!variable || EAGER_RE.test(collection) || EAGER_RE.test(lines[i])) {continue}

    const indent = m[1].length
    const isBrace = m[4] !== undefined
    const accessRe = new RegExp(`\\b${variable}\\.([a-z_]\\w*)\\b(?!\\s*=[^=])`, 'g')
    const seen = new Set<string>()

    // Scan the block body: for do-blocks until a line with same-or-lower indent `end`.
    for (let j = isBrace ? i : i + 1; j < lines.length; j++) {
      const line = lines[j]
      if (!isBrace && /^\s*end\b/.test(line) && line.search(/\S/) <= indent) {break}
      const text = isBrace && j === i ? line.slice(line.indexOf('|', line.indexOf('{')) + 1) : line
      let a: RegExpExecArray | null
      accessRe.lastIndex = 0
      while ((a = accessRe.exec(text)) !== null) {
        const name = a[1]
        if (assocs.has(name) && !seen.has(name)) {
          seen.add(name)
          findings.push({ line: i + 1, collection, variable, association: name, accessLine: j + 1 })
        }
      }
      if (isBrace && /\}\s*$/.test(line)) {break}
    }
  }
  return findings
}
