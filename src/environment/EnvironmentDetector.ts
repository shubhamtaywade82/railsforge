/**
 * EnvironmentDetector - Deterministic discovery of Ruby, Rails, and Gemfile ecosystem
 */

import * as fs from 'fs'
import * as path from 'path'

/**
 * Broad shape of the project, used to adapt which features are relevant:
 * - `monolith`: a full Rails app (views, helpers, asset pipeline)
 * - `api_only`: a Rails app with `config.api_only = true` (or an
 *   `ApplicationController < ActionController::API`) — no views/helpers
 * - `gem`: a non-Rails Ruby project with a `.gemspec`
 * - `script`: any other non-Rails Ruby codebase
 */
export type ProjectType = 'monolith' | 'api_only' | 'gem' | 'script'

export function formatProjectType(type: ProjectType): string {
  switch (type) {
    case 'monolith': return 'Monolith (full MVC)'
    case 'api_only': return 'API-only'
    case 'gem': return 'Gem'
    case 'script': return 'Script'
  }
}

/** Sentinel for a version the project never declared. Never substitute a guess. */
export const UNKNOWN_VERSION = 'unknown'

export function isKnownVersion(v: string | undefined): v is string {
  return Boolean(v) && v !== UNKNOWN_VERSION
}

export interface ProjectEnvironment {
  /** Declared Ruby version, or UNKNOWN_VERSION when no file/Gemfile/lockfile declares one. */
  rubyVersion: string
  /** True only when `rails` is an actual Gemfile.lock dependency — a plain gem/script isn't a Rails app. */
  hasRails: boolean
  railsVersion: string
  majorRailsVersion: number
  projectType: ProjectType
  hasHotwire: boolean
  hasTurbo: boolean
  hasStimulus: boolean
  hasPundit: boolean
  hasViewComponent: boolean
  hasStrongMigrations: boolean
  hasBrakeman: boolean
  hasPry: boolean
  testFramework: 'rspec' | 'minitest'
  binstubs: Set<string>
}

export class EnvironmentDetector {
  detectEnvironment(workspaceRoot: string): ProjectEnvironment {
    const rubyVersion = this.detectRubyVersion(workspaceRoot)
    const gemfileLockContent = this.readGemfileLock(workspaceRoot)
    const detectedRailsVersion = this.extractGemVersion(gemfileLockContent, 'rails')
    const hasRails = detectedRailsVersion !== null
    const railsVersion = detectedRailsVersion ?? ''
    const majorRails = hasRails ? parseInt(railsVersion.split('.')[0], 10) || 7 : 0

    const hasTurbo = gemfileLockContent.includes('turbo-rails')
    const hasStimulus = gemfileLockContent.includes('stimulus-rails')
    // Hotwire is only "active" when a Hotwire gem is actually locked; Rails 7+ alone doesn't imply it.
    const hasHotwire = hasTurbo || hasStimulus
    const hasPundit = gemfileLockContent.includes('pundit')
    const hasViewComponent = gemfileLockContent.includes('view_component')
    const hasStrongMigrations = gemfileLockContent.includes('strong_migrations')
    const hasBrakeman = gemfileLockContent.includes('brakeman')
    const hasPry = gemfileLockContent.includes('pry')
    const testFramework = gemfileLockContent.includes('rspec-rails') ? 'rspec' : 'minitest'
    const binstubs = this.detectBinstubs(workspaceRoot)
    const projectType = this.detectProjectType(workspaceRoot, hasRails)

    return {
      rubyVersion,
      hasRails,
      railsVersion,
      majorRailsVersion: majorRails,
      projectType,
      hasHotwire,
      hasTurbo,
      hasStimulus,
      hasPundit,
      hasViewComponent,
      hasStrongMigrations,
      hasBrakeman,
      hasPry,
      testFramework,
      binstubs,
    }
  }

