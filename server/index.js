import express from 'express'
import http from 'http'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { Server } from 'socket.io'
import cors from 'cors'
import { v4 as uuidv4, validate as validateUuid } from 'uuid'
import lookup from 'coordinate_to_country'
import { getCountry } from 'countries-and-timezones'
import dotenv from 'dotenv'
import { initDb, run, get, all } from './db.js'
import { randomPointInCountry, findStreetViewLocation } from './locations.js'
import { calculateScore } from './score.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '.env') })


function getLanIp() {
  const ifaces = os.networkInterfaces()
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address
    }
  }
  return null
}

const LAN_IP = getLanIp()

const A3_TO_A2 = {
  FRA:'FR', USA:'US', JPN:'JP', AUS:'AU', GBR:'GB', ITA:'IT', IND:'IN',
  BRA:'BR', EGY:'EG', ARE:'AE', DEU:'DE', NLD:'NL', THA:'TH', RUS:'RU',
  CHN:'CN', CAN:'CA', MEX:'MX', ESP:'ES', PRT:'PT', SWE:'SE', NOR:'NO',
  DNK:'DK', FIN:'FI', CHE:'CH', AUT:'AT', BEL:'BE', GRC:'GR', TUR:'TR',
  KOR:'KR', ZAF:'ZA', ARG:'AR', CHL:'CL', COL:'CO', PER:'PE', NZL:'NZ',
  IDN:'ID', MYS:'MY', PHL:'PH', VNM:'VN', POL:'PL', CZE:'CZ', HUN:'HU',
  ROU:'RO', UKR:'UA', SAU:'SA', ZWE:'ZW', ISR:'IL', IRL:'IE', PAK:'PK',
  BGD:'BD', NGA:'NG', KEN:'KE', ETH:'ET', GHA:'GH', TZA:'TZ', UGA:'UG',
  MAR:'MA', DZA:'DZ', TUN:'TN', LBY:'LY', SDN:'SD', JOR:'JO', LBN:'LB',
  KWT:'KW', QAT:'QA', BHR:'BH', OMN:'OM', YEM:'YE', IRN:'IR', IRQ:'IQ',
  AFG:'AF', NPL:'NP', LKA:'LK', MMR:'MM', KHM:'KH', LAO:'LA', MNG:'MN',
  PRK:'KP', PSE:'PS', CUB:'CU', DOM:'DO', HTI:'HT', JAM:'JM', TTO:'TT',
  BHS:'BS', BRB:'BB', GRD:'GD', VCT:'VC', LCA:'LC', DMA:'DM', ATG:'AG',
  KNA:'KN', VEN:'VE', ECU:'EC', GTM:'GT', HND:'HN', SLV:'SV', NIC:'NI',
  CRI:'CR', PAN:'PA', BOL:'BO', PRY:'PY', URY:'UY', GUY:'GY', SUR:'SR',
  BLZ:'BZ', GAB:'GA', COG:'CG', COD:'CD', AGO:'AO', MOZ:'MZ', MDG:'MG',
  MUS:'MU', SEN:'SN', MLI:'ML', BFA:'BF', BEN:'BJ', TGO:'TG', CIV:'CI',
  GIN:'GN', GMB:'GM', SLE:'SL', LBR:'LR', MRT:'MR', NER:'NE', TCD:'TD',
  CMR:'CM', CAF:'CF', GNQ:'GQ', RWA:'RW', BDI:'BI', MWI:'MW', ZMB:'ZM',
  BWA:'BW', NAM:'NA', SWZ:'SZ', LSO:'LS', COM:'KM', SYC:'SC', CPV:'CV',
  STP:'ST', SYR:'SY', GEO:'GE', AZE:'AZ', ARM:'AM', KAZ:'KZ', KGZ:'KG',
  TJK:'TJ', TKM:'TM', UZB:'UZ', BLR:'BY', MDA:'MD', LTU:'LT', LVA:'LV',
  EST:'EE', SVK:'SK', SVN:'SI', HRV:'HR', BIH:'BA', MKD:'MK', ALB:'AL',
  MNE:'ME', SRB:'RS', BGR:'BG', HKG:'HK', MAC:'MO', SGP:'SG', BRN:'BN',
  FJI:'FJ', WSM:'WS', VUT:'VU', TON:'TO', PLW:'PW', FSM:'FM', MHL:'MH',
  KIR:'KI', TUV:'TV', SLB:'SB', NRU:'NR', PNG:'PG', MCO:'MC', LIE:'LI',
  AND:'AD', SMR:'SM', VAT:'VA', MLT:'MT', LUX:'LU', ISL:'IS', CYP:'CY',
}

function getCountryCode(lat, lng) {
  const result = lookup(lat, lng)
  return result?.[0] || null
}

function getCountryNameFromCode(code) {
  if (!code) return null
  const a2 = A3_TO_A2[code]
  if (!a2) return code
  const info = getCountry(a2)
  return info?.name || code
}

function sanitizeRoom(room) {
  if (!room) return null
  const { turnTimeoutId, ...rest } = room
  return { ...rest, hasTimeout: !!turnTimeoutId }
}

