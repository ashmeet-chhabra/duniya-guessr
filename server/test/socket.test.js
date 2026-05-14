import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import clientModule from '../../client/node_modules/socket.io-client/build/cjs/index.js'
import { startServer } from '../index.js'
import { all } from '../db.js'

const { io: createClient } = clientModule

const TEST_LOCATION = {
  lat: 48.8584,
  lng: 2.2945,
  name: 'Eiffel Tower, Paris',
  country: 'France',
  countryCode: 'FRA',
}

const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop()
    await cleanup()
  }
})

function onceEvent(target, event, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${event}`))
    }, timeoutMs)

    target.once(event, (...args) => {
      clearTimeout(timer)
      resolve(args.length <= 1 ? args[0] : args)
    })
  })
}

function waitForEvent(target, event, predicate, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      target.off(event, handler)
      reject(new Error(`Timed out waiting for ${event}`))
    }, timeoutMs)

    const handler = (...args) => {
      const payload = args.length <= 1 ? args[0] : args
      if (!predicate(payload)) return
      clearTimeout(timer)
      target.off(event, handler)
      resolve(payload)
    }

    target.on(event, handler)
  })
}

function emitAck(socket, event, payload, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for ack from ${event}`))
    }, timeoutMs)

    socket.emit(event, payload, (response) => {
      clearTimeout(timer)
      resolve(response)
    })
  })
}

async function createHarness() {
  const serverHandle = await startServer({
    port: 0,
    host: '127.0.0.1',
    enableCacheWarmup: false,
    cacheRefillIntervalMs: 0,
    randomLocationFn: async () => TEST_LOCATION,
    revealDelayMs: 20,
    turnTimeoutBufferMs: 0,
  })
  cleanups.push(() => serverHandle.close())

  const sockets = []
  cleanups.push(async () => {
    for (const socket of sockets) {
      if (socket.connected) socket.disconnect()
      else socket.close()
    }
  })

  function makeSocket() {
    const socket = createClient(`http://127.0.0.1:${serverHandle.port}`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    })
    sockets.push(socket)
    return socket
  }

  return { serverHandle, makeSocket }
}

async function connectSocket(makeSocket) {
  const socket = makeSocket()
  await onceEvent(socket, 'connect', 1500)
  return socket
}

async function setupOnlineRoom(makeSocket) {
  const host = await connectSocket(makeSocket)
  const guest = await connectSocket(makeSocket)

  const hostProfileId = randomUUID()
  const guestProfileId = randomUUID()
  const createRes = await emitAck(host, 'create_room', {
    profileId: hostProfileId,
    username: 'HostUser',
    rounds: 1,
    timeLimit: 10,
  })
  assert.ok(createRes.roomCode)

  const joinRes = await emitAck(guest, 'join_room', {
    roomCode: createRes.roomCode,
    profileId: guestProfileId,
    username: 'GuestUser',
  })
  assert.equal(joinRes.success, true)

  return {
    host,
    guest,
    roomCode: createRes.roomCode,
    gameId: createRes.gameId,
    hostProfileId,
    guestProfileId,
  }
}

