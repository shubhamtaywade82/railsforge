import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as vscode from '../test/__mocks__/vscode'
import { RefactoringMenuProvider } from '../src/refactor/RefactoringMenuProvider'

vi.mock('vscode', () => vi.importActual('../test/__mocks__/vscode'))
vi.mock('../src/config/EffectiveGuidelines', () => ({
  loadEffectiveServiceObjectGuidelines: vi.fn().mockReturnValue({}),
}))

const makeEditor = (text: string, startLine = 0, endLine = 0) => ({
  selection: new vscode.Selection(startLine, 0, endLine, text.split('\n')[endLine]?.length ?? 0),
  document: new vscode.TextDocument('test.rb', 'ruby', text),
} as unknown)

describe('RefactoringMenuProvider', () => {
  const serviceExtractor = {
    detectFreeVariables: vi.fn().mockReturnValue([]),
    extractService: vi.fn().mockReturnValue({
      serviceFilePath: '/test/workspace/app/services/process_payment_service.rb',
      serviceCode: 'class ProcessPaymentService',
    }),
    saveServiceFile: vi.fn(),
  }
  const queryExtractor = {
    extractQuery: vi.fn().mockReturnValue({
      queryFilePath: '/test/workspace/app/queries/active_users_query.rb',
      queryCode: 'class ActiveUsersQuery',
      replacementCall: 'ActiveUsersQuery.call',
    }),
  }
  const formExtractor = {
    extractFormObject: vi.fn().mockReturnValue({
      filePath: '/test/workspace/app/forms/user_registration_form.rb',
      formCode: 'class UserRegistrationForm',
    }),
  }
  const valueExtractor = {
    extractValueObject: vi.fn().mockReturnValue({
      filePath: '/test/workspace/app/values/money.rb',
      valueCode: 'class Money',
    }),
  }
  const patternIndexer = {}

  let provider: RefactoringMenuProvider

  beforeEach(() => {
    vi.clearAllMocks()
    vscode.window.activeTextEditor = undefined as unknown
    vscode.workspace.workspaceFolders = [{ uri: { fsPath: '/test/workspace' } } as unknown]
    provider = new RefactoringMenuProvider(
      serviceExtractor as any,
      queryExtractor as any,
      formExtractor as any,
      valueExtractor as any,
      patternIndexer as any,
    )
  })

  it('should show warning when no active editor', async () => {
    vi.spyOn(vscode.window, 'showWarningMessage')
    await provider.promptRefactoring()
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('No active editor open.')
  })

  it('should show error when no workspace folder', async () => {
    vscode.workspace.workspaceFolders = []
    vscode.window.activeTextEditor = makeEditor('hello')
    vi.spyOn(vscode.window, 'showErrorMessage')
    await provider.promptRefactoring()
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('No workspace folder open.')
    vscode.workspace.workspaceFolders = [{ uri: { fsPath: '/test/workspace' } } as unknown]
  })

  it('should do nothing when user cancels quick pick', async () => {
    vscode.window.activeTextEditor = makeEditor('hello')
    vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue(undefined as any)
    await provider.promptRefactoring()
    expect(serviceExtractor.extractService).not.toHaveBeenCalled()
  })

  it('should handle AI refactoring choice', async () => {
    vscode.window.activeTextEditor = makeEditor('hello')
    vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue({ label: '$(sparkle) Refactor with @rails AI' } as any)
    vi.spyOn(vscode.commands, 'executeCommand')
    await provider.promptRefactoring()
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.chat.open', expect.any(Object))
  })

  it('should handle Service Object extraction', async () => {
    vscode.window.activeTextEditor = makeEditor('some code here')
    vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue({ label: '$(symbol-method) Extract to Service Object' } as any)
    vi.spyOn(vscode.window, 'showInputBox').mockResolvedValueOnce('ProcessPayment')
    vi.spyOn(vscode.window, 'showInformationMessage')
    vi.spyOn(vscode.workspace, 'openTextDocument').mockResolvedValue({} as any)
    vi.spyOn(vscode.window, 'showTextDocument').mockResolvedValue(undefined as any)

    await provider.promptRefactoring()

    expect(serviceExtractor.detectFreeVariables).toHaveBeenCalledWith('some code here')
    expect(serviceExtractor.extractService).toHaveBeenCalled()
    expect(serviceExtractor.saveServiceFile).toHaveBeenCalled()
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'Extracted Service Object: /test/workspace/app/services/process_payment_service.rb',
    )
  })

  it('should cancel Service Object extraction when no name given', async () => {
    vscode.window.activeTextEditor = makeEditor('code')
    vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue({ label: '$(symbol-method) Extract to Service Object' } as any)
    vi.spyOn(vscode.window, 'showInputBox').mockResolvedValueOnce(undefined as any)

    await provider.promptRefactoring()
    expect(serviceExtractor.extractService).not.toHaveBeenCalled()
  })

  it('should handle Query Object extraction', async () => {
    vscode.window.activeTextEditor = makeEditor('User.where(active: true)')
    vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue({ label: '$(search) Extract to Query Object' } as any)
    vi.spyOn(vscode.window, 'showInputBox').mockResolvedValueOnce('ActiveUsers')
    vi.spyOn(vscode.window, 'showInformationMessage')
    vi.spyOn(vscode.workspace, 'openTextDocument').mockResolvedValue({} as any)
    vi.spyOn(vscode.window, 'showTextDocument').mockResolvedValue(undefined as any)

    await provider.promptRefactoring()

    expect(queryExtractor.extractQuery).toHaveBeenCalledWith(
      'ActiveUsers', 'ApplicationRecord', 'User.where(active: true)', [], '/test/workspace',
    )
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'Extracted Query Object: /test/workspace/app/queries/active_users_query.rb',
    )
  })

  it('should cancel Query Object extraction when no name given', async () => {
    vscode.window.activeTextEditor = makeEditor('code')
    vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue({ label: '$(search) Extract to Query Object' } as any)
    vi.spyOn(vscode.window, 'showInputBox').mockResolvedValueOnce(undefined as any)

    await provider.promptRefactoring()
    expect(queryExtractor.extractQuery).not.toHaveBeenCalled()
  })

  it('should handle Form Object extraction', async () => {
    vscode.window.activeTextEditor = makeEditor('some code')
    vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue({ label: '$(note) Extract to Form Object' } as any)
    vi.spyOn(vscode.window, 'showInputBox')
      .mockResolvedValueOnce('UserRegistration')
      .mockResolvedValueOnce('email, password, terms')
    vi.spyOn(vscode.window, 'showInformationMessage')
    vi.spyOn(vscode.workspace, 'openTextDocument').mockResolvedValue({} as any)
    vi.spyOn(vscode.window, 'showTextDocument').mockResolvedValue(undefined as any)

    await provider.promptRefactoring()

    expect(formExtractor.extractFormObject).toHaveBeenCalledWith(
      'UserRegistration', ['email', 'password', 'terms'], '/test/workspace',
    )
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'Extracted Form Object: /test/workspace/app/forms/user_registration_form.rb',
    )
  })

  it('should handle Form Object extraction with no attributes', async () => {
    vscode.window.activeTextEditor = makeEditor('code')
    vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue({ label: '$(note) Extract to Form Object' } as any)
    vi.spyOn(vscode.window, 'showInputBox')
      .mockResolvedValueOnce('SimpleForm')
      .mockResolvedValueOnce(undefined as any)
    vi.spyOn(vscode.window, 'showInformationMessage')
    vi.spyOn(vscode.workspace, 'openTextDocument').mockResolvedValue({} as any)
    vi.spyOn(vscode.window, 'showTextDocument').mockResolvedValue(undefined as any)

    await provider.promptRefactoring()

    expect(formExtractor.extractFormObject).toHaveBeenCalledWith(
      'SimpleForm', [], '/test/workspace',
    )
  })

  it('should handle Value Object extraction', async () => {
    vscode.window.activeTextEditor = makeEditor('some code')
    vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue({ label: '$(symbol-constant) Extract to Value Object' } as any)
    vi.spyOn(vscode.window, 'showInputBox')
      .mockResolvedValueOnce('Money')
      .mockResolvedValueOnce('amount, currency')
    vi.spyOn(vscode.window, 'showInformationMessage')
    vi.spyOn(vscode.workspace, 'openTextDocument').mockResolvedValue({} as any)
    vi.spyOn(vscode.window, 'showTextDocument').mockResolvedValue(undefined as any)

    await provider.promptRefactoring()

    expect(valueExtractor.extractValueObject).toHaveBeenCalledWith(
      'Money', ['amount', 'currency'], '/test/workspace',
    )
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'Extracted Value Object: /test/workspace/app/values/money.rb',
    )
  })

  it('should cancel Value Object extraction when no name given', async () => {
    vscode.window.activeTextEditor = makeEditor('code')
    vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue({ label: '$(symbol-constant) Extract to Value Object' } as any)
    vi.spyOn(vscode.window, 'showInputBox').mockResolvedValueOnce(undefined as any)

    await provider.promptRefactoring()
    expect(valueExtractor.extractValueObject).not.toHaveBeenCalled()
  })
})
