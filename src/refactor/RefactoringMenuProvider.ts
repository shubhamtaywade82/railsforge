/**
 * RefactoringMenuProvider - Interactive menu of Refactoring Guru & Rails design pattern extractions
 */

import * as vscode from 'vscode'
import { activeWorkspaceRoot } from '../workspace/activeRoot'
import { ServiceExtractor } from './ServiceExtractor'
import { QueryExtractor } from './QueryExtractor'
import { FormObjectExtractor } from './FormObjectExtractor'
import { ValueObjectExtractor } from './ValueObjectExtractor'
import { ProjectPatternIndexer } from '../patterns/ProjectPatternIndexer'
import { loadEffectiveServiceObjectGuidelines } from '../config/EffectiveGuidelines'

export class RefactoringMenuProvider {
  constructor(
    private serviceExtractor: ServiceExtractor,
    private queryExtractor: QueryExtractor,
    private formExtractor: FormObjectExtractor,
    private valueExtractor: ValueObjectExtractor,
    private projectPatternIndexer: ProjectPatternIndexer,
  ) {}

  async promptRefactoring(): Promise<void> {
    const editor = vscode.window.activeTextEditor
    if (!editor) {
      vscode.window.showWarningMessage('No active editor open.')
      return
    }

    const selection = editor.selection
    const selectedText = editor.document.getText(selection)
    const root = activeWorkspaceRoot()

    if (!root) {
      vscode.window.showErrorMessage('No workspace folder open.')
      return
    }

    const items: vscode.QuickPickItem[] = [
      {
        label: '$(symbol-method) Extract to Service Object',
        description: 'app/services/[name]_service.rb',
        detail: 'Encapsulates complex business logic into a single-responsibility callable object.',
      },
      {
        label: '$(search) Extract to Query Object',
        description: 'app/queries/[name]_query.rb',
        detail: 'Isolates complex ActiveRecord queries and scope chains into a testable class.',
      },
      {
        label: '$(note) Extract to Form Object',
        description: 'app/forms/[name]_form.rb',
        detail: 'Handles multi-model validations and nested parameter processing with ActiveModel::Model.',
      },
      {
        label: '$(symbol-constant) Extract to Value Object',
        description: 'app/values/[name].rb',
        detail: 'Eliminates Primitive Obsession by encapsulating domain primitives via Data.define.',
      },
      {
        label: '$(sparkle) Refactor with @rails AI',
        description: 'Refactoring Guru heuristics',
        detail: 'Sends selected block to local Ollama agent to apply idiomatic SOLID design patterns.',
      },
    ]

    const choice = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select Refactoring / Design Pattern to apply',
    })

    if (!choice) {return}

    if (choice.label.includes('Service Object')) {
      await this.handleServiceExtraction(selectedText, root)
    } else if (choice.label.includes('Query Object')) {
      await this.handleQueryExtraction(selectedText, root)
    } else if (choice.label.includes('Form Object')) {
      await this.handleFormExtraction(root)
    } else if (choice.label.includes('Value Object')) {
      await this.handleValueExtraction(root)
    } else if (choice.label.includes('@rails AI')) {
      await vscode.commands.executeCommand('workbench.action.chat.open', {
        query: '@rails /refactor Apply idiomatic Rails design pattern to this code',
      })
    }
  }

  private async handleServiceExtraction(selectedText: string, root: string): Promise<void> {
    const name = await vscode.window.showInputBox({ prompt: 'Enter Service Name (e.g. ProcessPayment)' })
    if (!name) {return}

    const freeVars = this.serviceExtractor.detectFreeVariables(selectedText)
    const guidelines = loadEffectiveServiceObjectGuidelines(root, this.projectPatternIndexer)
    const result = this.serviceExtractor.extractService(name, selectedText, freeVars, root, guidelines)
    this.serviceExtractor.saveServiceFile(result.serviceFilePath, result.serviceCode)
    const doc = await vscode.workspace.openTextDocument(result.serviceFilePath)
    await vscode.window.showTextDocument(doc)
    vscode.window.showInformationMessage(`Extracted Service Object: ${result.serviceFilePath}`)
  }

  private async handleQueryExtraction(selectedText: string, root: string): Promise<void> {
    const name = await vscode.window.showInputBox({ prompt: 'Enter Query Name (e.g. ActiveUsers)' })
    if (!name) {return}

    const result = this.queryExtractor.extractQuery(name, 'ApplicationRecord', selectedText, [], root)
    const doc = await vscode.workspace.openTextDocument(result.queryFilePath)
    await vscode.window.showTextDocument(doc)
    vscode.window.showInformationMessage(`Extracted Query Object: ${result.queryFilePath}`)
  }

  private async handleFormExtraction(root: string): Promise<void> {
    const name = await vscode.window.showInputBox({ prompt: 'Enter Form Name (e.g. UserRegistration)' })
    if (!name) {return}

    const attrs = await vscode.window.showInputBox({ prompt: 'Enter attributes separated by comma (e.g. email, password, terms)' })
    const attrList = (attrs ?? '').split(',').map(a => a.trim()).filter(Boolean)

    const result = this.formExtractor.extractFormObject(name, attrList, root)
    const doc = await vscode.workspace.openTextDocument(result.filePath)
    await vscode.window.showTextDocument(doc)
    vscode.window.showInformationMessage(`Extracted Form Object: ${result.filePath}`)
  }

  private async handleValueExtraction(root: string): Promise<void> {
    const name = await vscode.window.showInputBox({ prompt: 'Enter Value Object Name (e.g. Money)' })
    if (!name) {return}

    const attrs = await vscode.window.showInputBox({ prompt: 'Enter attributes separated by comma (e.g. amount, currency)' })
    const attrList = (attrs ?? '').split(',').map(a => a.trim()).filter(Boolean)

    const result = this.valueExtractor.extractValueObject(name, attrList, root)
    const doc = await vscode.workspace.openTextDocument(result.filePath)
    await vscode.window.showTextDocument(doc)
    vscode.window.showInformationMessage(`Extracted Value Object: ${result.filePath}`)
  }
}