function hasSubmittedRound(room, socketId) {
  return Object.prototype.hasOwnProperty.call(room.roundFinals, socketId)
}

function areAllOnlinePlayersDone(room) {
  return room.players.every((player) => hasSubmittedRound(room, player.socketId))
}

function markOnlinePlayerFinal(room, socketId, result) {
  room.roundFinals[socketId] = result?.guess ?? null
  room.roundResults[socketId] = result
}

function buildOpponentGuesses(room, socketId) {
  const opponentGuesses = []
  for (const player of room.players) {
    if (player.socketId !== socketId && room.roundResults[player.socketId]?.guess) {
      opponentGuesses.push({
        username: player.username,
        guess: room.roundResults[player.socketId].guess,
      })
    }
  }
  return opponentGuesses
}

function moveOnlinePlayerSocketState(room, oldSocketId, newSocketId) {
  if (oldSocketId === newSocketId) return
  if (hasSubmittedRound(room, oldSocketId)) {
    room.roundFinals[newSocketId] = room.roundFinals[oldSocketId]
    delete room.roundFinals[oldSocketId]
  }
  if (Object.prototype.hasOwnProperty.call(room.roundResults, oldSocketId)) {
    room.roundResults[newSocketId] = room.roundResults[oldSocketId]
    delete room.roundResults[oldSocketId]
  }
}

const app = express()

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173'
const allowedOrigins = [CLIENT_ORIGIN]
if (LAN_IP) allowedOrigins.push(`http://${LAN_IP}:5173`)
app.use(cors({ origin: allowedOrigins }))
app.use(express.json())

const clientDist = path.resolve(__dirname, '..', 'client', 'dist')
app.use(express.static(clientDist))

function sanitizeUsername(username) {
  if (typeof username !== 'string') return null
  const trimmed = username.trim().slice(0, 20)
  if (trimmed.length < 2) return null
  if (!/^[a-zA-Z0-9 _-]+$/.test(trimmed)) return null
  return trimmed
}

function isValidRoomCode(code) {
  return typeof code === 'string' && /^\d{4}$/.test(code)
}

app.post('/api/profiles', (req, res) => {
  const username = sanitizeUsername(req.body.username)
  if (!username) return res.status(400).json({ error: 'Username must be 2-20 chars (letters, numbers, spaces, hyphens, underscores)' })

  const existing = get('SELECT * FROM profiles WHERE username = ?', [username])
  if (existing) return res.json(existing)

  const id = uuidv4()
  run('INSERT INTO profiles (id, username) VALUES (?, ?)', [id, username])
  res.json(get('SELECT * FROM profiles WHERE id = ?', [id]))
})

app.get('/api/profiles', (req, res) => {
  const profiles = all('SELECT id, username FROM profiles ORDER BY username')
  res.json(profiles)
})

app.get('/api/profiles/:id', (req, res) => {
  if (!validateUuid(req.params.id)) return res.status(400).json({ error: 'Invalid profile ID' })
  const profile = get('SELECT * FROM profiles WHERE id = ?', [req.params.id])
  if (!profile) return res.status(404).json({ error: 'Profile not found' })
  res.json(profile)
})

app.delete('/api/profiles/:id', (req, res) => {
  if (!validateUuid(req.params.id)) return res.status(400).json({ error: 'Invalid profile ID' })
  const profile = get('SELECT * FROM profiles WHERE id = ?', [req.params.id])
  if (!profile) return res.status(404).json({ error: 'Profile not found' })
  run('DELETE FROM game_players WHERE profile_id = ?', [req.params.id])
  run('DELETE FROM profiles WHERE id = ?', [req.params.id])
  res.json({ success: true })
})

app.get('/api/profiles/:id/history', (req, res) => {
  if (!validateUuid(req.params.id)) return res.status(400).json({ error: 'Invalid profile ID' })
  const profile = get('SELECT * FROM profiles WHERE id = ?', [req.params.id])
  if (!profile) return res.status(404).json({ error: 'Profile not found' })

  const games = all(`
    SELECT
      gs.id, gs.room_code, gs.status, gs.created_at,
      gp.score AS player_score,
      gp2.score AS opponent_score,
      gp2.profile_id AS opponent_id,
      p.username AS opponent_name
    FROM game_sessions gs
    JOIN game_players gp ON gp.game_id = gs.id AND gp.profile_id = ?
    LEFT JOIN game_players gp2 ON gp2.game_id = gs.id AND gp2.profile_id != gp.profile_id
    LEFT JOIN profiles p ON p.id = gp2.profile_id
    ORDER BY gs.created_at DESC
  `, [req.params.id])

  const matchPairs = all(`
    SELECT
      opponent_id, opponent_name,
      COUNT(*) AS games_together,
      SUM(net) AS net_points
    FROM (
      SELECT
        gp2.profile_id AS opponent_id, p.username AS opponent_name,
        gp1.score - gp2.score AS net
      FROM game_players gp1
      JOIN game_players gp2 ON gp1.game_id = gp2.game_id AND gp2.profile_id != gp1.profile_id
      JOIN profiles p ON p.id = gp2.profile_id
      WHERE gp1.profile_id = ?
    )
    GROUP BY opponent_id
    ORDER BY games_together DESC
  `, [req.params.id])

  res.json({ profile, games, matchPairs })
})

