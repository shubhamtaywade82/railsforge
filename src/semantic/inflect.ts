/** Minimal Rails-style inflections used to link models, tables and controllers by convention. */

export function underscore(word: string): string {
  return word
    .replace(/::/g, '/')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .toLowerCase()
}

export function camelize(word: string): string {
  return word
    .split('/')
    .map(part => part.split('_').filter(Boolean).map(s => s[0].toUpperCase() + s.slice(1)).join(''))
    .join('::')
}

const IRREGULAR_SINGULAR: Record<string, string> = { people: 'person', men: 'man', children: 'child', media: 'medium', data: 'datum' }
const IRREGULAR_PLURAL = Object.fromEntries(Object.entries(IRREGULAR_SINGULAR).map(([p, s]) => [s, p]))

export function singularize(word: string): string {
  const lower = word.toLowerCase()
  const irregular = IRREGULAR_SINGULAR[lower.split('_').pop() ?? lower]
  if (irregular) {return word.slice(0, word.length - lower.split('_').pop()!.length) + irregular}
  if (/ies$/.test(word)) {return `${word.slice(0, -3)}y`}
  if (/(ss|us|is)$/.test(word)) {return word}
  if (/(ch|sh|x|z|ss)es$/.test(word)) {return word.slice(0, -2)}
  if (/ses$/.test(word)) {return word.slice(0, -2)}
  if (/s$/.test(word)) {return word.slice(0, -1)}
  return word
}

export function pluralize(word: string): string {
  const last = word.split('_').pop() ?? word
  const irregular = IRREGULAR_PLURAL[last]
  if (irregular) {return word.slice(0, word.length - last.length) + irregular}
  if (/[^aeiou]y$/.test(word)) {return `${word.slice(0, -1)}ies`}
  if (/(s|x|z|ch|sh)$/.test(word)) {return `${word}es`}
  return `${word}s`
}

/** `Admin::Order` -> `admin_orders` (the conventional table name). */
export function tableNameFor(modelName: string): string {
  return pluralize(underscore(modelName).replace(/\//g, '_'))
}

/** `admin/orders` -> `Admin::OrdersController` */
export function controllerClassFor(path: string): string {
  return `${camelize(path)}Controller`
}

/** `Admin::OrdersController` -> `admin/orders` */
export function controllerPathFor(className: string): string {
  return underscore(className.replace(/Controller$/, ''))
}
