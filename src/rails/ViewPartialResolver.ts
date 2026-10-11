/**
 * ViewPartialResolver - Resolves Rails view partials and template paths
 */

import * as path from 'path'
import * as fs from 'fs'

export class ViewPartialResolver {
  private readonly extensions = ['.html.erb', '.erb', '.html.haml', '.haml', '.html.slim', '.slim']

  resolvePartialPath(
    renderPath: string,
    currentFilePath: string,
    workspaceRoot: string,
  ): string | null {
    const clean = renderPath.replace(/['":]/g, '').trim()
    if (!clean) {return null}

    let targetDir: string
    let partialName: string

    if (clean.includes('/')) {
      const parts = clean.split('/')
      partialName = `_${parts.pop()}`
      targetDir = path.join(workspaceRoot, 'app', 'views', ...parts)
    } else {
      const currentDir = path.dirname(currentFilePath)
      const viewsSegment = `${path.sep}app${path.sep}views`
      targetDir = currentDir.includes(viewsSegment)
        ? currentDir
        : path.join(workspaceRoot, 'app', 'views')
      partialName = `_${clean}`
    }

    for (const ext of this.extensions) {
      const fullPath = path.join(targetDir, `${partialName}${ext}`)
      if (fs.existsSync(fullPath)) {
        return fullPath
      }
    }

    // Fallback: Check non-partial
    const baseName = clean.includes('/') ? clean.split('/').pop()! : clean
    for (const ext of this.extensions) {
      const fullPath = path.join(targetDir, `${baseName}${ext}`)
      if (fs.existsSync(fullPath)) {
        return fullPath
      }
    }

    return null
  }
}

/**
 * Given a line of ERB/HAML/Slim and a 0-based character offset, returns the
 * quoted path passed to `render` if the cursor is sitting on it, e.g.
 * `render "shared/navbar"` or `render partial: "users/card", locals: {...}`.
 * Used by ViewPartialDefinitionProvider to resolve exactly the render call the
 * cursor is on.
 */
export function extractRenderPathAtPosition(line: string, char: number): string | null {
  const pattern = /render(?:\s*\(\s*|\s+)(?:partial:\s*)?["']([^"']+)["']/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(line)) !== null) {
    const value = match[1]
    const start = match.index + match[0].lastIndexOf(value)
    const end = start + value.length
    if (char >= start && char <= end) {
      return value
    }
  }
  return null
}
