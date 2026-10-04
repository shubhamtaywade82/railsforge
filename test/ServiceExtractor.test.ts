import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { describe, it, expect, afterEach } from 'vitest'
import { ServiceExtractor } from '../src/refactor/ServiceExtractor'

const native = (p: string) => p.split('/').join(path.sep)

describe('ServiceExtractor', () => {
  const extractor = new ServiceExtractor()
  const root = '/path/to/my_app'

  it('generates a clean Service Object and replacement call', () => {
    const code = `
user = User.find(user_id)
user.update!(status: 'active')
UserMailer.welcome(user).deliver_later
user
`
    const res = extractor.extractService('ActivateUser', code, ['user_id'], root)

    expect(res.serviceFilePath).toContain(native('/app/services/activate_user_service.rb'))
    expect(res.serviceCode).toContain('class ActivateUserService < ApplicationService')
    expect(res.serviceCode).toContain('def self.call(user_id)')
    expect(res.serviceCode).toContain('attr_reader :user_id')
    expect(res.serviceCode).toContain("user.update!(status: 'active')")
    expect(res.replacementCall).toBe('ActivateUserService.call(user_id)')
  })

  it('detects free variables the selection reads but does not assign', () => {
    const code = `
order = Order.create!(user: current_user, total: params[:total])
OrderMailer.confirmation(order).deliver_later
`
    const freeVars = extractor.detectFreeVariables(code)

    expect(freeVars).toContain('current_user')
    expect(freeVars).toContain('params')
    expect(freeVars).not.toContain('order')
  })

  it('honors custom guidelines (dir/base class/method name) instead of the Rails default', () => {
    const res = extractor.extractService('ActivateUser', 'do_thing', ['user_id'], root, {
      dir: 'lib/operations',
      baseClass: 'Interactor',
      methodName: 'run',
    })

    expect(res.serviceFilePath).toContain(native('/lib/operations/activate_user_service.rb'))
    expect(res.serviceCode).toContain('class ActivateUserService < Interactor')
    expect(res.serviceCode).toContain('def self.run(user_id)')
    expect(res.serviceCode).toContain('new(user_id).run')
    expect(res.replacementCall).toBe('ActivateUserService.run(user_id)')
  })

  describe('with a custom .railsforge/templates/service.erb', () => {
    let tmpRoot: string

    afterEach(() => {
      if (tmpRoot) {fs.rmSync(tmpRoot, { recursive: true, force: true })}
    })

    it('renders the custom template instead of the built-in default', () => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'railsforge-template-test-'))
      fs.mkdirSync(path.join(tmpRoot, '.railsforge', 'templates'), { recursive: true })
      fs.writeFileSync(
        path.join(tmpRoot, '.railsforge', 'templates', 'service.erb'),
        'class {{class_name}} < {{base_class}}\n  def {{method_name}}\n    {{selected_code}}\n  end\nend\n',
      )

      const res = extractor.extractService('SendInvite', 'Invite.create!', [], tmpRoot, {
        dir: 'app/services',
        baseClass: 'ApplicationService',
        methodName: 'call',
      })

      expect(res.serviceCode).toBe('class SendInviteService < ApplicationService\n  def call\n    Invite.create!\n  end\nend\n')
    })
  })
})
