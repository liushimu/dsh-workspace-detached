import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'
import { readJsonLines, JsonLineWriter } from '../../src/host/pipe.js'
import { boundedJson, MAX_FRAME_BYTES, MAX_QUEUED_EVENTS, MAX_EVENTS_BYTES } from '../../src/host/validation.js'
import { EventMailbox } from '../../src/host/events.js'
import { command, deadline } from './fixtures.mjs'

test('newline decoder preserves split UTF-8 and multiple frames without mixing stderr', () => {
  const stream = new PassThrough()
  const values = [], errors = []
  const remove = readJsonLines(stream, value => values.push(value), error => errors.push(error.code))
  const bytes = Buffer.from('{"text":"消息"}\n{"op":"started"}\n')
  for (let position = 0; position < bytes.length; position++) stream.write(bytes.subarray(position, position + 1))
  assert.deepEqual(values, [{ text: '消息' }, { op: 'started' }])
  assert.deepEqual(errors, [])
  remove()
  assert.equal(stream.listenerCount('data'), 0)
  assert.equal(stream.listenerCount('error'), 0)
})

test('bad JSON, invalid UTF-8, empty lines, oversized frames and partial EOF fault once', async t => {
  const cases = [Buffer.from('{bad}\n'), Buffer.from([0x22, 0xc3, 0x28, 0x22, 0x0a]), Buffer.from('\n'),
    Buffer.alloc(MAX_FRAME_BYTES + 1, 0x20), Buffer.from('{"unfinished":')]
  for (let index = 0; index < cases.length; index++) await t.test(String(index), async () => {
    const stream = new PassThrough()
    const errors = [], values = []
    const remove = readJsonLines(stream, value => values.push(value), error => errors.push(error.code))
    stream.write(cases[index])
    stream.end()
    await deadline(new Promise(resolve => stream.once('end', resolve)))
    assert.equal(errors.length, 1)
    assert.equal(values.length, 0)
    remove()
  })
})

test('writer uses write callback settlement and bounds all in-flight bytes including JSON wrappers', async () => {
  const callbacks = [], failures = []
  const stream = new Writable({ highWaterMark: 1, write(_chunk, _encoding, callback) { callbacks.push(callback) } })
  const writer = new JsonLineWriter(stream, error => failures.push(error.code))
  const pending = writer.send({ op: 'focus' })
  let complete = false
  void pending.then(() => { complete = true })
  await Promise.resolve()
  assert.equal(complete, false)
  callbacks.shift()()
  await pending
  assert.equal(complete, true)
  const huge = writer.send({ text: 'x'.repeat(MAX_FRAME_BYTES + 1) })
  await assert.rejects(huge, error => error.code === 'over-budget')
  assert.deepEqual(failures, ['over-budget'])
  writer.dispose()
  assert.equal(stream.listenerCount('error'), 0)
})

test('writer contains errors and settles every pending write before listener cleanup', async () => {
  const stream = new Writable({ write() {} })
  const failures = []
  const writer = new JsonLineWriter(stream, error => failures.push(error.code))
  const first = writer.send({ op: 'focus' })
  const second = writer.send({ op: 'close' })
  stream.emit('error', new Error('private error must not cross RPC'))
  await assert.rejects(first, error => error.code === 'helper-io')
  await assert.rejects(second, error => error.code === 'helper-io')
  assert.deepEqual(failures, ['helper-io'])
  assert.equal(writer.bytes, 0)
  writer.dispose()
})

test('complete JSON budget rejects non-JSON and accessors before they can execute', () => {
  const exact = { value: '界' }
  const length = Buffer.byteLength(JSON.stringify(exact), 'utf8')
  assert.deepEqual(boundedJson(exact, length), exact)
  assert.throws(() => boundedJson(exact, length - 1), error => error.code === 'over-budget')
  const cycle = {}; cycle.self = cycle
  const sparse = new Array(2); sparse[1] = 'x'
  const getter = { get value() { throw new Error('getter must not run') } }
  const symbol = { [Symbol('private')]: 'x' }
  const hidden = Object.defineProperty({}, 'private', { value: 1 })
  for (const invalid of [cycle, sparse, getter, symbol, hidden, { value: undefined }, { value: NaN }, { value: BigInt(1) },
    new Date(), Object.assign([], { extra: 1 }), () => {}]) {
    assert.throws(() => boundedJson(invalid), error => error.code === 'invalid')
  }
  let deep = {}
  for (let index = 0; index < 40; index++) deep = { child: deep }
  assert.throws(() => boundedJson(deep), error => error.code === 'over-budget')
})

test('mailbox reads wait without a polling loop and time out with the existing cursor', async () => {
  const mailbox = new EventMailbox(10)
  const pending = mailbox.read(0, new AbortController().signal)
  assert.notEqual(mailbox.waiter, undefined)
  assert.deepEqual(await deadline(pending), { events: [], next: 0 })
  assert.equal(mailbox.waiter, undefined)
  mailbox.dispose()
})

test('mailbox applies complete item/count budgets, keeps sequence monotonic and reserves terminal notifications', async () => {
  const mailbox = new EventMailbox(1000)
  for (let index = 0; index < MAX_QUEUED_EVENTS - 2; index++) {
    assert.equal(mailbox.push({ kind: 'command', command: command({ commandId: String(index) }) }), true)
  }
  assert.equal(mailbox.push({ kind: 'command', command: command({ commandId: 'overflow' }) }), false)
  assert.equal(mailbox.push({ kind: 'state', state: 'error' }), true)
  assert.equal(mailbox.push({ kind: 'state', state: 'closed' }), true)
  const batch = await mailbox.read(0)
  assert.equal(batch.events.length, MAX_QUEUED_EVENTS)
  assert.equal(batch.next, MAX_QUEUED_EVENTS)
  assert.ok(Buffer.byteLength(JSON.stringify(batch), 'utf8') <= MAX_EVENTS_BYTES)
  assert.equal(batch.events.at(-1).event.state, 'closed')
  mailbox.dispose()
})