const rooms = {}

function generateRoomCode() {
  let code
  do {
    code = String(Math.floor(1000 + Math.random() * 9000))
  } while (rooms[code])
  return code
}

const KNOWN_LOCATIONS = [
  { lat: 48.8584, lng: 2.2945, name: 'Eiffel Tower, Paris', country: 'France', countryCode: 'FRA' },
  { lat: 40.7580, lng: -73.9855, name: 'Times Square, NYC', country: 'United States of America', countryCode: 'USA' },
  { lat: 35.6595, lng: 139.7004, name: 'Shibuya Crossing, Tokyo', country: 'Japan', countryCode: 'JPN' },
  { lat: -33.8568, lng: 151.2153, name: 'Sydney Opera House', country: 'Australia', countryCode: 'AUS' },
  { lat: 51.5007, lng: -0.1246, name: 'Big Ben, London', country: 'United Kingdom', countryCode: 'GBR' },
  { lat: 41.8902, lng: 12.4922, name: 'Colosseum, Rome', country: 'Italy', countryCode: 'ITA' },
  { lat: 27.1751, lng: 78.0421, name: 'Taj Mahal', country: 'India', countryCode: 'IND' },
  { lat: -22.9519, lng: -43.2105, name: 'Christ the Redeemer, Rio', country: 'Brazil', countryCode: 'BRA' },
  { lat: 29.9792, lng: 31.1342, name: 'Pyramids of Giza', country: 'Egypt', countryCode: 'EGY' },
  { lat: 25.1972, lng: 55.2744, name: 'Burj Khalifa, Dubai', country: 'United Arab Emirates', countryCode: 'ARE' },
  { lat: 37.8199, lng: -122.4783, name: 'Golden Gate Bridge, SF', country: 'United States of America', countryCode: 'USA' },
  { lat: 52.5163, lng: 13.3777, name: 'Brandenburg Gate, Berlin', country: 'Germany', countryCode: 'DEU' },
  { lat: 52.3676, lng: 4.9041, name: 'Amsterdam Canal', country: 'Netherlands', countryCode: 'NLD' },
  { lat: 13.7500, lng: 100.4914, name: 'Grand Palace, Bangkok', country: 'Thailand', countryCode: 'THA' },
  { lat: 48.1351, lng: 11.5820, name: 'Marienplatz, Munich', country: 'Germany', countryCode: 'DEU' },
  { lat: 34.0522, lng: -118.2437, name: 'Downtown LA', country: 'United States of America', countryCode: 'USA' },
  { lat: -23.5505, lng: -46.6333, name: 'São Paulo', country: 'Brazil', countryCode: 'BRA' },
  { lat: 55.7558, lng: 37.6173, name: 'Red Square, Moscow', country: 'Russia', countryCode: 'RUS' },
  { lat: -33.8688, lng: 151.2093, name: 'Sydney CBD', country: 'Australia', countryCode: 'AUS' },
  { lat: 35.6762, lng: 139.6503, name: 'Shinjuku, Tokyo', country: 'Japan', countryCode: 'JPN' },
]

const GEN_COUNTRIES = [...new Set(KNOWN_LOCATIONS.map((l) => l.countryCode))]

function locationFromRow(row) {
  const countryName = KNOWN_LOCATIONS.find((l) => l.countryCode === row.country_code)?.country || row.country_code
  return {
    lat: row.lat,
    lng: row.lng,
    name: row.name || countryName,
    country: countryName,
    countryCode: row.country_code,
  }
}

function randomCachedLocation() {
  const cached = get(`SELECT * FROM location_cache ORDER BY used_count ASC, RANDOM() LIMIT 1`)
  if (cached) {
    if (cached.used_count >= 3) {
      run('DELETE FROM location_cache WHERE id = ?', [cached.id])
    } else {
      run('UPDATE location_cache SET used_count = used_count + 1 WHERE id = ?', [cached.id])
    }
    return locationFromRow(cached)
  }
  return null
}

async function generateAndCacheLocation() {
  const found = []
  for (let batch = 0; batch < 10; batch++) {
    const entries = []
    for (let i = 0; i < 10; i++) {
      const cc = GEN_COUNTRIES[Math.floor(Math.random() * GEN_COUNTRIES.length)]
      const point = randomPointInCountry(cc)
      if (point) entries.push({ cc, point })
    }
    if (entries.length === 0) continue
    const results = await Promise.allSettled(entries.map(e => findStreetViewLocation(e.point.lat, e.point.lng)))
    for (let i = 0; i < results.length; i++) {
      const svLoc = results[i].status === 'fulfilled' ? results[i].value : null
      if (!svLoc) continue
      const { cc } = entries[i]
      const countryName = KNOWN_LOCATIONS.find((l) => l.countryCode === cc)?.country || cc
      run('INSERT INTO location_cache (country_code, lat, lng, name) VALUES (?, ?, ?, ?)', [cc, svLoc.lat, svLoc.lng, `${countryName} (random)`])
      found.push(locationFromRow({ lat: svLoc.lat, lng: svLoc.lng, country_code: cc, name: `${countryName} (random)` }))
    }
  }
  if (found.length === 0) return null
  return found[Math.floor(Math.random() * found.length)]
}

