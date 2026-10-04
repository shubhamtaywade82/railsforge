#!/usr/bin/env node
/**
 * native-smoke - proves the bundled native modules load and work on THIS OS/arch/Node,
 * exactly as the extension loads them (from dist/node_modules). Run after `pnpm run compile`.
 * Exits non-zero with a clear message instead of letting the extension discover it at runtime.
 */
const path = require('node:path')
const dist = path.resolve(__dirname, '..', 'dist', 'node_modules')
const fail = (what, err) => {
  console.error(`native-smoke: ${what} failed on ${process.platform}-${process.arch} (node ${process.version}, napi ${process.versions.napi}): ${err && err.message ? err.message : err}`)
  process.exit(1)
}

try {
  const Database = require(path.join(dist, 'better-sqlite3'))
  const db = new Database(':memory:')
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)')
  db.prepare('INSERT INTO t (v) VALUES (?)').run('ok')
  const row = db.prepare('SELECT v FROM t').get()
  if (!row || row.v !== 'ok') {throw new Error('unexpected query result')}
  db.close()
  console.log('native-smoke: better-sqlite3 ok')
} catch (err) {
  fail('better-sqlite3', err)
}

try {
  const Parser = require(path.join(dist, 'tree-sitter'))
  const Ruby = require(path.join(dist, 'tree-sitter-ruby'))
  const parser = new Parser()
  parser.setLanguage(Ruby)
  const tree = parser.parse('class Order < ApplicationRecord\n  def total; 1; end\nend\n')
  const root = tree.rootNode
  if (root.hasError || !root.toString().includes('class')) {throw new Error('unexpected parse tree')}
  console.log('native-smoke: tree-sitter-ruby ok')
} catch (err) {
  fail('tree-sitter / tree-sitter-ruby', err)
}
