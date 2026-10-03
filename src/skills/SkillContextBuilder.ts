/**
 * SkillContextBuilder - turns routed skills into a prompt block using progressive disclosure:
 * every chosen skill contributes its one-line description; the primary skills add their decision
 * rules / invariants / failure modes / verification (not the whole 15KB file); the best-matching
 * reference and patterns are named (and the top reference excerpted) when budget remains.
 * Total size is hard-capped, and nothing is added for skills that cannot be read.
 */

import { SkillRegistry } from './SkillRegistry'
import { RoutedSkill, RouteInput, suggestPatterns } from './SkillRouter'

export interface SkillContextOptions {
  /** Hard cap on the whole block. Default 6000 chars (~1.5k tokens). */
  maxChars?: number
  /** Include the excerpt of the best-matching reference for the primary skill. */
  includeReference?: boolean
}

/** Sections worth injecting, in priority order. */
const SECTION_PRIORITY = ['Decision rules', 'Critical invariants', 'Core contract', 'Implementation procedure', 'Anti-patterns / failure modes', 'Failure modes', 'Anti-patterns', 'Verification', 'Agent review checklist']

export function extractSections(markdown: string, headings: readonly string[]): Array<{ heading: string; body: string }> {
  const sections: Array<{ heading: string; body: string }> = []
  const parts = markdown.split(/^## /m).slice(1)
  for (const part of parts) {
    const newline = part.indexOf('\n')
    const heading = (newline === -1 ? part : part.slice(0, newline)).trim()
    if (headings.includes(heading)) {
      sections.push({ heading, body: (newline === -1 ? '' : part.slice(newline + 1)).trim() })
    }
  }
  return headings.flatMap(h => sections.filter(s => s.heading === h))
}

function clip(text: string, max: number): string {
  if (max <= 0) {return ''}
  if (text.length <= max) {return text}
  const cut = text.slice(0, max)
  const lastBreak = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '))
  return `${cut.slice(0, lastBreak > max * 0.6 ? lastBreak : max).trimEnd()}\n…`
}

function bestReference(registry: SkillRegistry, skillId: string, prompt: string): { file: string; title: string } | undefined {
  const refs = registry.get(skillId)?.references ?? []
  const words = new Set((prompt.toLowerCase().match(/[a-z][a-z0-9+]{3,}/g) ?? []))
  let best: { file: string; title: string; score: number } | undefined
  for (const r of refs) {
    const hay = `${r.file.replace(/[-.]/g, ' ')} ${r.title} ${r.when}`.toLowerCase()
    const score = [...words].filter(w => hay.includes(w)).length + (/n\+1|n \+ 1/.test(prompt.toLowerCase()) && /loading|performance/.test(hay) ? 2 : 0)
    if (score >= 2 && (!best || score > best.score)) {best = { file: r.file, title: r.title, score }}
  }
  return best
}

export function buildSkillContext(
  registry: SkillRegistry,
  routed: readonly RoutedSkill[],
  input: RouteInput,
  options: SkillContextOptions = {},
): string {
  if (routed.length === 0 || !registry.available) {return ''}
  const budget = options.maxChars ?? 6000
  const source = registry.source
  const header = [
    `## Engineering skills${source ? ` (ruby-agent-skills @${source.ref.slice(0, 8)})` : ''}`,
    'Apply these skills to this task. Prefer repository evidence over generic habits, keep the change minimal, and never claim verification you did not run.',
  ].join('\n')

  const blocks: string[] = []
  let used = header.length
  const primaries = routed.filter(r => r.role === 'primary')

  for (const skill of routed) {
    const entry = registry.get(skill.id)
    if (!entry) {continue}
    const lines = [`### ${skill.id} — ${skill.role}`]
    if (entry.description) {lines.push(entry.description)}

    if (skill.role === 'primary') {
      const text = registry.readSkill(skill.id)
      if (text) {
        // The first primary gets the largest share; later ones split what is left.
        const share = skill === primaries[0] ? 0.5 : 0.25
        let remaining = Math.max(0, Math.floor((budget - used) * share) - lines.join('\n').length)
        for (const section of extractSections(text, SECTION_PRIORITY)) {
          if (remaining < 200) {break}
          const body = clip(section.body, Math.min(remaining, 1400))
          lines.push(`**${section.heading}**\n${body}`)
          remaining -= body.length + section.heading.length + 6
        }
      }
    }

    const block = lines.join('\n')
    if (used + block.length > budget && blocks.length > 0) {continue}
    blocks.push(clip(block, Math.max(300, budget - used)))
    used += block.length
  }
  if (blocks.length === 0) {return ''}

  const footer: string[] = []
  const first = primaries[0]
  if (first && options.includeReference !== false) {
    const ref = bestReference(registry, first.id, `${input.prompt}\n${input.context ?? ''}`)
    if (ref) {
      const text = registry.readReference(first.id, ref.file)
      const room = budget - used - 200
      if (text && room > 400) {
        footer.push(`### Reference: ${ref.title} (${first.id}/${ref.file})\n${clip(text.replace(/^#.*\n+/, ''), Math.min(room, 1500))}`)
      }
    }
  }
  const patterns = registry.catalog ? suggestPatterns(registry.catalog, input) : []
  if (patterns.length > 0) {
    footer.push(`Relevant patterns (ask for them by name via the get_skill tool): ${patterns.join(', ')}`)
  }

  return [header, ...blocks, ...footer].join('\n\n').slice(0, budget + 400)
}
