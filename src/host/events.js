/** Acknowledged, bounded, per-client event mailbox with one held cancellable read. */
import { HostError, MAX_EVENTS_BYTES, MAX_QUEUED_EVENTS, queuedEvent } from './validation.js'

/** One mailbox belongs to one binding and never reads another binding's events. */
export class EventMailbox {
  constructor(pollMs) {
    this.pollMs = pollMs
    this.sequence = 0
    this.delivered = 0
    this.acknowledged = 0
    this.queue = []
    this.bytes = 0
    this.waiter = undefined
    this.disposed = false
  }

  /** @returns False without enqueueing when the bounded mailbox is full. */
  push(event) {
    if (this.disposed) return false
    const entry = queuedEvent(this.sequence + 1, event)
    // Reserve space for error+closed after a command overflow.
    const reserve = event.kind === 'command' ? 1024 : 0
    if (this.queue.length >= MAX_QUEUED_EVENTS - (reserve ? 2 : 0)
      || this.bytes + entry.bytes > MAX_EVENTS_BYTES - reserve) return false
    this.sequence++
    this.queue.push(entry)
    this.bytes += entry.bytes
    this.waiter?.resolve()
    return true
  }

  /**
   * Acknowledge only previously delivered events; cancellation leaves the cursor unchanged.
   * @param after - Last sequence the Client successfully received, initially zero.
   * @param signal - Cancels just this read, not the binding or its helper.
   * @returns Events after the acknowledged cursor, or an empty timed-out batch.
   */
  async read(after, signal) {
    if (this.disposed) throw new HostError('disposed')
    if (signal?.aborted) throw new HostError('cancelled')
    if (this.waiter !== undefined) throw new HostError('busy')
    if (after < this.acknowledged || after > this.delivered) throw new HostError('stale')
    this.acknowledged = after
    while (this.queue.length > 0 && this.queue[0].item.sequence <= after) this.bytes -= this.queue.shift().bytes
    if (this.queue.length === 0) await new Promise((resolve, reject) => {
      const finish = (error) => {
        if (this.waiter !== waiter) return
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        this.waiter = undefined
        if (error === undefined) resolve()
        else reject(error)
      }
      const abort = () => finish(new HostError('cancelled'))
      const timer = setTimeout(() => finish(), this.pollMs)
      const waiter = { resolve: () => finish(), reject: error => finish(error) }
      this.waiter = waiter
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
    })
    if (this.disposed) throw new HostError('disposed')
    if (signal?.aborted) throw new HostError('cancelled')
    const events = []
    let bytes = 128
    for (const entry of this.queue) {
      if (bytes + entry.bytes > MAX_EVENTS_BYTES) break
      events.push(entry.item)
      bytes += entry.bytes
    }
    const next = events.at(-1)?.sequence ?? after
    this.delivered = Math.max(this.delivered, next)
    return { events, next }
  }

  /** Abort a held read and release retained events when the binding goes away. */
  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.waiter?.reject(new HostError('disposed'))
    this.queue = []
    this.bytes = 0
  }
}
