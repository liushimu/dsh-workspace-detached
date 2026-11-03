// DOM simulation checks, not real Native/clipboard/DnD acceptance.
import test from 'node:test'
import assert from 'node:assert/strict'
import { rendererFixture } from './renderer-fixture.mjs'
import { model } from '../host/fixtures.mjs'

test('fixed renderer consumes a v3 display model and returns through the finite bridge', async () => {
  const value = model(), f = await rendererFixture(value)
  try {
    assert.equal(f.document.documentElement.lang, 'zh-CN')
    assert.equal(f.document.querySelector('#navigator').hidden, false)
    assert.equal(f.document.querySelector('#title').textContent, value.title)
    assert.equal(f.document.querySelectorAll('.workspace-card').length, 1)
    assert.equal(f.document.querySelectorAll('[role="treeitem"]').length, 2)
    assert.equal(f.rendered.at(-1).revision, value.revision)
    f.document.querySelector('#return').click()
    await f.settle()
    assert.equal(f.commands.at(-1).type, 'return')
    assert.equal(f.commands.at(-1).instance, value.instance)
  } finally { f.close() }
})

test('labels stay text-only and background model updates do not require another backend', async () => {
  const value = model()
  const hostile = '<img src=x onerror="throw 1">'
  value.workspaces[0].label = hostile
  const f = await rendererFixture(value)
  try {
    assert.equal(f.document.querySelector('.workspace-heading .label').textContent, hostile)
    assert.equal(f.document.querySelector('img'), null)
    const next = structuredClone(value); next.revision++
    next.workspaces[0].rows[1].label = '更新后的会话'
    await f.publish(next)
    assert.equal(f.document.querySelector('[data-row-id="session-a"] .label').textContent, '更新后的会话')
    assert.equal(f.commands.some(command => ['start', 'fork', 'exec'].includes(command.type)), false)
  } finally { f.close() }
})
