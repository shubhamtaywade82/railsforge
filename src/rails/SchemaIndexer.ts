/**
 * SchemaIndexer - In-memory index of Rails database schema (db/schema.rb)
 */

export interface SchemaColumn {
  name: string
  type: string
  nullable: boolean
  default?: string
  array?: boolean
}

export interface SchemaTable {
  name: string
  columns: Map<string, SchemaColumn>
  indexes: string[]
  foreignKeys: Array<{ toTable: string; column: string }>
}

export class SchemaIndexer {
  private tables: Map<string, SchemaTable> = new Map()

  parseSchema(content: string): void {
    this.tables.clear()
    const lines = content.split('\n')
    let currentTable: SchemaTable | null = null
    const foreignKeys: Array<{ from: string; toTable: string; column?: string }> = []

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('create_table')) {
        currentTable = this.startTable(trimmed)
      } else if (trimmed.startsWith('t.index') && currentTable) {
        const description = this.describeIndex(trimmed)
        if (description) {currentTable.indexes.push(description)}
      } else if (trimmed.startsWith('t.') && currentTable) {
        this.parseColumnLine(trimmed, currentTable)
      } else if (trimmed === 'end' && currentTable) {
        this.tables.set(currentTable.name, currentTable)
        currentTable = null
      } else if (trimmed.startsWith('add_foreign_key')) {
        const fk = /add_foreign_key\s+["']([^"']+)["']\s*,\s*["']([^"']+)["'](?:.*?column:\s*["']([^"']+)["'])?/.exec(trimmed)
        if (fk) {foreignKeys.push({ from: fk[1], toTable: fk[2], column: fk[3] })}
      }
    }

    // add_foreign_key lines come after every create_table in schema.rb.
    for (const fk of foreignKeys) {
      const table = this.tables.get(fk.from)
      if (!table) {continue}
      const column = fk.column ?? `${fk.toTable.replace(/ies$/, 'y').replace(/s$/, '')}_id`
      table.foreignKeys.push({ toTable: fk.toTable, column })
    }
  }

  /** `t.index ["user_id", "created_at"], name: "idx", unique: true` -> `user_id, created_at (unique)`. */
  private describeIndex(line: string): string | undefined {
    const columns = /t\.index\s+(?:\[([^\]]*)\]|["']([^"']+)["'])/.exec(line)
    if (!columns) {return undefined}
    const names = (columns[1] ?? columns[2]).split(',').map(c => c.replace(/["'\s]/g, '')).filter(Boolean)
    if (names.length === 0) {return undefined}
    return `${names.join(', ')}${/unique:\s*true/.test(line) ? ' (unique)' : ''}`
  }

  private startTable(line: string): SchemaTable | null {
    const match = /create_table\s+["']([^"']+)["']/.exec(line)
    if (!match) {return null}
    return {
      name: match[1],
      columns: new Map(),
      indexes: [],
      foreignKeys: [],
    }
  }

  private parseColumnLine(line: string, table: SchemaTable): void {
    const match = /t\.(\w+)\s+["']([^"']+)["'](?:,\s*(.*))?/.exec(line)
    if (!match) {return}

    const [, type, name, options] = match
    const nullable = !(options && /null:\s*false/.test(options))
    const defaultMatch = options ? /default:\s*([^,\n]+)/.exec(options) : null

    table.columns.set(name, {
      name,
      type,
      nullable,
      default: defaultMatch ? defaultMatch[1].trim() : undefined,
    })
  }

  getTable(tableName: string): SchemaTable | undefined {
    return this.tables.get(tableName)
  }

  getModelColumns(modelName: string): SchemaColumn[] {
    const tableName = this.pluralize(this.underscore(modelName))
    const table = this.tables.get(tableName)
    return table ? Array.from(table.columns.values()) : []
  }

  getAllTables(): SchemaTable[] {
    return Array.from(this.tables.values())
  }

  private underscore(str: string): string {
    return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '')
  }

  private pluralize(str: string): string {
    if (str.endsWith('y') && !/[aeiou]y$/.test(str)) {
      return str.slice(0, -1) + 'ies'
    }
    return str.endsWith('s') ? str : `${str}s`
  }
}
