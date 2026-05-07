export interface InFlightTracker {
  enter(requestId: string): void
  exit(requestId: string): void
  drain(deadlineMs: number): Promise<{ drained: number; timed_out: number }>
  size(): number
}

export function createInFlightTracker(): InFlightTracker {
  const active = new Map<string, number>() // requestId -> enteredAt timestamp
  let resolveDrained: (() => void) | null = null

  return {
    enter(id) {
      active.set(id, Date.now())
    },
    exit(id) {
      active.delete(id)
      if (active.size === 0 && resolveDrained) {
        resolveDrained()
        resolveDrained = null
      }
    },
    drain(deadlineMs) {
      const startedWith = active.size
      if (startedWith === 0) return Promise.resolve({ drained: 0, timed_out: 0 })
      return new Promise(resolve => {
        const timer = setTimeout(() => {
          const drainedCount = startedWith - active.size
          resolveDrained = null
          resolve({ drained: drainedCount, timed_out: active.size })
        }, deadlineMs)
        resolveDrained = () => {
          clearTimeout(timer)
          resolve({ drained: startedWith, timed_out: 0 })
        }
      })
    },
    size() {
      return active.size
    },
  }
}
