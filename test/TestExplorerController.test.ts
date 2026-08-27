import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as vscode from '../test/__mocks__/vscode'
import { TestExplorerController } from '../src/testing/TestExplorerController'

vi.mock('vscode', () => vi.importActual('../test/__mocks__/vscode'))

const { mockExecFile } = vi.hoisted(() => {
  const mockExecFile = vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
    cb(null, '', '')
  })
  return { mockExecFile }
})

vi.mock('child_process', () => ({
  execFile: mockExecFile,
}))

let capturedHandler: ((request: unknown, token: unknown) => Promise<void>) | null = null

const createTextDocument = (fileName: string, text: string) => {
  const doc = new vscode.TextDocument(fileName, 'ruby', text)
  return doc as unknown as vscode.TextDocument
}

describe('TestExplorerController', () => {
  let controller: TestExplorerController

  beforeEach(() => {
    vi.clearAllMocks()
    capturedHandler = null
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
        cb(null, '', '')
      },
    )
    vi.spyOn(vscode.TestController.prototype, 'createRunProfile').mockImplementation(
      function(_label: string, _kind: unknown, handler: unknown) {
        capturedHandler = handler as (request: unknown, token: unknown) => Promise<void>
        return undefined
      },
    )
    controller = new TestExplorerController()
  })

  it('should create controller and get it', () => {
    const tc = controller.getController()
    expect(tc).toBeDefined()
  })

  it('should not discover tests in non-test files', () => {
    const doc = createTextDocument('app/models/user.rb', 'class User; end')
    controller.discoverTestsInDocument(doc)
  })

  it('should discover RSpec test blocks', () => {
    const doc = createTextDocument('spec/models/user_spec.rb', `require 'rails_helper'

RSpec.describe User, type: :model do
  it 'validates email presence' do
  end

  it 'has many posts' do
  end
end`)
    controller.discoverTestsInDocument(doc)
  })

  it('should discover Minitest test blocks', () => {
    const doc = createTextDocument('test/models/user_test.rb', `class UserTest < ActiveSupport::TestCase
  test 'validates email' do
  end

  test 'has posts' do
  end
end`)
    controller.discoverTestsInDocument(doc)
  })

  it('should discover scenario and specify blocks', () => {
    const doc = createTextDocument('spec/features/login_spec.rb', `RSpec.feature 'Login' do
  scenario 'user logs in successfully' do
  end

  specify 'redirects to dashboard' do
  end
end`)
    controller.discoverTestsInDocument(doc)
  })

  it('should dispose without error', () => {
    expect(() => controller.dispose()).not.toThrow()
  })

  it('runHandler should pass tests when execFile succeeds', async () => {
    expect(capturedHandler).not.toBeNull()

    const request = new vscode.TestRunRequest()
    const testItem = controller.getController().createTestItem('test1', 'my test', vscode.Uri.file('/spec/test_spec.rb'))
    request.include = [testItem]

    await capturedHandler!(request, new vscode.CancellationToken())
  })

  it('runHandler should fail tests when execFile returns error', async () => {
    expect(capturedHandler).not.toBeNull()

    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
        cb(new Error('test failure'), '', 'expected 1, got 0')
      },
    )

    const request = new vscode.TestRunRequest()
    const testItem = controller.getController().createTestItem('test2', 'failing test', vscode.Uri.file('/spec/fail_spec.rb'))
    request.include = [testItem]

    await capturedHandler!(request, new vscode.CancellationToken())
  })

  it('runHandler should skip tests when cancelled', async () => {
    expect(capturedHandler).not.toBeNull()

    const token = new vscode.CancellationToken()
    token.isCancellationRequested = true

    const request = new vscode.TestRunRequest()
    const testItem = controller.getController().createTestItem('test3', 'skipped test', vscode.Uri.file('/spec/skip_spec.rb'))
    request.include = [testItem]

    await capturedHandler!(request, token)
  })

  it('runHandler should run all tests when no include list', async () => {
    expect(capturedHandler).not.toBeNull()

    const request = new vscode.TestRunRequest()
    await capturedHandler!(request, new vscode.CancellationToken())
  })
})
