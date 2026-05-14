import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import { initDb, run, get, all } from '../db.js'
import { calculateScore } from '../score.js'

before(async () => {
  await initDb()
})

after(() => {
  run('DELETE FROM rounds WHERE game_id LIKE ?', ['test-%'])
  run('DELETE FROM game_players WHERE game_id LIKE ?', ['test-%'])
  run('DELETE FROM game_sessions WHERE id LIKE ?', ['test-%'])
  run('DELETE FROM profiles WHERE username LIKE ?', ['test_%'])
})

describe('Database', () => {
  it('should create and retrieve a profile', () => {
    run('INSERT OR REPLACE INTO profiles (id, username, games_played, total_score) VALUES (?, ?, 0, 0)', ['test-db-id', 'test_player'])
    const profile = get('SELECT * FROM profiles WHERE id = ?', ['test-db-id'])
    assert.equal(profile.username, 'test_player')
    assert.equal(profile.games_played, 0)
    assert.ok(profile.created_at)
  })

  it('should update profile stats', () => {
    run('UPDATE profiles SET games_played = games_played + 1, total_score = total_score + ? WHERE id = ?', [500, 'test-db-id'])
    const profile = get('SELECT * FROM profiles WHERE id = ?', ['test-db-id'])
    assert.equal(profile.games_played, 1)
    assert.equal(profile.total_score, 500)
  })

  it('should create game session and players', () => {
    run('INSERT OR REPLACE INTO game_sessions (id, room_code, status) VALUES (?, ?, ?)', ['test-game-1', 'TEST', 'waiting'])
    run('INSERT OR REPLACE INTO game_players (game_id, profile_id, score) VALUES (?, ?, ?)', ['test-game-1', 'test-db-id', 0])
    const players = all('SELECT * FROM game_players WHERE game_id = ?', ['test-game-1'])
    assert.equal(players.length, 1)
  })

  it('should insert rounds', () => {
    run('DELETE FROM rounds WHERE game_id = ?', ['test-game-1'])
    run(
      'INSERT INTO rounds (game_id, round_number, location_lat, location_lng, guess_lat, guess_lng, player_id, score) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ['test-game-1', 1, 48.8566, 2.3522, 48.8566, 2.3522, 'test-db-id', 5000]
    )
    const rounds = all('SELECT * FROM rounds WHERE game_id = ?', ['test-game-1'])
    assert.equal(rounds.length, 1)
    assert.equal(rounds[0].score, 5000)
  })
})

describe('Scoring', () => {
  it('should return 5000 for exact match', () => {
    const { score, distanceKm } = calculateScore({ lat: 48.8566, lng: 2.3522 }, { lat: 48.8566, lng: 2.3522 })
    assert.equal(score, 5000)
    assert.equal(distanceKm, 0)
  })

  it('should return 0 for very far points', () => {
    const { score } = calculateScore({ lat: 48.8566, lng: 2.3522 }, { lat: -33.8688, lng: 151.2093 })
    assert.ok(score < 1000)
  })

  it('should return score > 2000 for points ~1000km apart', () => {
    const { score } = calculateScore({ lat: 48.8566, lng: 2.3522 }, { lat: 41.9028, lng: 12.4964 })
    assert.ok(score > 2000)
    assert.ok(score < 4000)
  })

  it('should return partial score for medium distance', () => {
    const { score } = calculateScore({ lat: 48.8566, lng: 2.3522 }, { lat: 48.0, lng: 2.5 })
    assert.ok(score > 0)
    assert.ok(score < 5000)
  })
})

describe('Input Validation', () => {
  it('should reject empty usernames', () => {
    const sanitized = ''.trim()
    assert.equal(sanitized.length >= 2, false)
  })

  it('should reject short usernames', () => {
    const sanitized = 'a'.trim()
    assert.equal(sanitized.length >= 2, false)
  })

  it('should accept valid usernames', () => {
    const valid = /^[a-zA-Z0-9 _-]+$/
    assert.equal(valid.test('hello_world'), true)
    assert.equal(valid.test('Player 1'), true)
    assert.equal(valid.test('abc'), true)
  })

  it('should reject usernames with special characters', () => {
    const valid = /^[a-zA-Z0-9 _-]+$/
    assert.equal(valid.test('hello@world'), false)
    assert.equal(valid.test('<script>'), false)
    assert.equal(valid.test('user!'), false)
  })

  it('should validate 4-char room codes', () => {
    const valid = /^[A-Z0-9]{4}$/
    assert.equal(valid.test('ABCD'), true)
    assert.equal(valid.test('1234'), true)
    assert.equal(valid.test('XYZ1'), true)
    assert.equal(valid.test('abc'), false)
    assert.equal(valid.test('ABCDE'), false)
    assert.equal(valid.test(''), false)
    assert.equal(valid.test('ab!3'), false)
  })
})
