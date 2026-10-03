/**
 * SkillCatalog - the build-time digest of the pinned ruby-agent-skills pack
 * (dist/skills/catalog.json, produced by scripts/fetch-skills.mjs). Validated with zod so a
 * malformed or future-version pack degrades to "skills unavailable" instead of crashing.
 */

import { z } from 'zod'

const referenceSchema = z.object({ file: z.string(), title: z.string(), when: z.string().default('') })

const skillSchema = z.object({
  family: z.string(),
  description: z.string().default(''),
  triggers: z.array(z.string()).default([]),
  references: z.array(referenceSchema).default([]),
})

const catalogSchema = z.object({
  schema: z.literal(1),
  source: z.object({ repo: z.string(), ref: z.string() }),
  defaults: z.object({ alwaysConsider: z.array(z.string()).default([]) }),
  retired: z.record(z.string(), z.string()).default({}),
  skills: z.record(z.string(), skillSchema),
  patterns: z.record(z.string(), z.array(z.object({ id: z.string(), description: z.string().default('') }))).default({}),
  routes: z.array(z.object({ task: z.string(), primary: z.array(z.string()), secondary: z.array(z.string()) })).default([]),
})

export type SkillCatalog = z.infer<typeof catalogSchema>
export type SkillEntry = z.infer<typeof skillSchema> & { id: string; origin: 'pack' | 'workspace' }

export function parseCatalog(json: unknown): SkillCatalog | undefined {
  const result = catalogSchema.safeParse(json)
  return result.success ? result.data : undefined
}
