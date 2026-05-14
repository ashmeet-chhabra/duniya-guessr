import { useEffect } from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let currentSocket = null

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => currentSocket),
}))

const TEST_PROFILE = { id: 'profile-1', username: 'HostUser' }
const TEST_LOCATION = { lat: 48.8584, lng: 2.2945, country: 'France', countryCode: 'FRA' }

class FakeSocket {
  constructor() {
    this.handlers = new Map()
    this.id = 'socket-1'
    this.connected = false
    this.emits = []
    this.ackQueues = new Map()
  }

  on(event, handler) {
    const handlers = this.handlers.get(event) ?? new Set()
    handlers.add(handler)
    this.handlers.set(event, handlers)
  }

  off(event, handler) {
    const handlers = this.handlers.get(event)
    if (!handlers) return
    handlers.delete(handler)
    if (handlers.size === 0) this.handlers.delete(event)
  }

  emit(event, ...args) {
    this.emits.push({ event, args })
    const ack = typeof args.at(-1) === 'function' ? args.at(-1) : null
    const queue = this.ackQueues.get(event)
    if (!ack || !queue || queue.length === 0) return
    const response = queue.shift()
    queueMicrotask(() => ack(response))
  }

  connect() {
    this.connected = true
    queueMicrotask(() => this.emitEvent('connect'))
  }

  disconnect() {
    this.connected = false
    this.emitEvent('disconnect')
  }

  close() {
    this.disconnect()
  }

  emitEvent(event, ...args) {
    const handlers = this.handlers.get(event)
    if (!handlers) return
    for (const handler of [...handlers]) {
      handler(...args)
    }
  }

  queueAck(event, response) {
    const queue = this.ackQueues.get(event) ?? []
    queue.push(response)
    this.ackQueues.set(event, queue)
  }
}

function responseOk(data) {
  return {
    ok: true,
    async text() {
      return JSON.stringify(data)
    },
  }
}

function HookProbe({ onChange, useSocketGame }) {
  const value = useSocketGame()

  useEffect(() => {
    onChange(value)
  }, [onChange, value])

  return null
}

async function renderHookProbe() {
  currentSocket = new FakeSocket()
  vi.resetModules()

  const { default: useSocketGame } = await import('../hooks/useSocketGame.js')
  let latest = null

  render(<HookProbe useSocketGame={useSocketGame} onChange={(value) => { latest = value }} />)

  await waitFor(() => {
    expect(latest).not.toBeNull()
  })

  return {
    get latest() {
      return latest
    },
    socket: currentSocket,
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  global.fetch = vi.fn(async () => responseOk(TEST_PROFILE))
})

describe('useSocketGame integration', () => {
  it('reconnects an online player with room and profile context intact', async () => {
    const harness = await renderHookProbe()
    harness.socket.queueAck('create_room', { roomCode: 'ABCD', gameId: 'game-1' })

    await act(async () => {
      await harness.latest.handleConnect({ type: 'create', username: 'HostUser' })
    })

    await waitFor(() => {
      expect(harness.latest.connected).toBe(true)
      expect(harness.latest.roomCode).toBe('ABCD')
      expect(harness.latest.profile?.id).toBe(TEST_PROFILE.id)
    })

    harness.socket.id = 'socket-2'
    harness.socket.queueAck('reconnect_room', {
      success: true,
      room: { roomCode: 'ABCD', status: 'waiting', players: [], totalRounds: 2, timeLimit: 30 },
    })

    act(() => {
      harness.socket.emitEvent('connect')
    })

    await waitFor(() => {
      expect(harness.socket.emits.some(({ event, args }) =>
        event === 'reconnect_room' &&
        args[0].roomCode === 'ABCD' &&
        args[0].profileId === TEST_PROFILE.id,
      )).toBe(true)
      expect(harness.latest.room?.roomCode).toBe('ABCD')
    })
  })

  it('resets active game state when the server sends the room back to waiting', async () => {
    const harness = await renderHookProbe()
    harness.socket.queueAck('create_room', { roomCode: 'ABCD', gameId: 'game-1' })

    await act(async () => {
      await harness.latest.handleConnect({ type: 'create', username: 'HostUser' })
    })

    act(() => {
      harness.socket.emitEvent('game_started', { round: 1, totalRounds: 2, local: false })
      harness.socket.emitEvent('your_turn', { round: 1, location: TEST_LOCATION, player: 'HostUser', turnTimeLimit: 10 })
    })

    await waitFor(() => {
      expect(harness.latest.gameState?.round).toBe(1)
      expect(harness.latest.currentLocation?.countryCode).toBe(TEST_LOCATION.countryCode)
      expect(harness.latest.waitingForTurn).toBe(false)
    })

    act(() => {
      harness.socket.emitEvent('room_update', {
        roomCode: 'ABCD',
        status: 'waiting',
        players: [],
        totalRounds: 2,
        timeLimit: 30,
      })
    })

    await waitFor(() => {
      expect(harness.latest.gameState).toBeNull()
      expect(harness.latest.currentLocation).toBeNull()
      expect(harness.latest.waitingForTurn).toBe(true)
      expect(harness.latest.gameOver).toBeNull()
    })
  })

  it('surfaces start_game ack errors and clears the submitting state', async () => {
    const harness = await renderHookProbe()
    harness.socket.queueAck('create_room', { roomCode: 'ABCD', gameId: 'game-1' })

    await act(async () => {
      await harness.latest.handleConnect({ type: 'create', username: 'HostUser' })
    })

    harness.socket.queueAck('start_game', { error: 'Two connected players are required' })

    act(() => {
      harness.latest.handleStartGame()
    })

    await waitFor(() => {
      expect(harness.latest.error).toBe('Two connected players are required')
      expect(harness.latest.isSubmitting).toBe(false)
    })
  })
})
