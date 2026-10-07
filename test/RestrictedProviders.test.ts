import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('vscode', () => ({
  Range: class { constructor(public a: number, public b: number, public c: number, public d: number) {} },
  CodeLens: class { constructor(public range: unknown, public command: { command: string }) {} },
  workspace: { workspaceFolders: [] },
  window: {},
  TaskGroup: { Test: 'test', Build: 'build' },
  TaskRevealKind: { Always: 1 },
  TaskPanelKind: { Dedicated: 1 },
  ProcessExecution: class {},
  Task: class {},
}))

import { TestCodeLensProvider } from '../src/testing/TestCodeLensProvider'
import { RailsTaskProvider } from '../src/tasks/RailsTaskProvider'
import { setTrustProvider } from '../src/workspace/Trust'

afterEach(() => setTrustProvider(() => true))

const specDoc = {
  fileName: '/app/spec/models/order_spec.rb',
  uri: { fsPath: '/app/spec/models/order_spec.rb' },
  getText: () => 'RSpec.describe Order do\n  it "is valid" do\n  end\nend\n',
}

describe('test CodeLens in Restricted Mode', () => {
  it('offers Run/Debug lenses when trusted', () => {
    const lenses = new TestCodeLensProvider().provideCodeLenses(specDoc as never)
    expect(lenses.map(l => l.command?.command)).toEqual(['railsforge.runSingleTest', 'railsforge.debugSingleTest']) // the `it` line (`RSpec.describe` is not matched by the lens pattern)
  })

  it('offers none when untrusted (running a test executes project code)', () => {
    setTrustProvider(() => false)
    expect(new TestCodeLensProvider().provideCodeLenses(specDoc as never)).toEqual([])
  })
})

describe('task provider in Restricted Mode', () => {
  it('offers and resolves no tasks when untrusted', () => {
    setTrustProvider(() => false)
    const provider = new RailsTaskProvider()
    expect(provider.provideTasks()).toEqual([])
    expect(provider.resolveTask({ definition: { type: 'railsforge', task: 'test' }, scope: undefined } as never)).toBeUndefined()
  })
})
