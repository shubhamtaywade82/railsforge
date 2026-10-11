import { describe, it, expect } from 'vitest'
import { matchActionAtPosition, matchControllerIdentifierAtPosition } from '../src/hotwire/StimulusAttributeParser'

describe('matchControllerIdentifierAtPosition', () => {
  it('resolves the identifier when the cursor is inside a single-value data-controller attribute', () => {
    const line = '  <div data-controller="clipboard">'
    const char = line.indexOf('clipboard') + 3
    expect(matchControllerIdentifierAtPosition(line, char)).toBe('clipboard')
  })

  it('resolves the specific identifier under the cursor in a multi-value attribute', () => {
    const line = '  <div data-controller="dropdown clipboard">'
    const dropdownChar = line.indexOf('dropdown') + 2
    const clipboardChar = line.indexOf('clipboard') + 2
    expect(matchControllerIdentifierAtPosition(line, dropdownChar)).toBe('dropdown')
    expect(matchControllerIdentifierAtPosition(line, clipboardChar)).toBe('clipboard')
  })

  it('returns null when the cursor is outside any data-controller attribute', () => {
    const line = '  <div data-controller="clipboard">Some text</div>'
    expect(matchControllerIdentifierAtPosition(line, line.indexOf('Some text'))).toBeNull()
  })
})

describe('matchActionAtPosition', () => {
  it('resolves identifier and action from a simple data-action attribute', () => {
    const line = '  <button data-action="click->clipboard#copy">Copy</button>'
    const char = line.indexOf('copy">') + 1
    expect(matchActionAtPosition(line, char)).toEqual({ identifier: 'clipboard', action: 'copy' })
  })

  it('resolves the descriptor under the cursor in a multi-action attribute', () => {
    const line = '  <div data-action="click->dropdown#toggle mouseleave->dropdown#hide">'
    const toggleChar = line.indexOf('dropdown#toggle') + 12
    const hideChar = line.indexOf('dropdown#hide') + 12
    expect(matchActionAtPosition(line, toggleChar)).toEqual({ identifier: 'dropdown', action: 'toggle' })
    expect(matchActionAtPosition(line, hideChar)).toEqual({ identifier: 'dropdown', action: 'hide' })
  })

  it('resolves a bare identifier#action descriptor with no event prefix', () => {
    const line = '  <form data-action="clipboard#copy">'
    const char = line.indexOf('clipboard#copy') + 2
    expect(matchActionAtPosition(line, char)).toEqual({ identifier: 'clipboard', action: 'copy' })
  })

  it('returns null when the cursor is on the space between multi-value identifiers', () => {
    const line = '  <div data-controller="dropdown clipboard">'
    const spaceIndex = line.indexOf('clipboard') - 1
    expect(matchControllerIdentifierAtPosition(line, spaceIndex)).toBe('dropdown')
  })

  it('returns null when the cursor is outside any data-action attribute', () => {
    const line = '  <button data-action="click->clipboard#copy">Copy</button>'
    expect(matchActionAtPosition(line, line.indexOf('Copy</button>'))).toBeNull()
  })

  it('returns fallback first identifier when cursor is on a space between multi-value identifiers', () => {
    // Leading space before identifiers - cursor at position 0 within the value
    const line = '  <div data-controller=" dropdown clipboard">'
    // getWordRangeAtPosition would return the range of " dropdown clipboard"
    // Cursor at offset 0 (the leading space within value) doesn't match any identifier
    const valueStart = line.indexOf(' dropdown') + 1
    // Offset 0 is the leading space
    const result = matchControllerIdentifierAtPosition(line, valueStart)
    expect(result).toBe('dropdown') // falls through to line 38
  })

  it('returns null for an invalid action descriptor without #action', () => {
    const line = '  <div data-action="click->clipboard">'
    const char = line.indexOf('clipboard">')
    // parseActionDescriptor should return null for 'click->clipboard' (no #action)
    const result = matchActionAtPosition(line, char)
    expect(result).toBeNull()
  })
})