  getCommandPrefix(binName: string, env: ProjectEnvironment, workspaceRoot: string): string {
    if (env.binstubs.has(binName)) {
      const binstubPath = path.join(workspaceRoot, 'bin', binName)
      if (fs.existsSync(binstubPath)) {
        return `bin/${binName}`
      }
    }
    return `bundle exec ${binName}`
  }

  private detectRubyVersion(root: string): string {
    const dotRubyVersion = path.join(root, '.ruby-version')
    if (fs.existsSync(dotRubyVersion)) {
      const val = fs.readFileSync(dotRubyVersion, 'utf8').trim()
      if (val) {return val.replace(/^ruby-/, '')}
    }

    const toolVersions = path.join(root, '.tool-versions')
    if (fs.existsSync(toolVersions)) {
      const lines = fs.readFileSync(toolVersions, 'utf8').split('\n')
      for (const line of lines) {
        if (line.startsWith('ruby ')) {
          const val = line.replace('ruby ', '').trim().split(/\s+/)[0]
          if (val) {return val}
        }
      }
    }

    const dotRbenv = path.join(root, '.rbenv-version')
    if (fs.existsSync(dotRbenv)) {
      const val = fs.readFileSync(dotRbenv, 'utf8').trim()
      if (val) {return val}
    }

    const fromGemfile = this.rubyFromGemfile(root)
    if (fromGemfile) {return fromGemfile}

    const fromLock = this.rubyFromGemfileLock(root)
    if (fromLock) {return fromLock}

    return UNKNOWN_VERSION
  }

  private rubyFromGemfile(root: string): string | null {
    const gemfile = path.join(root, 'Gemfile')
    if (!fs.existsSync(gemfile)) {return null}
    const match = /^\s*ruby\s+['"]([0-9][^'"]*)['"]/m.exec(fs.readFileSync(gemfile, 'utf8'))
    return match ? match[1] : null
  }

  private rubyFromGemfileLock(root: string): string | null {
    const match = /^RUBY VERSION\s*\n\s+ruby\s+([0-9][0-9A-Za-z.]*?)(?:p\d+)?\s*$/m.exec(this.readGemfileLock(root))
    return match ? match[1] : null
  }

  private readGemfileLock(root: string): string {
    const lockPath = path.join(root, 'Gemfile.lock')
    if (fs.existsSync(lockPath)) {
      return fs.readFileSync(lockPath, 'utf8')
    }
    return ''
  }

  private extractGemVersion(gemfileLock: string, gemName: string): string | null {
    const regex = new RegExp(`^\\s+${gemName}\\s+\\(([0-9][0-9A-Za-z.]*)\\)`, 'm')
    const match = regex.exec(gemfileLock)
    return match ? match[1] : null
  }

  private detectProjectType(root: string, hasRails: boolean): ProjectType {
    if (hasRails) {
      return this.isApiOnly(root) ? 'api_only' : 'monolith'
    }
    return this.hasGemspec(root) ? 'gem' : 'script'
  }

  private isApiOnly(root: string): boolean {
    const applicationConfigPath = path.join(root, 'config', 'application.rb')
    if (fs.existsSync(applicationConfigPath)) {
      const content = fs.readFileSync(applicationConfigPath, 'utf8')
      if (/config\.api_only\s*=\s*true/.test(content)) {return true}
    }

    const applicationControllerPath = path.join(root, 'app', 'controllers', 'application_controller.rb')
    if (fs.existsSync(applicationControllerPath)) {
      const content = fs.readFileSync(applicationControllerPath, 'utf8')
      if (/class\s+ApplicationController\s*<\s*ActionController::API/.test(content)) {return true}
    }

    return false
  }

  private hasGemspec(root: string): boolean {
    if (!fs.existsSync(root)) {return false}
    return fs.readdirSync(root).some(f => f.endsWith('.gemspec'))
  }

  private detectBinstubs(root: string): Set<string> {
    const set = new Set<string>()
    const binDir = path.join(root, 'bin')
    if (fs.existsSync(binDir)) {
      const files = fs.readdirSync(binDir)
      for (const f of files) {
        set.add(f)
      }
    }
    return set
  }
}
