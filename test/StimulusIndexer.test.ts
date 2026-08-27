import { describe, it, expect } from 'vitest'
import { StimulusIndexer } from '../src/hotwire/StimulusIndexer'

describe('StimulusIndexer', () => {
  const indexer = new StimulusIndexer()

  it('parses Stimulus controller targets, actions, and values', () => {
    const code = `
import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = [ "source", "output" ]
  static values = { url: String, interval: Number }

  connect() {
    console.log("connected")
  }

  copy(event) {
    event.preventDefault()
  }

  toggle() {
    this.outputTarget.classList.toggle("hidden")
  }
}
`
    const def = indexer.parseControllerCode('/app/javascript/controllers/clipboard_controller.js', code)

    expect(def.identifier).toBe('clipboard')
    expect(def.targets).toEqual(['source', 'output'])
    expect(def.values).toEqual(['url', 'interval'])
    expect(def.actions).toContain('copy')
    expect(def.actions).toContain('toggle')
    expect(def.actions).not.toContain('connect')
    expect(def.actionLines.copy).toBe(11)
    expect(def.actionLines.toggle).toBe(15)
  })

  it('handles nested folder names in identifier', () => {
    const code = `
export default class extends Controller {
  static targets = [ "menu" ]
}
`
    const def = indexer.parseControllerCode('/app/javascript/controllers/nested/dropdown_menu_controller.js', code)
    expect(def.identifier).toBe('nested--dropdown-menu')
  })

  it('defaults to application identifier when file path does not match the pattern', () => {
    const def = indexer.parseControllerCode('/app/javascript/some/random/file.js', 'export default class extends Controller {}')
    expect(def.identifier).toBe('application')
  })

  it('retrieves controllers via getController and getAllControllers', () => {
    const def = indexer.parseControllerCode('/app/javascript/controllers/clipboard_controller.js', `
export default class extends Controller {
  static targets = ["source"]
  copy() {}
}
`)
    expect(indexer.getController('clipboard')).toBe(def)
    expect(indexer.getAllControllers()).toContain(def)
  })
})

describe('StimulusIndexer.removeFile', () => {
  it('drops controllers defined in a deleted file', () => {
    const idx = new StimulusIndexer()
    idx.parseControllerCode('/app/javascript/controllers/admin/users_controller.js', 'export default class {}')
    expect(idx.getController('admin--users')).toBeDefined()
    idx.removeFile('/app/javascript/controllers/admin/users_controller.js')
    expect(idx.getController('admin--users')).toBeUndefined()
  })
})
