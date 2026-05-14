import { describe, it } from 'node:test'
import assert from 'node:assert'
import { calculateScore } from '../score.js'

describe('Scoring (integration)', () => {
  it('exact match returns 5000', () => {
    const { score } = calculateScore({ lat: 0, lng: 0 }, { lat: 0, lng: 0 })
    assert.equal(score, 5000)
  })

  it('NYC to Paris is a valid number', () => {
    const { score } = calculateScore({ lat: 40.71, lng: -74.0 }, { lat: 48.85, lng: 2.35 })
    assert.ok(typeof score === 'number' && score >= 0 && score <= 5000)
  })
})

describe('Profile validation sanity', () => {
  function sanitizeUsername(u) {
    if (typeof u !== 'string') return null
    const trimmed = u.trim().slice(0, 20)
    if (trimmed.length < 2) return null
    if (!/^[a-zA-Z0-9 _-]+$/.test(trimmed)) return null
    return trimmed
  }

  it('accepts valid names', () => {
    assert.equal(sanitizeUsername(' Alice '), 'Alice')
    assert.equal(sanitizeUsername('Player One'), 'Player One')
    assert.equal(sanitizeUsername('ab'), 'ab')
  })

  it('rejects invalid names', () => {
    assert.equal(sanitizeUsername('a'), null)
    assert.equal(sanitizeUsername(''), null)
    assert.equal(sanitizeUsername('<script>'), null)
    assert.equal(sanitizeUsername(123), null)
  })
})
