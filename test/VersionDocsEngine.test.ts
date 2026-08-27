import { describe, it, expect } from 'vitest'
import { VersionDocsEngine } from '../src/docs/VersionDocsEngine'
import { TextDocument, Position, Range, MarkdownString, Hover } from 'vscode'

describe('VersionDocsEngine', () => {
  const engine = new VersionDocsEngine()

  it('retrieves accurate documentation and guides for Rails DSL keywords', () => {
    const hasManyDoc = engine.getDoc('has_many')
    expect(hasManyDoc).toBeDefined()
    expect(hasManyDoc?.title).toContain('has_many')
    expect(hasManyDoc?.guideUrl).toContain('association_basics.html')

    const turboDoc = engine.getDoc('turbo_stream')
    expect(turboDoc).toBeDefined()
    expect(turboDoc?.railsVersionMin).toBe(7)

    const delegateDoc = engine.getDoc('delegate')
    expect(delegateDoc).toBeDefined()
    expect(delegateDoc?.summary).toContain('Law of Demeter')
  })

  it('returns undefined for unknown topics', () => {
    expect(engine.getDoc('unknown_keyword')).toBeUndefined()
  })

  it('trims and lowercases the topic in getDoc', () => {
    const doc = engine.getDoc('  HAS_MANY  ')
    expect(doc).toBeDefined()
    expect(doc!.keyword).toBe('has_many')
  })
})

describe('VersionDocsEngine provideHover', () => {
  const engine = new VersionDocsEngine()

  function makeDocWithWord(word: string, positionChar: number) {
    const text = `${word} extra text`
    const doc = new TextDocument('test.rb', 'ruby', text)
    doc.getWordRangeAtPosition = (_position: Position) => {
      const start = text.indexOf(word)
      if (start === -1) return null
      return new Range(0, start, 0, start + word.length)
    }
    return doc
  }

  it('returns a Hover with markdown for a known keyword', () => {
    const doc = makeDocWithWord('has_many', 4)
    const result = engine.provideHover(doc, new Position(0, 4))

    expect(result).not.toBeNull()
    expect(result).toBeInstanceOf(Hover)
    expect(result!.contents).toBeInstanceOf(MarkdownString)
    const md = result!.contents as unknown as MarkdownString
    expect(md.isTrusted).toBe(true)
    expect(result!.range).not.toBeUndefined()
  })

  it('returns null when word is not a known keyword', () => {
    const doc = makeDocWithWord('unknown_method', 5)
    const result = engine.provideHover(doc, new Position(0, 5))
    expect(result).toBeNull()
  })

  it('returns null when getWordRangeAtPosition returns null', () => {
    const doc = new TextDocument('test.rb', 'ruby', 'some text')
    const result = engine.provideHover(doc, new Position(0, 0))
    expect(result).toBeNull()
  })

  it('includes example code block when entry has an example', () => {
    const doc = makeDocWithWord('before_action', 5)
    const result = engine.provideHover(doc, new Position(0, 5))
    expect(result).not.toBeNull()
    const md = result!.contents as unknown as MarkdownString
    const value = (md as any).value as string
    expect(value).toContain('```ruby')
    expect(value).toContain('before_action :set_user, only: [:show, :edit, :update]')
  })

  it('includes guide URL and style guide link in markdown', () => {
    const doc = makeDocWithWord('delegate', 4)
    const result = engine.provideHover(doc, new Position(0, 4))
    expect(result).not.toBeNull()
    const md = result!.contents as unknown as MarkdownString
    const value = (md as any).value as string
    expect(value).toContain('rubystyle.guide')
    expect(value).toContain('Official Guide')
  })

  it('includes turbo_stream docs without railsversionmin check in hover', () => {
    const doc = makeDocWithWord('turbo_stream', 5)
    const result = engine.provideHover(doc, new Position(0, 5))
    expect(result).not.toBeNull()
    const md = result!.contents as unknown as MarkdownString
    const value = (md as any).value as string
    expect(value).toContain('Hotwire Turbo Stream Action')
  })
})
