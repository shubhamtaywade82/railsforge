/**
 * StimulusIndexer - Discovers and indexes Stimulus controllers, actions, and targets
 */

export interface StimulusControllerDef {
  identifier: string
  filePath: string
  targets: string[]
  actions: string[]
  values: string[]
  /** 1-based line number of each action method, keyed by method name. */
  actionLines: Record<string, number>
}

export class StimulusIndexer {
  private controllers: Map<string, StimulusControllerDef> = new Map()

  parseControllerCode(filePath: string, code: string): StimulusControllerDef {
    const identifier = this.fileToIdentifier(filePath)
    const targets = this.extractTargets(code)
    const { actions, actionLines } = this.extractActions(code)
    const values = this.extractValues(code)

    const def: StimulusControllerDef = {
      identifier,
      filePath,
      targets,
      actions,
      values,
      actionLines,
    }

    this.controllers.set(identifier, def)
    return def
  }

  private fileToIdentifier(filePath: string): string {
    const match = /(?:controllers[/\\])(.+)_controller\.[jt]s$/.exec(filePath)
    if (!match) {
      return 'application'
    }
    return match[1].replace(/[/\\]/g, '--').replace(/_/g, '-')
  }

  private extractTargets(code: string): string[] {
    const match = /static\s+targets\s*=\s*\[([^\]]+)\]/.exec(code)
    if (!match) {return []}

    return match[1]
      .split(',')
      .map(t => t.replace(/['"\s]/g, '').trim())
      .filter(Boolean)
  }

  private extractActions(code: string): { actions: string[]; actionLines: Record<string, number> } {
    const actions: string[] = []
    const actionLines: Record<string, number> = {}
    const methodRegex = /^\s*([a-zA-Z0-9_]+)\s*\((?:event)?\)\s*\{/gm
    let match: RegExpExecArray | null

    while ((match = methodRegex.exec(code)) !== null) {
      const name = match[1]
      if (!['connect', 'disconnect', 'initialize'].includes(name)) {
        actions.push(name)
        actionLines[name] = code.slice(0, match.index).split('\n').length
      }
    }
    return { actions, actionLines }
  }

  private extractValues(code: string): string[] {
    const match = /static\s+values\s*=\s*\{([^}]+)\}/.exec(code)
    if (!match) {return []}

    return match[1]
      .split(',')
      .map(v => v.split(':')[0].replace(/['"\s]/g, '').trim())
      .filter(Boolean)
  }

  /** Drops every controller defined in `filePath` (called when the file is deleted). */
  removeFile(filePath: string): void {
    for (const [identifier, def] of this.controllers) {
      if (def.filePath === filePath) {this.controllers.delete(identifier)}
    }
  }

  getController(identifier: string): StimulusControllerDef | undefined {
    return this.controllers.get(identifier)
  }

  getAllControllers(): StimulusControllerDef[] {
    return Array.from(this.controllers.values())
  }
}
