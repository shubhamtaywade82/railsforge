import * as path from 'path'
import * as fs from 'fs'
import Mocha from 'mocha'

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'bdd', color: true, timeout: 60_000 })
  for (const file of fs.readdirSync(__dirname).filter(f => f.endsWith('.host.js'))) {
    mocha.addFile(path.resolve(__dirname, file))
  }
  return new Promise((resolve, reject) => {
    mocha.run(failures => (failures > 0 ? reject(new Error(`${failures} Extension Host test(s) failed`)) : resolve()))
  })
}
