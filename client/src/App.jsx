import { useState, useEffect } from 'react'
import useSocketGame from './hooks/useSocketGame.js'
import StreetView from './components/StreetView.jsx'
import MapView from './components/MapView.jsx'
import ConnectionUI from './components/ConnectionUI.jsx'

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

export default function App() {
  const [activeTab, setActiveTab] = useState('street')
  const {
    connected, profile, room, roomCode, gameState,
    waitingForTurn, error, isSubmitting, connectionStatus,
    pinPosition, guessPosition, currentLocation, roundResult, gameOver,
    roundInfo, showNewRound, players, isHost, isLocal, activePlayerIndex,
    hasGuessed, opponentGuessed,
    timeLeft, handleConnect, handleConnectLocal, handleStartGame,
    handleMapClick, handleConfirmGuess, handlePlayAgain, handleReplay,
    handleBackToLobby, handleChangeSettings,
  } = useSocketGame()

  const [timePreset, setTimePreset] = useState('30')
  const [timeCustom, setTimeCustom] = useState('')
  const [roundPreset, setRoundPreset] = useState('2')
  const [roundCustom, setRoundCustom] = useState('')

  const showMap = activeTab === 'map'
  const showStreet = activeTab === 'street'
  const gameActive = !!gameState
  const canInteract = !waitingForTurn && !!currentLocation && !hasGuessed

  useEffect(() => {
    if (roundResult) {
      setActiveTab('map')
    } else if (currentLocation) {
      setActiveTab('street')
    }
  }, [roundResult, currentLocation])

  // Sync internal preset state with room state (mostly for host initialization)
  useEffect(() => {
    if (room && isHost && !gameActive) {
      if (!TIME_PRESETS.some(p => p.value === String(room.timeLimit))) {
        setTimePreset('custom')
        setTimeCustom(String(room.timeLimit))
      } else {
        setTimePreset(String(room.timeLimit))
      }
      if (!ROUND_PRESETS.some(p => p.value === String(room.totalRounds))) {
        setRoundPreset('custom')
        setRoundCustom(String(room.totalRounds))
      } else {
        setRoundPreset(String(room.totalRounds))
      }
    }
  }, [room?.timeLimit, room?.totalRounds, isHost, gameActive])

  const handleUpdateSettings = (newRounds, newTime) => {
    const r = newRounds || (roundPreset === 'custom' ? parseInt(roundCustom, 10) : parseInt(roundPreset, 10))
    const t = newTime || (timePreset === 'custom' ? parseInt(timeCustom, 10) : parseInt(timePreset, 10))
    if (Number.isNaN(r) || Number.isNaN(t)) return
    handleChangeSettings({ rounds: r, timeLimit: t })
  }

  if (!connected) {
    return <ConnectionUI onConnect={handleConnect} onConnectLocal={handleConnectLocal} error={error} isSubmitting={isSubmitting} />
  }

  if (!room && !gameState && !gameOver) {
    return (
      <div className="screen" style={{ display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ color:'var(--muted)', fontSize:13, letterSpacing:1, textTransform:'uppercase' }}>Creating room...</div>
      </div>
    )
  }

  return (
    <>
      {/* ─── WAITING ROOM SCREEN ─── */}
      {!gameActive && room && !isLocal && (
        <div className="screen waiting-screen">
          <div className="setup-card" style={{ textAlign:'center' }}>
            <div style={{ fontFamily:'var(--mono)', fontSize:12, letterSpacing:2, color:'var(--muted)', marginBottom:16, textTransform:'uppercase' }}>Room Code</div>
            <div className="room-code-display">{roomCode}</div>
            
            {isHost && (
              <div style={{ marginTop:24, marginBottom:24 }}>
                <div style={{ fontSize:11, letterSpacing:1.5, color:'var(--muted)', marginBottom:12, textTransform:'uppercase' }}>Settings</div>
                <div style={{ display:'flex', flexDirection:'column', gap:12, maxWidth:280, margin:'0 auto' }}>
                  <div className="field" style={{ textAlign:'left', marginBottom:0 }}>
                    <label>Rounds</label>
                    <select 
                      value={roundPreset} 
                      onChange={(e) => {
                        setRoundPreset(e.target.value)
                        if (e.target.value !== 'custom') handleUpdateSettings(parseInt(e.target.value, 10), null)
                      }}
                    >
                      {ROUND_PRESETS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    {roundPreset === 'custom' && (
                      <input 
                        type="text" inputMode="numeric" value={roundCustom} 
                        onChange={(e) => setRoundCustom(e.target.value.replace(/\D/g, ''))}
                        onBlur={() => handleUpdateSettings()}
                        placeholder="1-20" style={{ marginTop: 6 }} 
                      />
                    )}
                  </div>
                  <div className="field" style={{ textAlign:'left', marginBottom:0 }}>
                    <label>Time Limit</label>
                    <select 
                      value={timePreset} 
                      onChange={(e) => {
                        setTimePreset(e.target.value)
                        if (e.target.value !== 'custom') handleUpdateSettings(null, parseInt(e.target.value, 10))
                      }}
                    >
                      {TIME_PRESETS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label} sec</option>
                      ))}
                    </select>
                    {timePreset === 'custom' && (
                      <input 
                        type="text" inputMode="numeric" value={timeCustom} 
                        onChange={(e) => setTimeCustom(e.target.value.replace(/\D/g, ''))}
                        onBlur={() => handleUpdateSettings()}
                        placeholder="10-120" style={{ marginTop: 6 }} 
                      />
                    )}
                  </div>
                </div>
              </div>
            )}

            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:11, letterSpacing:1.5, color:'var(--muted)', marginBottom:8, textTransform:'uppercase' }}>Players</div>
              {players.map((p) => (
                <div key={p.socketId} className="player-entry">
                  <span>{p.username}</span>
                  <span style={{ color:'var(--muted)', fontSize:11 }}>{p.socketId === room.host ? 'HOST' : ''}</span>
                </div>
              ))}
            </div>

            {isHost && players.length >= 2 && (
              <button className="btn btn-primary start-game-btn" onClick={handleStartGame} disabled={isSubmitting}>
                {isSubmitting ? 'Starting...' : 'Start Game'}
              </button>
            )}
            {!isHost && players.length < 2 && (
              <div style={{ color:'var(--muted)', fontSize:12, letterSpacing:1, textTransform:'uppercase', marginTop:16 }}>Waiting for host...</div>
            )}
            <button className="btn btn-leave" onClick={handlePlayAgain}>Leave Room</button>
          </div>
        </div>
      )}

      {/* ─── GAME SCREEN ─── */}
      {gameActive && (
        <div className="app" style={{ zIndex: 2 }}>
          {/* Game body */}
          <div className="game-layout">
            {/* Full-width HUD bar */}
            <div className="street-view-hud">
              <div className="hud-round">
                <span className="hud-round-label">ROUND</span>
                <span className="hud-round-num">{roundInfo.round} / {roundInfo.totalRounds}</span>
              </div>
              <div className="hud-players">
                {players.map((p, i) => {
                  const isMe = p.profileId === profile?.id
                  const guessed = isLocal ? false : (isMe ? hasGuessed : opponentGuessed)
                  const otherGuessed = isLocal ? false : (isMe ? opponentGuessed : hasGuessed)
                  const isActive = isLocal && activePlayerIndex === i
                  return (
                    <div key={p.profileId || i} className={`hud-player ${isActive ? 'active' : ''}`}>
                      <span className={`hud-player-name ${isActive ? 'active' : ''}`}>
                        {p.username}{!isLocal && guessed && !otherGuessed && <span className="hud-tick"> ✓</span>}
                      </span>
                      <span className="hud-val">{p.score || 0}</span>
                    </div>
                  )
                })}
              </div>
              <div className="hud-right">
                {connectionStatus !== 'connected' && (
                  <span style={{ color:'var(--error)', fontSize:11 }}>
                    {connectionStatus === 'reconnecting' ? 'Reconnecting...' : 'Disconnected'}
                  </span>
                )}
                {!isLocal && <span style={{ color:'var(--muted)', fontSize:11 }}>{profile?.username}</span>}
                {!isLocal && <span style={{ color:'var(--accent)', fontSize:11, fontFamily:'var(--mono)' }}>{roomCode}</span>}
                <button className="hud-quit" onClick={() => { if (confirm('Quit to menu?')) handlePlayAgain() }} title="Quit to menu">✕</button>
              </div>
            </div>

            {/* Street View */}
            <div className={`street-view-panel ${showMap ? 'street-view-hidden' : ''}`}>
              <div className="street-view-area">
                {currentLocation ? (
                  <StreetView location={currentLocation} />
                ) : (
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'var(--muted)', fontSize:13, letterSpacing:1, textTransform:'uppercase' }}>
                    {waitingForTurn && !isLocal ? 'Waiting for opponent...' : 'Your turn will start soon'}
                  </div>
                )}
                {timeLeft !== null && (
                  <div className={`timer desktop-timer ${timeLeft <= 10 ? 'timer-warning' : ''}`}>{timeLeft}</div>
                )}
              </div>
            </div>

            {/* Map Panel */}
            <div className={`map-panel ${showStreet ? 'map-panel-hidden' : ''}`}>
              <div className="map-container">
                <MapView key={String(showMap)}
                  pinPosition={pinPosition}
                  guessPosition={guessPosition}
                  actualPosition={roundResult?.actual}
                  opponentGuesses={roundResult?.opponentGuesses}
                  onMapClick={handleMapClick}
                  interactive={canInteract}
                  scrollZoom={!!roundResult || canInteract}
                  currentPlayerIndex={activePlayerIndex ?? 0}
                />
                <div className="map-overlay">
                  {roundResult ? (
                    <span>Round Complete</span>
                  ) : hasGuessed ? (
                    <span>Waiting for opponent...</span>
                  ) : waitingForTurn && isLocal ? (
                    <span>Pass device to <strong>{gameState.currentPlayer}</strong></span>
                  ) : waitingForTurn && !isLocal ? (
                    <span>Waiting for <strong>{gameState.currentPlayer}</strong> to guess...</span>
                  ) : (
                    <>
                      {pinPosition ? (
                        <>
                          <span>Pin placed</span>
                          <button className="guess-btn" onClick={handleConfirmGuess}>Guess</button>
                        </>
                      ) : (
                        <span>Click the map to drop a pin</span>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>

            {roundResult && (
              <div className="result-banner">
                <h3>{roundResult.player}'s Result</h3>
                <div className="result-grid">
                  <div className="result-cell">
                    <div className="result-cell-label">Your Guess</div>
                    <div className="result-cell-country" style={{ color: roundResult.timedOut ? 'var(--error)' : (roundResult.countryCorrect ? 'var(--success)' : 'var(--error)') }}>
                      {roundResult.timedOut ? 'TIMED OUT' : (roundResult.guessedCountry || 'Unknown')}
                    </div>

                    {!roundResult.timedOut && roundResult.distanceKm !== null && (
                      <div className="result-cell-sub">
                        Distance: <strong style={{ color:'var(--text)' }}>{roundResult.distanceKm} km</strong>
                      </div>
                    )}
                  </div>
                  <div className="result-cell">
                    <div className="result-cell-label">Correct Location</div>
                    <div className="result-cell-country" style={{ color:'var(--success)' }}>{roundResult.actualCountry || 'Unknown'}</div>
                  </div>
                </div>
                <div className="result-score-container">
                  <div className="result-score-label">Points Earned</div>
                  <div className="result-score">{roundResult.score}</div>
                </div>
              </div>
            )}

            {timeLeft !== null && (
              <div className={`timer mobile-timer ${timeLeft <= 10 ? 'timer-warning' : ''}`}>{timeLeft}</div>
            )}
          </div>

          {/* Tab bar (mobile) */}
          <div className="tab-bar">
            <button className={`tab ${showStreet ? 'tab-active' : ''}`} onClick={() => setActiveTab('street')}>Explore</button>
            <button className={`tab ${showMap ? 'tab-active' : ''}`} onClick={() => setActiveTab('map')}>Map</button>
            <button className="tab tab-quit" onClick={() => { if (confirm('Quit to menu?')) handlePlayAgain() }}>✕</button>
          </div>
        </div>
      )}

      {/* ─── GAME OVER SCREEN ─── */}
      {gameOver && (
        <div className="screen gameover-screen" style={{ zIndex: 3 }}>
          <div className="standings">
            <h2>Final Standings</h2>
            {(() => {
              const maxScore = Math.max(...gameOver.map(s => s.score))
              const maxCountries = Math.max(...gameOver.map(s => s.correctCountries))
              const minCountries = Math.min(...gameOver.map(s => s.correctCountries))

              return gameOver.map((s, i) => (
                <div key={s.profileId} className="standing-row">
                  <span className="standing-row-rank">#{i + 1}</span>
                  <span className="standing-row-name">{s.username}</span>
                  <div className="standing-row-stats">
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '50px' }}>
                      <span style={{ fontSize: '9px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '2px' }}>Score</span>
                      <span className="standing-row-score" style={{ fontSize: '18px', color: s.score === maxScore ? 'var(--success)' : 'var(--error)' }}>{s.score}</span>
                    </div>
                    <div style={{ width: '1px', height: '24px', background: 'var(--border)' }}></div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '50px' }}>
                      <span style={{ fontSize: '9px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '2px' }}>Countries</span>
                      <span className="standing-row-score" style={{ fontSize: '14px', color: (maxCountries === minCountries) ? (s.correctCountries === 0 ? 'var(--error)' : 'var(--success)') : (s.correctCountries === maxCountries ? 'var(--success)' : 'var(--error)') }}>{s.correctCountries}</span>
                    </div>
                  </div>
                </div>
              ))
            })()}
            <div className="btn-row">
              <button className="btn" onClick={handlePlayAgain}>Menu</button>
              {(isLocal || isHost) && (
                <>
                  {isHost && !isLocal && (
                    <button className="btn" onClick={handleBackToLobby} disabled={isSubmitting}>Settings</button>
                  )}
                  <button className="btn btn-primary" onClick={handleReplay} disabled={isSubmitting}>
                    {isSubmitting ? 'Starting...' : 'Play Again'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
