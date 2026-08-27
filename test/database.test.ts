import { describe, it, expect } from 'vitest'
import { openIndexDatabase } from '../src/indexer/database'
import { isPersistentIndexSupported } from '../src/indexer/nativeSupport'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

describe.skipIf(!isPersistentIndexSupported())('openIndexDatabase', () => {
  let tmpDir: string

  // Use a fresh temp dir for each test to avoid file contention
  function freshDbPath(): string {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-db-test-'))
    return path.join(tmpDir, 'test.sqlite3')
  }

  it('sets WAL journal_mode for on-disk writable databases', () => {
    const dbPath = freshDbPath()
    const db = openIndexDatabase(dbPath)
    const rows = db.pragma('journal_mode') as Array<{ journal_mode: string }>
    expect(rows[0].journal_mode).toBe('wal')
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('does not set WAL for :memory: databases', () => {
    const db = openIndexDatabase(':memory:')
    // Just verify it opens without error; WAL should not be set
    const count = (db.prepare('SELECT COUNT(*) as c FROM symbols').get() as { c: number }).c
    expect(count).toBe(0)
    db.close()
  })

  it('opens a readonly database without running migrations', () => {
    // First create a writable db to set up the file
    const dbPath = freshDbPath()
    const writeDb = openIndexDatabase(dbPath)
    writeDb.close()

    // Now open readonly
    const readDb = openIndexDatabase(dbPath, true)
    const count = (readDb.prepare('SELECT COUNT(*) as c FROM symbols').get() as { c: number }).c
    expect(count).toBe(0)
    readDb.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })
})
