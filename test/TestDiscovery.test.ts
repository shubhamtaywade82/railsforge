import { describe, it, expect } from 'vitest'
import { parseTestStructure, flattenTests, extractGroupName, frameworkForPath } from '../src/testing/TestDiscovery'

const RSPEC = `# frozen_string_literal: true

require 'rails_helper'

RSpec.describe User, type: :model do
  describe '#full_name' do
    it 'joins names' do
    end

    context 'when blank' do
      it "returns empty" do
      end
    end
  end

  it 'is valid' do
  end
end

describe "Other thing" do
  specify 'works' do
  end
end
`

const MINITEST = `require 'test_helper'

class UserTest < ActiveSupport::TestCase
  test "valid" do
  end

  def test_name_present
  end

  def helper_method
  end
end
`

describe('parseTestStructure (rspec)', () => {
  const tree = parseTestStructure(RSPEC, 'rspec')

  it('nests describe/context/it by indentation', () => {
    expect(tree.map(n => n.name)).toEqual(['User', 'Other thing'])
    const user = tree[0]
    expect(user.children.map(n => `${n.kind}:${n.name}`)).toEqual(['group:#full_name', 'test:is valid'])
    const fullName = user.children[0]
    expect(fullName.children.map(n => `${n.kind}:${n.name}`)).toEqual(['test:joins names', 'group:when blank'])
    expect(fullName.children[1].children[0]).toMatchObject({ name: 'returns empty', line: 10 })
  })

  it('records 0-based lines', () => {
    expect(tree[0].line).toBe(4)
    expect(tree[1].children[0]).toMatchObject({ name: 'works', line: 20 })
  })

  it('flattens leaf tests depth-first', () => {
    expect(flattenTests(tree).map(t => t.name)).toEqual(['joins names', 'returns empty', 'is valid', 'works'])
  })
})

describe('parseTestStructure (minitest)', () => {
  it('finds test "..." and def test_ methods under the class, ignoring helpers', () => {
    const tree = parseTestStructure(MINITEST, 'minitest')
    expect(tree).toHaveLength(1)
    expect(tree[0]).toMatchObject({ kind: 'group', name: 'UserTest' })
    expect(tree[0].children.map(n => n.name)).toEqual(['valid', 'test_name_present'])
  })
})

describe('helpers', () => {
  it('extracts group names from strings, constants and symbols', () => {
    expect(extractGroupName("'#create' do")).toBe('#create')
    expect(extractGroupName('Admin::User, type: :model do')).toBe('Admin::User')
    expect(extractGroupName(':widget do')).toBe('widget')
    expect(extractGroupName('do')).toBeUndefined()
  })

  it('picks the framework from the file name', () => {
    expect(frameworkForPath('spec/models/user_spec.rb')).toBe('rspec')
    expect(frameworkForPath('C:\\app\\test\\user_test.rb')).toBe('minitest')
    expect(frameworkForPath('app/models/user.rb')).toBeUndefined()
  })
})
