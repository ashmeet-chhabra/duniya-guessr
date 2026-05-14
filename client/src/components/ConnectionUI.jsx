import { useState, useEffect } from 'react'

const TIME_PRESETS = [
  { label: '30', value: '30' },
  { label: '60', value: '60' },
  { label: '80', value: '80' },
  { label: 'Custom', value: 'custom' },
]

const ROUND_PRESETS = [
  { label: '2', value: '2' },
  { label: '5', value: '5' },
  { label: '10', value: '10' },
  { label: '15', value: '15' },
  { label: 'Custom', value: 'custom' },
]

const PAGE_SIZE = 10

function HistoryView() {
  const [profiles, setProfiles] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [history, setHistory] = useState(null)
  const [page, setPage] = useState(0)
  const [deletingId, setDeletingId] = useState(null)

  useEffect(() => {
    fetch('/api/profiles').then((r) => r.json()).then((list) => {
      setProfiles((list || []).filter((p) => !/^player\s?\d+$/i.test(p.username)))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedId) { setHistory(null); return }
    setPage(0)
    fetch(`/api/profiles/${selectedId}/history`).then((r) => r.json()).then(setHistory).catch(() => {})
  }, [selectedId])

  if (selectedId && history) {
    const allGames = history.games || []
    const opponents = (history.matchPairs || []).filter((m) => !/^player\s?\d+$/i.test(m.opponent_name))
    const totalNet = opponents.reduce((s, m) => s + (m.net_points || 0), 0)
    const totalPages = Math.ceil(allGames.length / PAGE_SIZE) || 1
    const visibleGames = allGames.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
    return (
      <div className="history-card">
        <button className="history-back" onClick={() => setSelectedId(null)}>&larr; Back</button>
        <h2>{history.profile.username}</h2>
        <div className="history-total">
          <span>Games: <strong style={{ color:'var(--text)' }}>{allGames.length}</strong></span>
          <span>Net: <strong style={{ color: totalNet >= 0 ? 'var(--success)' : 'var(--error)' }}>{totalNet >= 0 ? '+' : ''}{Math.round(totalNet)}</strong></span>
        </div>
        {opponents.length > 0 && (
          <>
            <div className="history-section-title">Matchups</div>
            {opponents.map((m) => {
              const net = Math.round(m.net_points || 0)
              return (
                <div key={m.opponent_id} className="history-matchup">
                  <span style={{ fontWeight:600 }}>{m.opponent_name}</span>
                  <span style={{ color:'var(--muted)' }}>{m.games_together} games</span>
                  <span style={{ color: net >= 0 ? 'var(--success)' : 'var(--error)', fontWeight:700 }}>{net >= 0 ? '+' : ''}{net}</span>
                </div>
              )
            })}
          </>
        )}
        {allGames.length > 0 && (
          <>
            <div className="history-section-title">All Games</div>
            {visibleGames.map((g) => {
              const net = g.opponent_score != null ? Math.round((g.player_score || 0) - (g.opponent_score || 0)) : null
              const badge = g.status === 'finished' ? '' : ' (in progress)'
              return (
                <div key={g.id} className="history-game">
                  <span className="history-game-date">{g.created_at?.slice(0, 10) || '?'}{badge}</span>
                  <span style={{ display:'flex', alignItems:'center', gap:8 }}>
                    {net != null && (
                      <span style={{ color: net >= 0 ? 'var(--success)' : 'var(--error)', fontWeight:700 }}>{net >= 0 ? '+' : ''}{net}</span>
                    )}
                    {g.opponent_name && !/^player\s?\d+$/i.test(g.opponent_name) && (
                      <span style={{ color:'var(--muted)' }}>vs {g.opponent_name}</span>
                    )}
                  </span>
                </div>
              )
            })}
            {totalPages > 1 && (
              <div className="history-pagination">
                <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>Previous</button>
                <span style={{ color:'var(--muted)', padding:'4px 0' }}>{page + 1} / {totalPages}</span>
                <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}>Next</button>
              </div>
            )}
          </>
        )}
        {!allGames.length && <p style={{ textAlign:'center', color:'var(--muted)', marginTop:16, fontSize:12 }}>No games played yet.</p>}
      </div>
    )
  }

  return (
    <div className="history-card">
      <h2>Player History</h2>
      {profiles.length === 0 ? (
        <p style={{ textAlign:'center', color:'var(--muted)', marginTop:16, fontSize:12 }}>No players found. Play a game first!</p>
      ) : (
        profiles.map((p) => (
          deletingId === p.id ? (
            <div key={p.id} className="history-profile" style={{ flexDirection:'column', gap:8, cursor:'default' }}>
              <input className="history-delete-input" type="password" placeholder="Enter password" autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (e.target.value === '666') {
                      fetch(`/api/profiles/${p.id}`, { method: 'DELETE' })
                        .then((r) => { if (!r.ok) throw new Error(); return r.json() })
                        .then(() => setProfiles((prev) => prev.filter((x) => x.id !== p.id)))
                        .catch(() => {})
                    }
                    setDeletingId(null)
                  }
                  if (e.key === 'Escape') setDeletingId(null)
                }}
                onBlur={() => setDeletingId(null)}
              />
              <div style={{ fontSize:11, color:'var(--muted)' }}>Press Enter to confirm, Esc to cancel</div>
            </div>
          ) : (
            <div key={p.id} className="history-profile" onClick={() => setSelectedId(p.id)}>
              <span>{p.username}</span>
              <button className="history-delete" onClick={(e) => { e.stopPropagation(); setDeletingId(p.id) }}>✕</button>
            </div>
          )
        ))
      )}
    </div>
  )
}

