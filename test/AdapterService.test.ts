import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const probes = vi.hoisted(() => ({
  probeGlobalGem: vi.fn(),
  probeGlobalNpm: vi.fn(),
  probeRubyVersion: vi.fn(),
}))
vi.mock('../src/adapters/AdapterProbe', () => probes)

import { reportAdapters } from '../src/adapters/AdapterService'

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'railsforge-adapters-'))
  probes.probeGlobalGem.mockReset().mockResolvedValue({ found: false })
  probes.probeGlobalNpm.mockReset().mockResolvedValue({ found: false })
  probes.probeRubyVersion.mockReset().mockResolvedValue('3.3.1')
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('reportAdapters', () => {
  it('reports a gem in the lockfile as project-installed, without asking the machine', async () => {
    fs.writeFileSync(path.join(root, 'Gemfile.lock'), 'GEM\n  remote: https://rubygems.org/\n  specs:\n    debug-mcp (0.4.0)\n')
    const [report] = await reportAdapters(root, ['debug-mcp'])
    expect(report.state).toEqual({ kind: 'installed', where: 'project', version: '0.4.0' })
    expect(probes.probeGlobalGem).not.toHaveBeenCalled()
    expect(probes.probeRubyVersion).not.toHaveBeenCalled()
  })

  it('asks the machine about npm packages and gems that are not in the lockfile', async () => {
    probes.probeGlobalNpm.mockImplementation(async (name: string) => (name === 'ruby-console-mcp' ? { found: true, version: '1.0.1' } : { found: false }))
    const reports = await reportAdapters(root, ['ruby-console-mcp', 'gems-mcp'])
    expect(reports.map(report => report.state.kind)).toEqual(['installed', 'missing'])
    expect(probes.probeGlobalNpm).toHaveBeenCalledWith('ruby-console-mcp', root)
  })

  it('still reports project installs when the machine check is refused', async () => {
    fs.writeFileSync(path.join(root, 'Gemfile.lock'), 'GEM\n  specs:\n    debug-mcp (0.4.0)\n')
    probes.probeGlobalGem.mockResolvedValue({ found: null, reason: 'untrusted' })
    const [project] = await reportAdapters(root, ['debug-mcp'])
    expect(project.state.kind).toBe('installed')

    fs.rmSync(path.join(root, 'Gemfile.lock'))
    const [unchecked] = await reportAdapters(root, ['debug-mcp'])
    expect(unchecked.state).toEqual({ kind: 'unknown', reason: 'untrusted' })
  })
})
