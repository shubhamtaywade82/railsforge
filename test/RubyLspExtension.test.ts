import { describe, expect, it } from 'vitest'
import { isRubyLspExtensionOutdated, MIN_RUBY_LSP_EXTENSION_VERSION } from '../src/environment/RubyLspExtension'

describe('RubyLspExtension', () => {
  it('flags versions below the minimum', () => {
    expect(isRubyLspExtensionOutdated('0.10.6')).toBe(true)
    expect(isRubyLspExtensionOutdated(MIN_RUBY_LSP_EXTENSION_VERSION)).toBe(false)
    expect(isRubyLspExtensionOutdated('0.12.0')).toBe(false)
  })

  it('does not flag a missing version', () => {
    expect(isRubyLspExtensionOutdated(undefined)).toBe(false)
  })
})