function PlayerField({ label, value, onChange, disabled, onEnter }) {
  const [profiles, setProfiles] = useState([])
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    fetch('/api/profiles').then((r) => r.json()).then((list) => {
      const loaded = (list || []).filter((p) => !/^player\s?\d+$/i.test(p.username))
      setProfiles(loaded)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (profiles.length > 0) {
      setCreating(value ? !profiles.some(p => p.username === value) : false)
    }
  }, [value, profiles])

  return (
    <div className="field">
      <label>{label}</label>
      <div className="profile-picker">
        <select
          value={creating ? '__new__' : (value && !creating ? value : '')}
          onChange={(e) => {
            if (e.target.value === '__new__') {
              setCreating(true)
              onChange('')
            } else {
              setCreating(false)
              onChange(e.target.value)
            }
          }}
          disabled={disabled}
        >
          <option value="">Select...</option>
          {value && !profiles.some(p => p.username === value) && (
            <option value={value}>{value}</option>
          )}
          {profiles.map((p) => (
            <option key={p.id} value={p.username}>{p.username}</option>
          ))}
          <option value="__new__">+ Create new</option>
        </select>
      </div>
      {creating && (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter name"
          disabled={disabled}
          autoFocus
          style={{ marginTop: 6 }}
          onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
        />
      )}
    </div>
  )
}