function cacheCount() {
  const row = get('SELECT COUNT(*) AS count FROM location_cache')
  return row?.count || 0
}

const MAX_CACHE = 300
const REFILL_THRESHOLD = 50

async function warmupCache() {
  const needed = MAX_CACHE - cacheCount()
  if (needed <= 0) return
  const rounds = Math.ceil(needed / 50)
  for (let i = 0; i < rounds; i++) {
    if (cacheCount() >= MAX_CACHE) break
    await Promise.all(Array.from({ length: 3 }, () => generateAndCacheLocation().catch(() => null)))
  }
  console.log(`Cache warmup done: ${cacheCount()} entries`)
}

async function replenishCache() {
  if (cacheCount() < REFILL_THRESHOLD) {
    await generateAndCacheLocation().catch(() => {})
  }
}

function randomFallback() {
  return KNOWN_LOCATIONS[Math.floor(Math.random() * KNOWN_LOCATIONS.length)]
}

async function randomLocation() {
  const cached = randomCachedLocation()
  if (cached) {
    replenishCache()
    return cached
  }
  return await generateAndCacheLocation() || randomFallback()
}

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val))
}

export async function startServer(options = {}) {
  const {
    port = process.env.PORT || 3001,
    host = '0.0.0.0',
    randomLocationFn = randomLocation,
    enableCacheWarmup = true,
    cacheRefillIntervalMs = 60000,
    revealDelayMs = 6000,
    turnTimeoutBufferMs = 3000,
  } = options

  await initDb()
  if (enableCacheWarmup) {
    warmupCache()
  }
  const cacheIntervalId = cacheRefillIntervalMs > 0
    ? setInterval(() => replenishCache(), cacheRefillIntervalMs)
    : null

  const server = http.createServer(app)
  const io = new Server(server, {
    cors: {
      origin: CLIENT_ORIGIN,
      methods: ['GET', 'POST'],
    },
  })

  function clearRoomTimer(room) {
    if (room.turnTimeoutId) {
      clearTimeout(room.turnTimeoutId)
      room.turnTimeoutId = null
    }
  }

  async function finishOnlineRound(room, roomCode) {
    if (room.status !== 'playing') return
    room.status = 'revealing'

    for (const player of room.players) {
      const result = room.roundResults[player.socketId]
      if (!result) continue

      io.to(player.socketId).emit('round_result', {
        round: room.currentRound,
        player: player.username,
        actual: room.currentTurnLocation,
        opponentGuesses: buildOpponentGuesses(room, player.socketId),
        ...result,
      })
    }

    io.to(roomCode).emit('room_update', { ...sanitizeRoom(room), roomCode })

    clearRoomTimer(room)
    room.turnTimeoutId = setTimeout(async () => {
      room.status = 'playing'
      room.roundFinals = {}
      room.roundResults = {}

      if (room.currentRound < room.totalRounds) {
        await advanceOnlineRound(room, roomCode)
      } else {
        room.status = 'finished'
        run('UPDATE game_sessions SET status = ? WHERE id = ?', ['finished', room.gameId])
        io.to(roomCode).emit('room_update', { ...sanitizeRoom(room), roomCode })
        const standings = room.players.map((p) => {
          run('UPDATE profiles SET games_played = games_played + 1, total_score = total_score + ? WHERE id = ?', [p.score, p.profileId])
          return { username: p.username, profileId: p.profileId, score: p.score, correctCountries: p.correctCountries }
        })
        standings.sort((a, b) => b.score - a.score)
        io.to(roomCode).emit('game_over', { standings })
      }
      room.turnTimeoutId = null
    }, revealDelayMs)
  }

  async function forceEndOnlineRound(room, roomCode) {
    if (room.status !== 'playing') return

    for (const player of room.players) {
      if (!hasSubmittedRound(room, player.socketId)) {
        markOnlinePlayerFinal(room, player.socketId, {
          guess: null,
          guessedCountry: null,
          actualCountry: room.currentTurnLocation?.country || 'Unknown',
          countryCorrect: false,
          score: 0,
          distanceKm: null,
          timedOut: true,
        })
      }
    }
    await finishOnlineRound(room, roomCode)
  }

  async function advanceOnlineRound(room, roomCode) {
    room.currentRound++
    const newLocation = await randomLocationFn()
    room.currentTurnLocation = newLocation

    io.to(roomCode).emit('room_update', { ...sanitizeRoom(room), roomCode })
    io.to(roomCode).emit('new_round', { round: room.currentRound, totalRounds: room.totalRounds })

    for (const player of room.players) {
      io.to(player.socketId).emit('your_turn', {
        round: room.currentRound,
        location: newLocation,
        player: player.username,
        turnTimeLimit: room.timeLimit,
      })
    }

    clearRoomTimer(room)
    room.turnTimeoutId = setTimeout(() => {
      forceEndOnlineRound(room, roomCode)
    }, (room.timeLimit + turnTimeoutBufferMs) * 1000)
  }

  async function advanceTurn(room, roomCode) {
    room.guessSubmitted = false

    if (room.turnTimeoutId) {
      clearTimeout(room.turnTimeoutId)
      room.turnTimeoutId = null
    }

    const isLastPlayer = room.currentPlayerIndex >= room.players.length - 1

    if (!isLastPlayer) {
      room.currentPlayerIndex++
      const nextPlayer = room.players[room.currentPlayerIndex]

      io.to(roomCode).emit('room_update', { ...sanitizeRoom(room), roomCode })

      if (room.mode === 'online') {
        io.to(roomCode).emit('next_turn', { player: nextPlayer.username, playerSocketId: nextPlayer.socketId })
      }

      clearRoomTimer(room)
      room.turnTimeoutId = setTimeout(async () => {
        try {
          if (room.mode === 'local') {
            room.currentTurnLocation = await randomLocationFn()
          }
          io.to(nextPlayer.socketId).emit('your_turn', {
            round: room.currentRound,
            location: room.currentTurnLocation,
            player: nextPlayer.username,
            currentPlayerIndex: room.currentPlayerIndex,
            turnTimeLimit: room.timeLimit,
          })
        } catch (err) {
          console.error('Failed to advance turn:', err)
        }
        room.turnTimeoutId = null
      }, 5000)
    } else if (room.currentRound < room.totalRounds) {
      room.currentRound++
      room.currentPlayerIndex = 0
      const newLocation = await randomLocationFn()
      room.currentTurnLocation = newLocation

      io.to(roomCode).emit('room_update', { ...sanitizeRoom(room), roomCode })

      clearRoomTimer(room)
      room.turnTimeoutId = setTimeout(() => {
        io.to(roomCode).emit('new_round', { round: room.currentRound, totalRounds: room.totalRounds })
        const firstPlayer = room.players[0]
        io.to(firstPlayer.socketId).emit('your_turn', {
          round: room.currentRound,
          location: newLocation,
          player: firstPlayer.username,
          currentPlayerIndex: 0,
          turnTimeLimit: room.timeLimit,
        })
        room.turnTimeoutId = null
      }, 5000)
    } else {
      room.status = 'finished'
      run('UPDATE game_sessions SET status = ? WHERE id = ?', ['finished', room.gameId])

      io.to(roomCode).emit('room_update', { ...sanitizeRoom(room), roomCode })

      const standings = room.players.map((p) => {
        run('UPDATE profiles SET games_played = games_played + 1, total_score = total_score + ? WHERE id = ?', [p.score, p.profileId])
        return { username: p.username, profileId: p.profileId, score: p.score, correctCountries: p.correctCountries }
      })
      standings.sort((a, b) => b.score - a.score)
      clearRoomTimer(room)
      room.turnTimeoutId = setTimeout(() => {
        io.to(roomCode).emit('game_over', { standings })
        room.turnTimeoutId = null
      }, 5000)
    }
  }

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`)

    // ---- LOCAL MODE (same device, both players on one socket) ----
    socket.on('create_local_game', async ({ players, rounds, timeLimit }, callback) => {
      if (!Array.isArray(players) || players.length !== 2) {
        return callback?.({ error: 'Need exactly 2 players' })
      }
      for (const p of players) {
        if (!sanitizeUsername(p.username) || !validateUuid(p.profileId)) {
          return callback?.({ error: 'Invalid player data' })
        }
      }

      const roomCode = generateRoomCode()
      const gameId = uuidv4()
      const location = await randomLocationFn()

      run('INSERT INTO game_sessions (id, room_code, status) VALUES (?, ?, ?)', [gameId, roomCode, 'playing'])
      for (const p of players) {
        run('INSERT INTO game_players (game_id, profile_id) VALUES (?, ?)', [gameId, p.profileId])
      }

      rooms[roomCode] = {
        gameId,
        mode: 'local',
        host: socket.id,
        players: players.map((p) => ({
          socketId: socket.id,
          profileId: p.profileId,
          username: sanitizeUsername(p.username),
          correctCountries: 0,
          score: 0,
        })),
        status: 'playing',
        currentRound: 1,
        totalRounds: clamp(rounds || 2, 1, 20),
        timeLimit: clamp(timeLimit || 30, 10, 120),
        currentTurnLocation: location,
        currentPlayerIndex: 0,
        guessSubmitted: false,
        turnTimeoutId: null,
      }

      socket.join(roomCode)

      const currentPlayer = rooms[roomCode].players[0]
      callback?.({ roomCode, gameId })
      io.to(roomCode).emit('room_update', { ...sanitizeRoom(rooms[roomCode]), roomCode })
      io.to(roomCode).emit('game_started', {
        round: 1,
        totalRounds: rooms[roomCode].totalRounds,
        currentPlayer: currentPlayer.username,
        currentPlayerIndex: rooms[roomCode].currentPlayerIndex,
        currentPlayerSocketId: socket.id,
        location,
        turnTimeLimit: rooms[roomCode].timeLimit,
        local: true,
      })
      socket.emit('your_turn', {
        round: 1,
        location,
        player: currentPlayer.username,
        currentPlayerIndex: rooms[roomCode].currentPlayerIndex,
        turnTimeLimit: rooms[roomCode].timeLimit,
      })
    })

    // ---- ONLINE MODE (two devices, room code) ----
    socket.on('create_room', ({ profileId, username, rounds, timeLimit }, callback) => {
      const safeUsername = sanitizeUsername(username)
      if (!safeUsername || !validateUuid(profileId)) {
        return callback?.({ error: 'Invalid profile' })
      }

      const roomCode = generateRoomCode()
      const gameId = uuidv4()

      run('INSERT INTO game_sessions (id, room_code) VALUES (?, ?)', [gameId, roomCode])

      rooms[roomCode] = {
        gameId,
        mode: 'online',
        host: socket.id,
        players: [{ socketId: socket.id, profileId, username: safeUsername, ready: false, correctCountries: 0, score: 0 }],
        status: 'waiting',
        currentRound: 1,
        totalRounds: clamp(rounds || 2, 1, 20),
        timeLimit: clamp(timeLimit || 30, 10, 120),
        currentTurnLocation: null,
        currentPlayerIndex: 0,
        guessSubmitted: false,
        turnTimeoutId: null,
        roundFinals: {},
        roundResults: {},
      }

      socket.join(roomCode)
      callback?.({ roomCode, gameId })
      io.to(roomCode).emit('room_update', { ...sanitizeRoom(rooms[roomCode]), roomCode })
    })

    socket.on('join_room', ({ roomCode, profileId, username }, callback) => {
      const safeUsername = sanitizeUsername(username)
      if (!safeUsername || !validateUuid(profileId) || !isValidRoomCode(roomCode)) {
        return callback?.({ error: 'Invalid input' })
      }

      const room = rooms[roomCode]
      if (!room) return callback?.({ error: 'Room not found' })
      if (room.players.length >= 2) return callback?.({ error: 'Room is full' })
      if (room.status !== 'waiting') return callback?.({ error: 'Game already started' })
      if (room.mode !== 'online') return callback?.({ error: 'Room is not an online game' })
      if (room.players.some(p => p.profileId === profileId)) return callback?.({ error: 'Already in room' })

      room.players.push({ socketId: socket.id, profileId, username: safeUsername, ready: false, correctCountries: 0, score: 0 })
      socket.join(roomCode)
      callback?.({ success: true })
      io.to(roomCode).emit('room_update', { ...sanitizeRoom(room), roomCode })
    })

    socket.on('reconnect_room', ({ roomCode, profileId }, callback) => {
      if (!isValidRoomCode(roomCode) || !validateUuid(profileId)) {
        return callback?.({ error: 'Invalid reconnect request' })
      }

      const room = rooms[roomCode]
      if (!room || room.mode !== 'online') return callback?.({ error: 'Room not found' })

      const player = room.players.find((p) => p.profileId === profileId)
      if (!player) return callback?.({ error: 'Player not found in room' })

      const previousSocketId = player.socketId
      player.socketId = socket.id
      player.disconnected = false
      socket.join(roomCode)

      if (room.host === previousSocketId) {
        room.host = socket.id
      }
      moveOnlinePlayerSocketState(room, previousSocketId, socket.id)

      callback?.({ success: true, room: { ...sanitizeRoom(room), roomCode } })
      io.to(roomCode).emit('room_update', { ...sanitizeRoom(room), roomCode })

      if (room.status === 'playing' && room.currentTurnLocation && !hasSubmittedRound(room, socket.id)) {
        io.to(socket.id).emit('your_turn', {
          round: room.currentRound,
          location: room.currentTurnLocation,
          player: player.username,
          turnTimeLimit: room.timeLimit,
        })
      } else if (room.status === 'revealing') {
        const result = room.roundResults[socket.id]
        if (result) {
          io.to(socket.id).emit('round_result', {
            round: room.currentRound,
            player: player.username,
            actual: room.currentTurnLocation,
            opponentGuesses: buildOpponentGuesses(room, socket.id),
            ...result,
          })
        }
      }
    })

    socket.on('start_game', async ({ roomCode }, callback) => {
      try {
        if (!isValidRoomCode(roomCode)) return callback?.({ error: 'Invalid room code' })

        const room = rooms[roomCode]
        if (!room || room.mode !== 'online' || room.host !== socket.id) return callback?.({ error: 'Only the host can start this room' })
        if (room.players.filter((player) => !player.disconnected).length < 2) return callback?.({ error: 'Two connected players are required' })
        if (room.status !== 'waiting' && room.status !== 'finished') return callback?.({ error: 'Game cannot be started right now' })

        // Reset scores if we are replaying in same room
        for (const p of room.players) {
          p.score = 0
          p.correctCountries = 0
          p.disconnected = false
        }
        io.to(roomCode).emit('room_update', { ...sanitizeRoom(room), roomCode })

        // Generate new gameId if replaying in same room
        if (room.status === 'finished') {
          room.gameId = uuidv4()
          run('INSERT INTO game_sessions (id, room_code) VALUES (?, ?)', [room.gameId, roomCode])
        }

        room.status = 'playing'
        room.currentRound = 1
        room.roundFinals = {}
        room.roundResults = {}
        room.currentTurnLocation = await randomLocationFn()

        const seen = new Set()
        for (const player of room.players) {
          if (seen.has(player.profileId)) continue
          seen.add(player.profileId)
          run('INSERT OR IGNORE INTO game_players (game_id, profile_id) VALUES (?, ?)', [room.gameId, player.profileId])
        }

        io.to(roomCode).emit('game_started', {
          round: 1,
          totalRounds: room.totalRounds,
          turnTimeLimit: room.timeLimit,
          local: false,
        })

        for (const player of room.players) {
          io.to(player.socketId).emit('your_turn', {
            round: 1,
            location: room.currentTurnLocation,
            player: player.username,
            turnTimeLimit: room.timeLimit,
          })
        }

        // Safety: Force end round after limit + buffer
        clearRoomTimer(room)
        room.turnTimeoutId = setTimeout(() => {
          forceEndOnlineRound(room, roomCode)
        }, (room.timeLimit + turnTimeoutBufferMs) * 1000)
        callback?.({ success: true })
      } catch (err) {
        console.error('start_game error:', err)
        callback?.({ error: 'Failed to start game. Try again.' })
      }
    })

    socket.on('back_to_lobby', ({ roomCode }) => {
      if (!isValidRoomCode(roomCode)) return
      const room = rooms[roomCode]
      if (!room || room.mode !== 'online' || room.host !== socket.id) return

      clearRoomTimer(room)
      room.status = 'waiting'
      room.currentRound = 1
      room.currentPlayerIndex = 0
      room.currentTurnLocation = null
      room.roundFinals = {}
      room.roundResults = {}
      io.to(roomCode).emit('room_update', { ...sanitizeRoom(room), roomCode })
    })

    socket.on('change_settings', ({ roomCode, rounds, timeLimit }) => {
      if (!isValidRoomCode(roomCode)) return
      const room = rooms[roomCode]
      if (!room || room.mode !== 'online' || room.host !== socket.id) return
      if (room.status !== 'waiting') return

      if (rounds) room.totalRounds = clamp(rounds, 1, 20)
      if (timeLimit) room.timeLimit = clamp(timeLimit, 10, 120)

      io.to(roomCode).emit('room_update', { ...sanitizeRoom(room), roomCode })
    })

    // ---- SHARED: make_guess + timeout_guess ----
    socket.on('make_guess', async ({ roomCode, guessLat, guessLng }) => {
      if (!isValidRoomCode(roomCode)) return
      if (typeof guessLat !== 'number' || typeof guessLng !== 'number') return
      if (guessLat < -90 || guessLat > 90 || guessLng < -180 || guessLng > 180) return

      const room = rooms[roomCode]
      if (!room || room.status !== 'playing') return

      const location = room.currentTurnLocation

      if (room.mode === 'local') {
        if (room.guessSubmitted) return
        const currentPlayer = room.players[room.currentPlayerIndex]
        if (socket.id !== currentPlayer.socketId) return
        room.guessSubmitted = true

        const { score, distanceKm } = calculateScore(location, { lat: guessLat, lng: guessLng })
        run(
          'INSERT INTO rounds (game_id, round_number, location_lat, location_lng, guess_lat, guess_lng, player_id, score) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [room.gameId, room.currentRound, location.lat, location.lng, guessLat, guessLng, currentPlayer.profileId, score]
        )
        run('UPDATE game_players SET score = score + ? WHERE game_id = ? AND profile_id = ?', [score, room.gameId, currentPlayer.profileId])

        const guessedCountryCode = getCountryCode(guessLat, guessLng)
        const guessedCountry = getCountryNameFromCode(guessedCountryCode)
        const countryCorrect = guessedCountryCode === location.countryCode
        if (countryCorrect) currentPlayer.correctCountries++
        currentPlayer.score += score

        io.to(roomCode).emit('round_result', {
          round: room.currentRound,
          player: currentPlayer.username,
          guess: { lat: guessLat, lng: guessLng },
          actual: location,
          guessedCountry,
          actualCountry: location.country,
          countryCorrect,
          score,
          distanceKm,
        })

        await advanceTurn(room, roomCode, io)
      } else {
        // Online mode — any player can guess
        const player = room.players.find(p => p.socketId === socket.id)
        if (!player || hasSubmittedRound(room, socket.id)) return
        room.roundFinals[socket.id] = { lat: guessLat, lng: guessLng }

        const { score, distanceKm } = calculateScore(location, { lat: guessLat, lng: guessLng })
        run(
          'INSERT INTO rounds (game_id, round_number, location_lat, location_lng, guess_lat, guess_lng, player_id, score) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [room.gameId, room.currentRound, location.lat, location.lng, guessLat, guessLng, player.profileId, score]
        )
        run('UPDATE game_players SET score = score + ? WHERE game_id = ? AND profile_id = ?', [score, room.gameId, player.profileId])

        const guessedCountryCode = getCountryCode(guessLat, guessLng)
        const guessedCountry = getCountryNameFromCode(guessedCountryCode)
        const countryCorrect = guessedCountryCode === location.countryCode
        if (countryCorrect) player.correctCountries++
        player.score += score

        room.roundResults[socket.id] = {
          guess: { lat: guessLat, lng: guessLng },
          guessedCountry,
          actualCountry: location.country,
          countryCorrect,
          score,
          distanceKm,
        }

        socket.to(roomCode).emit('player_guessed', { player: player.username })

        // Check if all players have guessed
        const allDone = areAllOnlinePlayersDone(room)
        if (allDone) await finishOnlineRound(room, roomCode)
      }
    })

    socket.on('timeout_guess', async ({ roomCode }) => {
      if (!isValidRoomCode(roomCode)) return
      const room = rooms[roomCode]
      if (!room || room.status !== 'playing') return

      if (room.mode === 'local') {
        if (room.guessSubmitted) return
        const currentPlayer = room.players[room.currentPlayerIndex]
        if (socket.id !== currentPlayer.socketId) return
        room.guessSubmitted = true

        io.to(roomCode).emit('round_result', {
          round: room.currentRound,
          player: currentPlayer.username,
          guess: null,
          actual: room.currentTurnLocation,
          actualCountry: room.currentTurnLocation.country,
          score: 0,
          distanceKm: null,
          timedOut: true,
        })

        await advanceTurn(room, roomCode, io)
      } else {
        const player = room.players.find(p => p.socketId === socket.id)
        if (!player || hasSubmittedRound(room, socket.id)) return
        markOnlinePlayerFinal(room, socket.id, {
          guess: null,
          guessedCountry: null,
          actualCountry: room.currentTurnLocation.country,
          countryCorrect: false,
          score: 0,
          distanceKm: null,
          timedOut: true,
        })

        socket.to(roomCode).emit('player_guessed', { player: player.username })

        const allDone = areAllOnlinePlayersDone(room)
        if (allDone) await finishOnlineRound(room, roomCode)
      }
    })

    socket.on('disconnect', () => {
      for (const [code, room] of Object.entries(rooms)) {
        const idx = room.players.findIndex((p) => p.socketId === socket.id)
        if (idx === -1) continue

        if (room.mode === 'local') {
          room.players.splice(idx, 1)
          if (room.players.length === 0) {
            clearRoomTimer(room)
            delete rooms[code]
          }
          continue
        }

        const player = room.players[idx]
        player.disconnected = true

        const connectedPlayers = room.players.filter((p) => !p.disconnected)
        if (socket.id === room.host && connectedPlayers.length > 0) {
          room.host = connectedPlayers[0].socketId
        }

        io.to(code).emit('room_update', { ...sanitizeRoom(room), roomCode: code })
        io.to(code).emit('player_disconnected', { socketId: socket.id })

        if (room.status === 'playing' && !hasSubmittedRound(room, socket.id)) {
          markOnlinePlayerFinal(room, socket.id, {
            guess: null,
            guessedCountry: null,
            actualCountry: room.currentTurnLocation?.country || 'Unknown',
            countryCorrect: false,
            score: 0,
            distanceKm: null,
            timedOut: true,
          })
          if (areAllOnlinePlayersDone(room)) finishOnlineRound(room, code)
        }

        if (connectedPlayers.length === 0) {
          clearRoomTimer(room)
          delete rooms[code]
        }
      }
    })

    socket.on('get_room', ({ roomCode }, callback) => {
      if (!isValidRoomCode(roomCode)) return callback?.({ error: 'Invalid room code' })
      const room = rooms[roomCode]
      if (!room) return callback?.({ error: 'Room not found. Server may have restarted.' })
      callback?.({ ...sanitizeRoom(room), roomCode })
    })
  })

  // SPA fallback — serve index.html for non-API, non-socket routes
  app.get('*', (req, res) => {
    if (req.path.startsWith('/socket.io') || req.path.startsWith('/api')) return
    res.sendFile(path.join(clientDist, 'index.html'))
  })

  await new Promise((resolve, reject) => {
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`Port ${port} is already in use. Close the other process or set PORT env var.`)
      } else {
        console.error('Server error:', err.message)
      }
      reject(err)
    })
    server.listen(port, host, () => {
      const address = server.address()
      const boundPort = typeof address === 'object' && address ? address.port : port
      console.log(`Server running on http://localhost:${boundPort} (CORS: ${CLIENT_ORIGIN})`)
      if (LAN_IP) console.log(`LAN access: http://${LAN_IP}:${boundPort}`)
      resolve()
    })
  })

  return {
    app,
    io,
    server,
    port: typeof server.address() === 'object' && server.address() ? server.address().port : port,
    async close() {
      if (cacheIntervalId) clearInterval(cacheIntervalId)
      for (const room of Object.values(rooms)) {
        clearRoomTimer(room)
      }
      for (const code of Object.keys(rooms)) {
        delete rooms[code]
      }
      await new Promise((resolve) => io.close(() => resolve()))
      if (!server.listening) return
      await new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err)
          else resolve()
        })
      })
    },
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer().then(({ close }) => {
    const shutdown = async () => {
      console.log('\nShutting down...')
      await close()
      process.exit(0)
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  }).catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