describe('Socket multiplayer hardening', () => {
  it('reconnects a player and restores their round result after a disconnect forfeit', async () => {
    const { makeSocket } = await createHarness()
    const { host, guest, roomCode, guestProfileId } = await setupOnlineRoom(makeSocket)

    const hostTurn = onceEvent(host, 'your_turn', 1500)
    const guestTurn = onceEvent(guest, 'your_turn', 1500)
    const startRes = await emitAck(host, 'start_game', { roomCode }, 1500)
    assert.equal(startRes.success, true)
    await Promise.all([hostTurn, guestTurn])

    const roomUpdateAfterDisconnect = waitForEvent(host, 'room_update', (room) =>
      room.roomCode === roomCode && room.players.some((player) => player.profileId === guestProfileId && player.disconnected === true),
    1500)
    guest.disconnect()
    await roomUpdateAfterDisconnect

    const hostRoundResult = onceEvent(host, 'round_result', 500)
    host.emit('make_guess', { roomCode, guessLat: TEST_LOCATION.lat, guessLng: TEST_LOCATION.lng })
    await hostRoundResult

    const guestReconnected = await connectSocket(makeSocket)
    const reconnectRoundResult = onceEvent(guestReconnected, 'round_result', 1500)
    const reconnectRes = await emitAck(guestReconnected, 'reconnect_room', { roomCode, profileId: guestProfileId }, 1500)
    assert.equal(reconnectRes.success, true)
    const result = await reconnectRoundResult
    assert.equal(result.timedOut, true)
    assert.equal(result.actual.countryCode, TEST_LOCATION.countryCode)
  })

  it('reconnects a player during reveal with opponent guesses included', async () => {
    const { makeSocket } = await createHarness()
    const { host, guest, roomCode, guestProfileId } = await setupOnlineRoom(makeSocket)

    const hostTurn = onceEvent(host, 'your_turn', 1500)
    const guestTurn = onceEvent(guest, 'your_turn', 1500)
    const startRes = await emitAck(host, 'start_game', { roomCode }, 1500)
    assert.equal(startRes.success, true)
    await Promise.all([hostTurn, guestTurn])

    const hostRoundResult = onceEvent(host, 'round_result', 500)
    const guestRoundResult = onceEvent(guest, 'round_result', 500)

    guest.emit('make_guess', { roomCode, guessLat: 40.7128, guessLng: -74.0060 })
    host.emit('make_guess', { roomCode, guessLat: TEST_LOCATION.lat, guessLng: TEST_LOCATION.lng })

    await Promise.all([hostRoundResult, guestRoundResult])

    guest.disconnect()

    const guestReconnected = await connectSocket(makeSocket)
    const reconnectRoundResult = onceEvent(guestReconnected, 'round_result', 1500)
    const reconnectRes = await emitAck(guestReconnected, 'reconnect_room', { roomCode, profileId: guestProfileId }, 1500)
    assert.equal(reconnectRes.success, true)

    const result = await reconnectRoundResult
    assert.equal(result.actual.countryCode, TEST_LOCATION.countryCode)
    assert.equal(Array.isArray(result.opponentGuesses), true)
    assert.equal(result.opponentGuesses.length, 1)
    assert.equal(result.opponentGuesses[0].username, 'HostUser')
    assert.deepEqual(result.opponentGuesses[0].guess, { lat: TEST_LOCATION.lat, lng: TEST_LOCATION.lng })
  })

  it('rejects a late guess after timeout and keeps the timed out player at zero', async () => {
    const { makeSocket } = await createHarness()
    const { host, guest, roomCode, gameId, hostProfileId, guestProfileId } = await setupOnlineRoom(makeSocket)

    const hostTurn = onceEvent(host, 'your_turn', 1500)
    const guestTurn = onceEvent(guest, 'your_turn', 1500)
    const startRes = await emitAck(host, 'start_game', { roomCode }, 1500)
    assert.equal(startRes.success, true)
    await Promise.all([hostTurn, guestTurn])

    const hostRoundResult = onceEvent(host, 'round_result', 500)
    const guestRoundResult = onceEvent(guest, 'round_result', 500)
    const gameOverPromise = onceEvent(host, 'game_over', 1000)

    guest.emit('timeout_guess', { roomCode })
    host.emit('make_guess', { roomCode, guessLat: TEST_LOCATION.lat, guessLng: TEST_LOCATION.lng })

    const [hostResult, guestResult] = await Promise.all([hostRoundResult, guestRoundResult])
    assert.equal(hostResult.score, 5000)
    assert.equal(guestResult.timedOut, true)

    guest.emit('make_guess', { roomCode, guessLat: TEST_LOCATION.lat, guessLng: TEST_LOCATION.lng })
    await delay(50)

    const rounds = all('SELECT player_id, score FROM rounds WHERE game_id = ? ORDER BY id', [gameId])
    assert.equal(rounds.length, 1)
    assert.equal(rounds[0].player_id, hostProfileId)

    const gameOver = await gameOverPromise
    const guestStanding = gameOver.standings.find((entry) => entry.profileId === guestProfileId)
    assert.ok(guestStanding)
    assert.equal(guestStanding.score, 0)
  })

  it('auto-finalizes a disconnected player during a live round', async () => {
    const { makeSocket } = await createHarness()
    const { host, guest, roomCode, gameId, guestProfileId } = await setupOnlineRoom(makeSocket)

    const hostTurn = onceEvent(host, 'your_turn', 1500)
    const guestTurn = onceEvent(guest, 'your_turn', 1500)
    const startRes = await emitAck(host, 'start_game', { roomCode }, 1500)
    assert.equal(startRes.success, true)
    await Promise.all([hostTurn, guestTurn])

    const hostRoundResult = onceEvent(host, 'round_result', 500)
    const gameOverPromise = onceEvent(host, 'game_over', 1000)
    guest.disconnect()
    host.emit('make_guess', { roomCode, guessLat: TEST_LOCATION.lat, guessLng: TEST_LOCATION.lng })

    const hostResult = await hostRoundResult
    assert.equal(hostResult.score, 5000)

    const rounds = all('SELECT player_id FROM rounds WHERE game_id = ? ORDER BY id', [gameId])
    assert.equal(rounds.length, 1)
    assert.notEqual(rounds[0].player_id, guestProfileId)

    const gameOver = await gameOverPromise
    const guestStanding = gameOver.standings.find((entry) => entry.profileId === guestProfileId)
    assert.ok(guestStanding)
    assert.equal(guestStanding.score, 0)
  })
})
