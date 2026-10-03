import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { EnvironmentDetector, formatProjectType } from '../src/environment/EnvironmentDetector'

describe('EnvironmentDetector', () => {
  const detector = new EnvironmentDetector()

  it('detects Rails version and Hotwire capabilities from Gemfile.lock', () => {
    const lock = `
GEM
  remote: https://rubygems.org/
  specs:
    rails (7.1.3.2)
      actioncable (= 7.1.3.2)
      actionmailbox (= 7.1.3.2)
    stimulus-rails (1.3.3)
    turbo-rails (2.0.4)
    pundit (2.3.1)
    view_component (3.11.0)
    strong_migrations (1.7.0)
    rspec-rails (6.1.1)

PLATFORMS
  ruby

DEPENDENCIES
  rails (~> 7.1.3)
  rspec-rails
`
    // Test extraction helper
    const railsVer = detector['extractGemVersion'](lock, 'rails')
    expect(railsVer).toBe('7.1.3.2')

    const punditVer = detector['extractGemVersion'](lock, 'pundit')
    expect(punditVer).toBe('2.3.1')
  })

  it('marks hasRails false and leaves railsVersion empty for a standalone gem (no rails dependency)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'railsforge-gem-'))
    fs.writeFileSync(
      path.join(tmpDir, 'Gemfile.lock'),
      `
GEM
  remote: https://rubygems.org/
  specs:
    rspec (3.13.0)

PLATFORMS
  ruby

DEPENDENCIES
  rspec
`,
    )

    const env = detector.detectEnvironment(tmpDir)

    expect(env.hasRails).toBe(false)
    expect(env.railsVersion).toBe('')
    expect(env.majorRailsVersion).toBe(0)

    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('determines binstub vs bundle exec command prefix', () => {
    const env = {
      rubyVersion: '3.3.0',
      hasRails: true,
      railsVersion: '7.1.0',
      majorRailsVersion: 7,
      hasHotwire: true,
      hasTurbo: true,
      hasStimulus: true,
      hasPundit: true,
      hasViewComponent: true,
      hasStrongMigrations: true,
      hasBrakeman: false,
      hasPry: false,
      testFramework: 'rspec' as const,
      binstubs: new Set(['rubocop']),
      projectType: 'monolith' as const,
    }

    expect(detector.getCommandPrefix('rubocop', env, '/workspace')).toBe('bundle exec rubocop')
  })

  describe('projectType', () => {
    function railsLock(): string {
      return `
GEM
  remote: https://rubygems.org/
  specs:
    rails (7.1.3.2)

DEPENDENCIES
  rails (~> 7.1.3)
`
    }

    it('detects a full Rails app as monolith', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'railsforge-monolith-'))
      fs.writeFileSync(path.join(tmpDir, 'Gemfile.lock'), railsLock())

      expect(detector.detectEnvironment(tmpDir).projectType).toBe('monolith')

      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it('detects an API-only Rails app via config.api_only = true', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'railsforge-api-'))
      fs.writeFileSync(path.join(tmpDir, 'Gemfile.lock'), railsLock())
      fs.mkdirSync(path.join(tmpDir, 'config'), { recursive: true })
      fs.writeFileSync(
        path.join(tmpDir, 'config', 'application.rb'),
        'module MyApi\n  class Application < Rails::Application\n    config.api_only = true\n  end\nend\n',
      )

      expect(detector.detectEnvironment(tmpDir).projectType).toBe('api_only')

      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it('detects an API-only Rails app via ApplicationController < ActionController::API', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'railsforge-api-controller-'))
      fs.writeFileSync(path.join(tmpDir, 'Gemfile.lock'), railsLock())
      fs.mkdirSync(path.join(tmpDir, 'app', 'controllers'), { recursive: true })
      fs.writeFileSync(
        path.join(tmpDir, 'app', 'controllers', 'application_controller.rb'),
        'class ApplicationController < ActionController::API\nend\n',
      )

      expect(detector.detectEnvironment(tmpDir).projectType).toBe('api_only')

      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it('detects a non-Rails project with a .gemspec as a gem', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'railsforge-gemspec-'))
      fs.writeFileSync(path.join(tmpDir, 'my_gem.gemspec'), 'Gem::Specification.new do |s|\nend\n')

      expect(detector.detectEnvironment(tmpDir).projectType).toBe('gem')

      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it('detects a non-Rails project with no .gemspec as a script', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'railsforge-script-'))

      expect(detector.detectEnvironment(tmpDir).projectType).toBe('script')

      fs.rmSync(tmpDir, { recursive: true, force: true })
    })
  })
})

describe('formatProjectType', () => {
  it('renders a human-readable label for each project type', () => {
    expect(formatProjectType('monolith')).toBe('Monolith (full MVC)')
    expect(formatProjectType('api_only')).toBe('API-only')
    expect(formatProjectType('gem')).toBe('Gem')
    expect(formatProjectType('script')).toBe('Script')
  })
})

describe('EnvironmentDetector version grounding', () => {
  const detector = new EnvironmentDetector()
  const mk = (files: Record<string, string>): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'railsforge-ver-'))
    for (const [name, content] of Object.entries(files)) {fs.writeFileSync(path.join(dir, name), content)}
    return dir
  }

  it('reports unknown Ruby instead of fabricating a version', () => {
    expect(detector.detectEnvironment(mk({})).rubyVersion).toBe('unknown')
  })

  it('falls back to the Gemfile ruby directive, then Gemfile.lock RUBY VERSION', () => {
    expect(detector.detectEnvironment(mk({ Gemfile: "source 'x'\nruby '3.2.4'\n" })).rubyVersion).toBe('3.2.4')
    expect(detector.detectEnvironment(mk({ 'Gemfile.lock': 'RUBY VERSION\n   ruby 3.1.2p20\n\nBUNDLED WITH\n   2.4.1\n' })).rubyVersion).toBe('3.1.2')
  })

  it('parses prerelease Rails versions', () => {
    const env = detector.detectEnvironment(mk({ 'Gemfile.lock': 'GEM\n  specs:\n    rails (8.1.0.beta1)\n' }))
    expect(env.railsVersion).toBe('8.1.0.beta1')
    expect(env.majorRailsVersion).toBe(8)
  })

  it('does not infer Hotwire from the Rails major version alone', () => {
    const env = detector.detectEnvironment(mk({ 'Gemfile.lock': 'GEM\n  specs:\n    rails (7.1.0)\n' }))
    expect(env.hasHotwire).toBe(false)
  })
})
