/**
 * Unit tests for the ConventionalCommitGenerator - the pure-function diff analyzer
 * that powers the `railsforge.generateAiCommit` command.
 */

import { describe, it, expect } from 'vitest'
import { generateConventionalCommit, parseDiffFiles } from '../src/providers/ConventionalCommitGenerator'
import { SemanticIndex } from '../src/providers/SemanticIndex'
import { PatternCatalogAccess, ProjectPatternInstance } from '../src/providers/PatternCatalogAccess'
import { ProjectPatternIndexer } from '../src/patterns/ProjectPatternIndexer'
import { PatternCatalogAccessAdapter } from '../src/providers/EngineAdapters'

/** Minimal stub - the generator only calls listProjectInstances(). */
class StubCatalog implements PatternCatalogAccess {
  private readonly instances: ProjectPatternInstance[] = []
  addInstance(i: ProjectPatternInstance): void { this.instances.push(i) }
  listCatalog(): readonly ProjectPatternInstance[] { return [] }
  getCatalogEntry(): ProjectPatternInstance | undefined { return undefined }
  listProjectInstances(): readonly ProjectPatternInstance[] { return this.instances }
  projectInstancesByType(): readonly ProjectPatternInstance[] { return this.instances }
  findSimilarInstances(): readonly ProjectPatternInstance[] { return [] }
}

// Minimal index stub - the generator doesn't call any index methods, but the type
// requires it.
const stubIndex: SemanticIndex = {
  isReady: () => true,
  listFiles: () => [],
  getFile: () => undefined,
  findDefiningFiles: () => [],
  findReferencingFiles: () => [],
  outgoingDependencies: () => [],
  incomingDependencies: () => [],
  dependsOn: () => false,
  duplicateMethods: () => [],
  violationsFor: () => [],
  async refreshFile() {},
  async forgetFile() {},
}

const SAMPLE_DIFF = `diff --git a/app/services/checkout_service.rb b/app/services/checkout_service.rb
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/app/services/checkout_service.rb
@@ -0,0 +1,10 @@
+class CheckoutService
+  def call
+    validate_cart
+    process_payment
+  end
+end
diff --git a/app/controllers/orders_controller.rb b/app/controllers/orders_controller.rb
index 1234567..abcdefg 100644
--- a/app/controllers/orders_controller.rb
+++ b/app/controllers/orders_controller.rb
@@ -5,8 +5,12 @@ class OrdersController < ApplicationController
   def create
-    @order = Order.new(order_params)
-    if @order.save
-      redirect_to @order
-    else
-      render :new
-    end
+    @order = Order.new(order_params)
+    if CheckoutService.new.call(@order)
+      redirect_to @order, notice: 'Order placed.'
+    else
+      render :new
+    end
   end
 end
`

describe('parseDiffFiles', () => {
  it('extracts file entries from a multi-file diff', () => {
    const files = parseDiffFiles(SAMPLE_DIFF)
    expect(files).toHaveLength(2)
    expect(files[0].path).toBe('app/services/checkout_service.rb')
    expect(files[0].status).toBe('added')
    expect(files[0].additions).toBe(6) // 6 `+` lines in the diff body
    expect(files[1].path).toBe('app/controllers/orders_controller.rb')
    expect(files[1].status).toBe('modified')
    expect(files[1].deletions).toBe(6)
    expect(files[1].additions).toBe(6)
  })

  it('returns empty array for empty diff', () => {
    expect(parseDiffFiles('')).toEqual([])
  })

  it('detects deleted files', () => {
    const diff = `diff --git a/app/services/old_service.rb b/app/services/old_service.rb
deleted file mode 100644
index 1234567..0000000
--- a/app/services/old_service.rb
+++ /dev/null
@@ -1,3 +0,0 @@
-class OldService
-end
`
    const files = parseDiffFiles(diff)
    expect(files).toHaveLength(1)
    expect(files[0].status).toBe('deleted')
    expect(files[0].deletions).toBe(2) // 2 `-` lines in the diff body
  })
})

describe('generateConventionalCommit', () => {
  it('generates a feat commit for a new service file', () => {
    const catalog = new StubCatalog()
    const commit = generateConventionalCommit(SAMPLE_DIFF, stubIndex, catalog)
    expect(commit).toBeDefined()
    expect(commit!.type).toBe('feat')
    expect(commit!.toString()).toMatch(/^feat\(/)
  })

  it('uses "service" as scope when a project service instance matches', () => {
    const catalog = new StubCatalog()
    catalog.addInstance({
      id: 'app/services/checkout_service::CheckoutService',
      type: 'service',
      name: 'CheckoutService',
      filePath: 'app/services/checkout_service.rb',
      lineStart: 1,
      publicMethods: ['call'],
      preview: 'class CheckoutService',
    })
    const commit = generateConventionalCommit(SAMPLE_DIFF, stubIndex, catalog)
    expect(commit!.scope).toBe('service')
  })

  it('generates "test" type for spec-only changes', () => {
    const diff = `diff --git a/spec/services/checkout_spec.rb b/spec/services/checkout_spec.rb
new file mode 100644
--- /dev/null
+++ b/spec/services/checkout_spec.rb
@@ -0,0 +1,5 @@
+RSpec.describe CheckoutService do
+  it 'works' do
+    expect(true).to be true
+  end
+end
`
    const commit = generateConventionalCommit(diff, stubIndex, new StubCatalog())
    expect(commit!.type).toBe('test')
  })

  it('generates "feat" type for migration files', () => {
    const diff = `diff --git a/db/migrate/20260101000001_create_orders.rb b/db/migrate/20260101000001_create_orders.rb
new file mode 100644
--- /dev/null
+++ b/db/migrate/20260101000001_create_orders.rb
@@ -0,0 +1,8 @@
+class CreateOrders < ActiveRecord::Migration[7.1]
+  def change
+    create_table :orders do |t|
+      t.timestamps
+    end
+  end
+end
`
    const commit = generateConventionalCommit(diff, stubIndex, new StubCatalog())
    expect(commit!.type).toBe('feat')
    expect(commit!.scope).toBe('migration')
  })

  it('returns undefined for empty diff', () => {
    const commit = generateConventionalCommit('', stubIndex, new StubCatalog())
    expect(commit).toBeUndefined()
  })

  it('uses PatternCatalogAccessAdapter against real ProjectPatternIndexer', () => {
    const indexer = new ProjectPatternIndexer()
    indexer.indexFileAs('/fake/app/services/checkout_service.rb', 'class CheckoutService\n  def call; end\nend\n', 'service')
    const adapter = new PatternCatalogAccessAdapter(indexer)
    const commit = generateConventionalCommit(SAMPLE_DIFF, stubIndex, adapter)
    expect(commit!.scope).toBe('service')
  })
})