export default function ConnectionUI({ onConnect, onConnectLocal, error, isSubmitting }) {
  const [mode, setMode] = useState('menu')
  const [username, setUsername] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [joining, setJoining] = useState(false)
  const [player1, setPlayer1] = useState('ashmeet')
  const [player2, setPlayer2] = useState('sheldon')
  const [timePreset, setTimePreset] = useState('30')
  const [timeCustom, setTimeCustom] = useState('')
  const [roundPreset, setRoundPreset] = useState('2')
  const [roundCustom, setRoundCustom] = useState('')

  const getTimeLimit = () => {
    if (timePreset !== 'custom') return parseInt(timePreset, 10)
    const n = parseInt(timeCustom, 10)
    return Number.isInteger(n) && n >= 10 && n <= 120 ? n : 60
  }
  const getRounds = () => {
    if (roundPreset !== 'custom') return parseInt(roundPreset, 10)
    const n = parseInt(roundCustom, 10)
    return Number.isInteger(n) && n <= 20 ? n : 5
  }

  const handleCreate = () => {
    if (!username.trim() || isSubmitting) return
    onConnect({ type: 'create', username: username.trim() })
  }

  const handleJoin = () => {
    if (!username.trim() || !roomCode.trim() || isSubmitting) return
    onConnect({ type: 'join', username: username.trim(), roomCode: roomCode.trim().toUpperCase() })
  }

  const handleLocalStart = () => {
    if (isSubmitting) return
    const p1 = player1.trim()
    const p2 = player2.trim()
    if (!p1 || !p2) return
    if (p1 === p2) return
    onConnectLocal({ player1: p1, player2: p2, rounds: getRounds(), timeLimit: getTimeLimit() })
  }

  const settingsFields = (
    <>
      <div className="field">
        <label>Time Limit</label>
        <select value={timePreset} onChange={(e) => setTimePreset(e.target.value)} disabled={isSubmitting}>
          {TIME_PRESETS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label} sec</option>
          ))}
        </select>
        {timePreset === 'custom' && (
          <input type="text" inputMode="numeric" value={timeCustom} onChange={(e) => setTimeCustom(e.target.value.replace(/\D/g, ''))} placeholder="10-120" disabled={isSubmitting} style={{ marginTop: 6 }} />
        )}
      </div>
      <div className="field">
        <label>Rounds</label>
        <select value={roundPreset} onChange={(e) => setRoundPreset(e.target.value)} disabled={isSubmitting}>
          {ROUND_PRESETS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label} rounds</option>
          ))}
        </select>
        {roundPreset === 'custom' && (
          <input type="text" inputMode="numeric" value={roundCustom} onChange={(e) => setRoundCustom(e.target.value.replace(/\D/g, ''))} placeholder="1-20" disabled={isSubmitting} style={{ marginTop: 6 }} />
        )}
      </div>
    </>
  )

  if (mode === 'menu') {
    return (
      <div className="screen menu-screen">
        <div className="menu-title">Duniya Guessr</div>
        <button className="menu-btn" onClick={() => setMode('local')}>
          <span>Local Game</span>
          <span style={{ color:'var(--muted)' }}>&rarr;</span>
        </button>
        <button className="menu-btn" onClick={() => setMode('online')}>
          <span>Online Game</span>
          <span style={{ color:'var(--muted)' }}>&rarr;</span>
        </button>
        <button className="menu-history" onClick={() => setMode('history')}>History</button>
      </div>
    )
  }

  if (mode === 'local') {
    return (
      <div className="screen setup-screen">
        <div className="setup-card">
          <h2>Local Game</h2>
          <PlayerField label="Player 1" value={player1} onChange={setPlayer1} disabled={isSubmitting} onEnter={() => {
            const inputs = document.querySelectorAll('.setup-card input')
            if (inputs.length > 1) inputs[1]?.focus()
          }} />
          <PlayerField label="Player 2" value={player2} onChange={setPlayer2} disabled={isSubmitting} onEnter={handleLocalStart} />
          {(!player1.trim() || !player2.trim()) ? (
            <div className="error-msg">Both names required</div>
          ) : player1.trim() === player2.trim() ? (
            <div className="error-msg">Names must be different</div>
          ) : null}
          {error && <div className="error-msg">{error}</div>}
          {settingsFields}
          <div className="btn-row btn-row-local">
            <button className="btn" onClick={() => setMode('menu')} disabled={isSubmitting}>Back</button>
            <button className="btn btn-primary" onClick={handleLocalStart} disabled={isSubmitting}>
              {isSubmitting ? 'Starting...' : 'Start'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (mode === 'online') {
    return (
      <div className="screen setup-screen">
        <div className="setup-card">
          <button onClick={() => { setMode('menu'); setJoining(false) }} style={{ background:'none', border:'none', color:'var(--muted)', cursor:'pointer', fontSize:12, letterSpacing:1, padding:0, marginBottom:24 }}>&larr; Back</button>
          <h2>Online Game</h2>
          <PlayerField label="Username" value={username} onChange={setUsername} disabled={isSubmitting} onEnter={joining ? handleJoin : handleCreate} />
          {joining && (
            <div className="field">
              <label>Room Code</label>
              <input value={roomCode} onChange={(e) => setRoomCode(e.target.value.toUpperCase())} placeholder="ABCD" maxLength={4} disabled={isSubmitting} onKeyDown={(e) => e.key === 'Enter' && handleJoin()} />
            </div>
          )}
          {error && <div className="error-msg">{error}</div>}
          <div className="btn-row">
            {joining ? (
              <>
                <button className="btn" onClick={() => setJoining(false)} disabled={isSubmitting}>Back</button>
                <button className="btn btn-primary" onClick={handleJoin} disabled={isSubmitting}>Join</button>
              </>
            ) : (
              <>
                <button className="btn btn-primary" onClick={handleCreate} disabled={isSubmitting}>Create Room</button>
                <button className="btn" onClick={() => setJoining(true)} disabled={isSubmitting}>Join Room</button>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (mode === 'history') {
    return (
      <div className="screen history-screen" style={{ alignItems:'center', justifyContent:'center' }}>
        <HistoryView />
        <button onClick={() => setMode('menu')} className="history-back" style={{ position:'fixed', top:12, left:16 }}>&larr; Menu</button>
      </div>
    )
  }

  return null
}
