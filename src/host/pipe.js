/** Limited UTF-8 newline framing for the fixed helper's inherited pipes. */
import { HostError, MAX_FRAME_BYTES } from './validation.js'

/**
 * Decode complete lines without retaining an oversized chunk or accepting partial UTF-8.
 * @param stream - Public SubprocessHandle.stdout readable.
 * @param onValue - Synchronous dispatch of one JSON value.
 * @param onFailure - Idempotent operation-level failure owner.
 * @returns A disposer used only after managed process quiescence.
 */
export function readJsonLines(stream, onValue, onFailure) {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let fragments = []
  let bytes = 0
  let failed = false
  function fault(code) {
    if (failed) return
    failed = true
    fragments = []
    bytes = 0
    onFailure(new HostError(code))
  }
  function data(chunk) {
    if (failed) return
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    let start = 0
    while (start < buffer.length && !failed) {
      const end = buffer.indexOf(10, start)
      const piece = buffer.subarray(start, end === -1 ? buffer.length : end)
      if (bytes + piece.length > MAX_FRAME_BYTES) { fault('helper-protocol'); return }
      // Do not retain a whole incoming chunk through its final small fragment.
      fragments.push(Buffer.from(piece))
      bytes += piece.length
      if (end === -1) return
      try {
        const line = decoder.decode(Buffer.concat(fragments, bytes))
        fragments = []
        bytes = 0
        onValue(JSON.parse(line))
      } catch (error) {
        // Parse, validation and dispatch failures stop this helper; no payload is logged.
        fault('helper-protocol')
        return
      }
      start = end + 1
    }
  }
  const eof = () => fault('helper-eof')
  const error = () => fault('helper-io')
  stream.on('data', data)
  stream.once('end', eof)
  stream.once('close', eof)
  stream.on('error', error)
  return () => {
    failed = true
    fragments = []
    stream.off('data', data)
    stream.off('end', eof)
    stream.off('close', eof)
    stream.off('error', error)
    // Process quiescence has been observed before removing the error handlers.
  }
}

/** Owns bounded pending writes; it never treats Writable.write's boolean as completion. */
export class JsonLineWriter {
  constructor(stream, onFailure) {
    this.stream = stream
    this.onFailure = onFailure
    this.pending = new Set()
    this.bytes = 0
    this.closed = false
    this.error = () => this.fail(new HostError('helper-io'))
    this.close = () => this.fail(new HostError('helper-io'))
    stream.on('error', this.error)
    stream.on('close', this.close)
  }

  /** @returns Pipe write settlement, bounded across all in-flight complete frames. */
  send(value) {
    if (this.closed) return Promise.reject(new HostError('helper-io'))
    const line = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8')
    if (line.length > MAX_FRAME_BYTES + 1 || this.bytes + line.length > 2 * (MAX_FRAME_BYTES + 1)) {
      const error = new HostError('over-budget')
      this.fail(error)
      return Promise.reject(error)
    }
    return new Promise((resolve, reject) => {
      const entry = { reject, bytes: line.length }
      this.pending.add(entry)
      this.bytes += entry.bytes
      const finish = (error) => {
        if (!this.pending.delete(entry)) return
        this.bytes -= entry.bytes
        if (error) {
          reject(new HostError('helper-io'))
          this.fail(new HostError('helper-io'))
        } else resolve()
      }
      try { this.stream.write(line, finish) } catch (error) { finish(error) }
    })
  }

  fail(error) {
    if (this.closed) return
    this.closed = true
    for (const entry of this.pending) entry.reject(error)
    this.pending.clear()
    this.bytes = 0
    this.onFailure(error)
  }

  /** Release listeners and settle all writes after managed process quiescence. */
  dispose() {
    this.fail(new HostError('closed'))
    this.stream.off('error', this.error)
    this.stream.off('close', this.close)
  }
}
