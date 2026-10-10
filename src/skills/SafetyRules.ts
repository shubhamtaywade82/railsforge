/**
 * SafetyRules - deterministic guardrails evaluated on the request text, independent of the router's
 * scoring. When a request touches something dangerous (destructive database commands, SQL built from
 * strings, mass assignment, dynamic dispatch on user input, committed secrets, risky schema changes,
 * destructive shell/VCS commands, production operations, disabled auth/CSRF) the relevant security or
 * database skill is *forced* into the routed set and a warning is injected into the prompt.
 *
 * Rules are plain regexes over a lower-cased prompt (+ optional context); they are linear-time (no
 * nested quantifiers) and unit-tested with positive and negative cases.
 */

export interface SafetyInput {
  prompt: string
  /** Extra evidence (diagnostic message, file name). */
  context?: string
}

export interface SafetyFinding {
  rule: string
  warning: string
  /** Skills that must be considered for this request. */
  skills: string[]
}

interface SafetyRule {
  id: string
  tests: RegExp[]
  skills: string[]
  warning: string
}

const SECURITY = ['rails-security', 'rails-security-engineering']

export const SAFETY_RULES: readonly SafetyRule[] = [
  {
    id: 'destructive-database',
    tests: [
      /\bdb:(?:drop|reset|purge|schema:load|migrate:reset|setup)\b/,
      /\bdrop\s+(?:table|database|schema)\b/,
      /\btruncate(?:\s+table)?\s+\w+/,
      /\bdelete\s+from\s+\w+\s*(?:;|$)/m,
      /\.(?:delete_all|destroy_all)\b/,
    ],
    skills: ['rails-database-engineering'],
    warning: 'Destructive database operation. Never run it against production; require explicit confirmation and a verified backup, scope it narrowly, and prefer a reversible change.',
  },
  {
    id: 'sql-injection',
    tests: [
      /\bsql[ -]injection\b/,
      /\b(?:where|order|group|having|joins|select|find_by_sql|execute|exec_query)\s*\(?\s*["'][^\n]{0,300}#\{/,
      /\b(?:where|order|find_by_sql|execute)\s*\(?\s*["'][^"'\n]*["']\s*\+\s*\w/,
    ],
    skills: SECURITY,
    warning: 'SQL assembled from strings. Use bind parameters (where("a = ?", v) / hash conditions) or sanitize_sql_*; never interpolate request data into SQL.',
  },
  {
    id: 'mass-assignment',
    tests: [/\bpermit!/, /\bto_unsafe_h\b/, /\.(?:update|new|create|assign_attributes)\s*\(\s*params\s*\)/],
    skills: SECURITY,
    warning: 'Unfiltered parameters reach the model. Permit an explicit allowlist (params.expect / permit) instead of permit! or raw params.',
  },
  {
    id: 'dynamic-dispatch-on-input',
    tests: [
      /\b(?:eval|instance_eval|class_eval|constantize|safe_constantize|public_send|send)\b[^\n]{0,300}\b(?:params|user_input|input|request|cookies)\b/,
      /\b(?:params|user_input|input|request|cookies)\b[^\n]{0,300}\.(?:constantize|safe_constantize|send|public_send|eval|instance_eval|class_eval)\b/,
      /\b(?:system|exec|spawn|popen3?|open3)\b[^\n]{0,300}(?:params|#\{|user_input)/,
      /%x[({[][^\n]{0,300}#\{/,
    ],
    skills: SECURITY,
    warning: 'Untrusted input reaches eval/send/constantize or a shell. Map input to an explicit allowlist of classes/methods and pass shell arguments as an array, never a string.',
  },
  {
    id: 'committed-secret',
    tests: [
      /\b(?:sk|pk|ghp|gho|xox[bp])[-_][a-z0-9]{16,}/,
      /\b(?:api[_ -]?key|secret|password|token|private[_ -]?key|credentials?)\b[^\n]{0,40}\b(?:hard-?coded?|commit(?:ted)?|plain ?text|in (?:the )?(?:repo|code|source|git))\b/,
      /\b(?:log|print|puts)\w*\b[^\n]{0,30}\b(?:password|token|api[_ -]?key|secret)\b/,
    ],
    skills: ['rails-encryption-credentials-engineering', ...SECURITY],
    warning: 'Secrets must not be committed, logged or printed. Use encrypted credentials or environment configuration, and rotate anything that has already leaked.',
  },
  {
    id: 'live-table-schema-change',
    tests: [
      /\b(?:rename_column|remove_column|drop_column|change_column(?:_null|_default)?|change_table)\b/,
      /\badd_index\b(?![^\n]{0,300}concurrent)/,
      /\b(?:rename|drop|remove|change)\s+(?:a\s+|the\s+)?(?:\w+\s+)?column\b/,
      /\badd(?:ing)?\s+(?:an?\s+)?(?:unique\s+)?index\b(?![^\n]{0,300}concurrent)/,
    ],
    skills: ['rails-database-engineering'],
    warning: 'Schema change on a table that may be large and live. Use expand/contract, create indexes concurrently, avoid long locks and rewrites, and keep the migration reversible.',
  },
  {
    id: 'destructive-shell-vcs',
    tests: [
      /\brm\s+-[a-z]*r[a-z]*f?\b/,
      /\bgit\s+push\s+(?:[^\n]{0,300}\s)?(?:--force\b|-f\b)/,
      /\bgit\s+reset\s+--hard\b/,
      /\bgit\s+clean\s+-[a-z]*f/,
      /\bfileutils\.rm_rf\b/,
      /\bchmod\s+-r\s+777\b/,
      /\bsudo\b/,
    ],
    skills: [],
    warning: 'Destructive shell or VCS command. Do not run it without explicit confirmation from the user, and show exactly what it will affect first.',
  },
  {
    id: 'production-operation',
    tests: [
      /\b(?:production|prod)\b[^\n]{0,60}\b(?:delete|drop|migrat\w*|console|truncate|reset|seed|rollback|restart)\b/,
      /\b(?:delete|drop|migrat\w*|truncate|reset|seed|rollback)\b[^\n]{0,60}\b(?:in|on|against)\s+(?:production|prod)\b/,
    ],
    skills: ['rails-incident-engineering', 'rails-operational-tasks-maintenance'],
    warning: 'Production change. Dry-run first, scope narrowly, have a rollback and verification step, and never act on a hunch.',
  },
  {
    id: 'disabled-protection',
    tests: [
      /\bskip_before_action\s*:(?:authenticate\w*|verify_authenticity_token|authorize\w*|require_\w+)/,
      /\bskip_(?:authorization|forgery_protection)\b/,
      /\bprotect_from_forgery\b[^\n]{0,300}null_session/,
      /\b(?:disable|turn off|bypass|remove)\b[^\n]{0,20}\b(?:csrf|authentication|authorization|auth check|ssl|https)\b/,
    ],
    skills: ['rails-authorization', ...SECURITY],
    warning: 'Authentication, authorization or CSRF protection is being disabled. Confirm the endpoint is intentionally public, scope the exception to the specific action, and add a test that proves the intended access.',
  },
]

/** Findings for a request, in rule order, each rule at most once. Deterministic and linear-time. */
export function evaluateSafety(input: SafetyInput): SafetyFinding[] {
  const text = `${input.prompt}\n${input.context ?? ''}`.toLowerCase()
  const findings: SafetyFinding[] = []
  for (const rule of SAFETY_RULES) {
    if (rule.tests.some(t => t.test(text))) {
      findings.push({ rule: rule.id, warning: rule.warning, skills: [...rule.skills] })
    }
  }
  return findings
}
