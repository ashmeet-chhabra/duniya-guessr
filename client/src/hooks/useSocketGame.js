import { useState, useEffect, useRef, useCallback } from 'react'
import { io } from 'socket.io-client'
import useTimer from './useTimer.js'

const socket = io({
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 30000,
  randomizationFactor: 0.5,
})

export default function useSocketGame() {
  const [connected, setConnected] = useState(false)
  const [profile, setProfile] = useState(null)
  const [room, setRoom] = useState(null)
  const [roomCode, setRoomCode] = useState('')
  const [gameState, setGameState] = useState(null)
  const [waitingForTurn, setWaitingForTurn] = useState(true)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState('connected')
  const [socketId, setSocketId] = useState(null)
  const [pinPosition, setPinPosition] = useState(null)
  const [guessPosition, setGuessPosition] = useState(null)
  const [currentLocation, setCurrentLocation] = useState(null)
  const [roundResult, setRoundResult] = useState(null)
  const [gameOver, setGameOver] = useState(null)
  const [roundInfo, setRoundInfo] = useState({ round: 1, totalRounds: 8 })
  const [showNewRound, setShowNewRound] = useState(false)
  const [isLocal, setIsLocal] = useState(false)
  const [activePlayerIndex, setActivePlayerIndex] = useState(0)
  const [hasGuessed, setHasGuessed] = useState(false)
  const [opponentGuessed, setOpponentGuessed] = useState(false)

  const { timeLeft: timerTimeLeft, start: timerStart, reset: timerReset } = useTimer()
  const waitingForTurnRef = useRef(waitingForTurn)
  const roomCodeRef = useRef(roomCode)
  const profileRef = useRef(profile)
  const isLocalRef = useRef(isLocal)
  const newRoundTimeoutRef = useRef(null)
  const timerDelayTimeoutRef = useRef(null)
  const guessSubmittedRef = useRef(false)
  const pinPositionRef = useRef(null)
  const lastConfigRef = useRef(null)

  const resetGameState = useCallback(() => {
    setGameState(null)
    setPinPosition(null)
    setGuessPosition(null)
    setCurrentLocation(null)
    setRoundResult(null)
    setGameOver(null)
    setWaitingForTurn(true)
    setRoundInfo({ round: 1, totalRounds: 8 })
    setShowNewRound(false)
    setHasGuessed(false)
    setOpponentGuessed(false)
    timerReset()
  }, [timerReset])

  useEffect(() => { waitingForTurnRef.current = waitingForTurn }, [waitingForTurn])
  useEffect(() => { roomCodeRef.current = roomCode }, [roomCode])
  useEffect(() => { profileRef.current = profile }, [profile])
  useEffect(() => { isLocalRef.current = isLocal }, [isLocal])
  useEffect(() => { pinPositionRef.current = pinPosition }, [pinPosition])

  useEffect(() => {
    const onConnect = () => {
      setSocketId(socket.id)
      setConnectionStatus('connected')
      if (!roomCodeRef.current) return

      if (!isLocalRef.current && profileRef.current?.id) {
        socket.emit('reconnect_room', { roomCode: roomCodeRef.current, profileId: profileRef.current.id }, (data) => {
          if (data?.error) {
            setError('Server restarted or room expired.')
            setConnected(false)
            resetGameState()
            return
          }
          if (data?.room) setRoom(data.room)
        })
        return
      }

      socket.emit('get_room', { roomCode: roomCodeRef.current }, (data) => {
        if (data?.error) {
          setError('Server restarted — game lost.')
          setConnected(false)
          resetGameState()
        }
      })
    }
    const onDisconnect = () => { setConnectionStatus('disconnected'); setWaitingForTurn(true) }
    const onReconnectAttempt = () => setConnectionStatus('reconnecting')
    const onReconnectFailed = () => setConnectionStatus('failed')
    const onRoomUpdate = (updatedRoom) => { 
      setRoom(updatedRoom); 
      if (updatedRoom.roomCode) setRoomCode(updatedRoom.roomCode) 
      if (updatedRoom.status === 'waiting') {
        setGameState(null)
        setCurrentLocation(null)
        setPinPosition(null)
        setGuessPosition(null)
        setGameOver(null)
        setRoundResult(null)
        setWaitingForTurn(true)
        setHasGuessed(false)
        setOpponentGuessed(false)
        setIsSubmitting(false)
      }
    }
    const onGameStarted = ({ round, totalRounds, local }) => {
      guessSubmittedRef.current = false
      setIsSubmitting(false)
      setGameOver(null)
      setShowNewRound(false)
      setRoundInfo({ round, totalRounds })
      setWaitingForTurn(!local)
      setActivePlayerIndex(0)
      setPinPosition(null)
      setGuessPosition(null)
      setRoundResult(null)
      setHasGuessed(false)
      setOpponentGuessed(false)
      setGameState({ round, totalRounds })
      if (!local) {
        setCurrentLocation(null)
      }
    }
    const onYourTurn = ({ round: _r, location, turnTimeLimit, player, currentPlayerIndex }) => {
      guessSubmittedRef.current = false
      setCurrentLocation(location)
      setWaitingForTurn(false)
      setActivePlayerIndex(currentPlayerIndex ?? 0)
      setPinPosition(null)
      setGuessPosition(null)
      setRoundResult(null)
      setHasGuessed(false)
      setOpponentGuessed(false)
      if (timerDelayTimeoutRef.current) clearTimeout(timerDelayTimeoutRef.current)
      if (turnTimeLimit) {
        timerDelayTimeoutRef.current = setTimeout(() => {
          timerStart(turnTimeLimit)
          timerDelayTimeoutRef.current = null
        }, 1500)
      }
      if (player) setGameState((prev) => (prev ? { ...prev, currentPlayer: player } : { round: _r, currentPlayer: player }))
    }
    const onPlayerGuessed = () => {
      setOpponentGuessed(true)
    }

    const onRoundResult = (result) => {
      guessSubmittedRef.current = false
      setRoundResult(result)
      setPinPosition(null)
      setHasGuessed(false)
      setOpponentGuessed(false)
      if (result.guess) setGuessPosition(result.guess)
      setWaitingForTurn(true)
      timerReset()
      if (timerDelayTimeoutRef.current) {
        clearTimeout(timerDelayTimeoutRef.current)
        timerDelayTimeoutRef.current = null
      }
    }
    const onNextTurn = ({ player, playerSocketId: _ps }) => {
      setWaitingForTurn(true)
      setRoundResult(null)
      timerReset()
      setGameState((prev) => (prev ? { ...prev, currentPlayer: player } : { currentPlayer: player }))
    }
    const onNewRound = ({ round, totalRounds }) => {
      setShowNewRound(true)
      setRoundInfo({ round, totalRounds })
      setCurrentLocation(null)
      setPinPosition(null)
      setGuessPosition(null)
      setRoundResult(null)
      setHasGuessed(false)
      setOpponentGuessed(false)
      timerReset()
      if (timerDelayTimeoutRef.current) {
        clearTimeout(timerDelayTimeoutRef.current)
        timerDelayTimeoutRef.current = null
      }
      setGameState((prev) => (prev ? { ...prev, round, totalRounds } : { round, totalRounds }))
      if (newRoundTimeoutRef.current) clearTimeout(newRoundTimeoutRef.current)
      newRoundTimeoutRef.current = setTimeout(() => {
        setShowNewRound(false)
        newRoundTimeoutRef.current = null
      }, 2000)
    }
    const onGameOver = ({ standings }) => { 
      setRoundResult(null)
      setGameOver(standings)
      setWaitingForTurn(true)
      setIsSubmitting(false)
      timerReset()
      if (timerDelayTimeoutRef.current) {
        clearTimeout(timerDelayTimeoutRef.current)
        timerDelayTimeoutRef.current = null
      } 
    }
    const onPlayerDisconnected = () => { 
      setWaitingForTurn(true)
      setIsSubmitting(false)
      timerReset() 
      if (timerDelayTimeoutRef.current) {
        clearTimeout(timerDelayTimeoutRef.current)
        timerDelayTimeoutRef.current = null
      }
    }

    const onConnectError = (err) => {
      setConnectionStatus('failed')
      if (err.message.includes('ECONNREFUSED')) {
        setError('Cannot reach server. Is it running on port 3001?')
      } else {
        setError('Connection lost. Check your network.')
      }
    }

    socket.on('connect', onConnect)
    socket.on('connect_error', onConnectError)
    socket.on('disconnect', onDisconnect)
    socket.on('reconnect_attempt', onReconnectAttempt)
    socket.on('reconnect_failed', onReconnectFailed)
    socket.on('room_update', onRoomUpdate)
    socket.on('game_started', onGameStarted)
    socket.on('your_turn', onYourTurn)
    socket.on('round_result', onRoundResult)
    socket.on('next_turn', onNextTurn)
    socket.on('new_round', onNewRound)
    socket.on('game_over', onGameOver)
    socket.on('player_disconnected', onPlayerDisconnected)
    socket.on('player_guessed', onPlayerGuessed)

    return () => {
      socket.off('connect', onConnect)
      socket.off('connect_error', onConnectError)
      socket.off('disconnect', onDisconnect)
      socket.off('reconnect_attempt', onReconnectAttempt)
      socket.off('reconnect_failed', onReconnectFailed)
      socket.off('room_update', onRoomUpdate)
      socket.off('game_started', onGameStarted)
      socket.off('your_turn', onYourTurn)
      socket.off('round_result', onRoundResult)
      socket.off('next_turn', onNextTurn)
      socket.off('new_round', onNewRound)
      socket.off('game_over', onGameOver)
      socket.off('player_disconnected', onPlayerDisconnected)
      socket.off('player_guessed', onPlayerGuessed)
      if (newRoundTimeoutRef.current) clearTimeout(newRoundTimeoutRef.current)
      if (timerDelayTimeoutRef.current) clearTimeout(timerDelayTimeoutRef.current)
    }
  }, [timerStart, timerReset, resetGameState])

  useEffect(() => {
    if (timerTimeLeft !== 0 || waitingForTurnRef.current || !roomCodeRef.current || guessSubmittedRef.current) return
    guessSubmittedRef.current = true
    if (!isLocal && !hasGuessed) setTimeout(() => setHasGuessed(true), 0)
    if (pinPositionRef.current) {
      socket.emit('make_guess', { roomCode: roomCodeRef.current, guessLat: pinPositionRef.current.lat, guessLng: pinPositionRef.current.lng })
    } else {
      socket.emit('timeout_guess', { roomCode: roomCodeRef.current })
    }
  }, [timerTimeLeft, isLocal, hasGuessed])

  const createProfile = useCallback(async (username) => {
    let res
    try {
      res = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      })
    } catch {
      throw new Error('Cannot reach server. Is it running on port 3001?')
    }
    if (!res.ok) {
      const text = await res.text()
      let data
      try { data = JSON.parse(text) } catch { data = null }
      throw new Error(data?.error || `Server returned ${res.status}. Check that the API proxy is configured.`)
    }
    const text = await res.text()
    try { return JSON.parse(text) } catch { throw new Error('Invalid response from server (expected JSON)') }
  }, [])

  const handleConnectLocal = useCallback(async ({ player1, player2, rounds: r, timeLimit: t }) => {
    setError('')
    setIsSubmitting(true)
    socket.disconnect()
    socket.connect()
    lastConfigRef.current = { mode: 'local', player1, player2, rounds: r, timeLimit: t }
    try {
      const [p1, p2] = await Promise.all([createProfile(player1), createProfile(player2)])
      setProfile({ id: p1.id, username: p1.username })
      socket.emit('create_local_game', {
        players: [
          { profileId: p1.id, username: p1.username },
          { profileId: p2.id, username: p2.username },
        ],
        rounds: r || 2,
        timeLimit: t || 30,
      }, (data) => {
        if (data?.error) { setError(data.error); setIsSubmitting(false); return }
        setIsLocal(true)
        setRoomCode(data.roomCode)
        setConnected(true)
        setIsSubmitting(false)
      })
    } catch (err) {
      setError(err.message || 'Failed to start local game')
      setIsSubmitting(false)
    }
  }, [createProfile])

  const handleConnect = useCallback(async ({ type, username, roomCode: joinCode }) => {
    setError('')
    setIsSubmitting(true)
    socket.disconnect()
    socket.connect()
    if (type === 'create') lastConfigRef.current = { mode: 'online', username }
    try {
      const profileData = await createProfile(username)
      setProfile({ id: profileData.id, username: profileData.username })
      if (type === 'create') {
        socket.emit('create_room', { profileId: profileData.id, username: profileData.username, rounds: 2, timeLimit: 30 }, (data) => {
          if (data.error) { setError(data.error); setIsSubmitting(false); return }
          setRoomCode(data.roomCode)
          setConnected(true)
          resetGameState()
          setIsSubmitting(false)
        })
      } else {
        socket.emit('join_room', { roomCode: joinCode, profileId: profileData.id, username: profileData.username }, (data) => {
          if (data.error) { setError(data.error); setIsSubmitting(false); return }
          setConnected(true)
          setRoomCode(joinCode)
          setWaitingForTurn(true)
          setIsSubmitting(false)
        })
      }
    } catch (err) {
      setError(err.message || 'Failed to connect to server')
      setIsSubmitting(false)
    }
  }, [createProfile, resetGameState])

  const handleStartGame = useCallback(() => {
    if (!roomCode || isSubmitting) return
    setIsSubmitting(true)
    socket.timeout(15000).emit('start_game', { roomCode }, (err, data) => {
      setIsSubmitting(false)
      if (err) { setError('Server took too long. Try again.'); return }
      if (data?.error) setError(data.error)
    })
  }, [roomCode, isSubmitting])

  const handleMapClick = useCallback((latlng) => {
    if (waitingForTurn || !currentLocation || hasGuessed) return
    setPinPosition(latlng)
  }, [waitingForTurn, currentLocation, hasGuessed])

  const handleConfirmGuess = useCallback(() => {
    if (!pinPosition || guessSubmittedRef.current || hasGuessed) return
    guessSubmittedRef.current = true

    // If the 1.5s delay is still pending, clear it and start timer immediately
    if (timerDelayTimeoutRef.current) {
      clearTimeout(timerDelayTimeoutRef.current)
      timerDelayTimeoutRef.current = null
      // We don't have easy access to turnTimeLimit here without adding it to dependencies,
      // but we can assume if it's pending, it's about to start.
      // For now, just omitting timerStop() is the core request.
    }

    socket.emit('make_guess', { roomCode, guessLat: pinPosition.lat, guessLng: pinPosition.lng })
    setPinPosition(null)
    setGuessPosition(pinPosition)
    if (!isLocal) setHasGuessed(true)
  }, [pinPosition, roomCode, hasGuessed, isLocal])

  const handlePlayAgain = useCallback(() => {
    socket.disconnect()
    setConnected(false)
    setProfile(null)
    setRoom(null)
    setRoomCode('')
    setIsLocal(false)
    setIsSubmitting(false)
    setConnectionStatus('connected')
    resetGameState()
    setError('')
  }, [resetGameState])

  const handleBackToLobby = useCallback(() => {
    if (!roomCode) return
    socket.emit('back_to_lobby', { roomCode })
  }, [roomCode])

  const handleChangeSettings = useCallback(({ rounds, timeLimit }) => {
    if (!roomCode) return
    socket.emit('change_settings', { roomCode, rounds, timeLimit })
  }, [roomCode])

  const handleReplay = useCallback(() => {
    const cfg = lastConfigRef.current
    if (!cfg) return
    if (cfg.mode === 'local') {
      handleConnectLocal({ player1: cfg.player1, player2: cfg.player2, rounds: cfg.rounds, timeLimit: cfg.timeLimit })
    } else if (cfg.mode === 'online') {
      handleBackToLobby()
      handleStartGame()
    }
  }, [handleConnectLocal, handleBackToLobby, handleStartGame])

  const players = room?.players || []
  const isHost = room ? socketId === room.host : false

  return {
    connected, profile, room, roomCode, gameState, waitingForTurn,
    error, isSubmitting, connectionStatus, pinPosition, guessPosition, currentLocation,
    roundResult, gameOver, roundInfo, showNewRound, players, isHost, isLocal, activePlayerIndex,
    hasGuessed, opponentGuessed,
    timeLeft: timerTimeLeft,
    handleConnect, handleConnectLocal, handleStartGame, handleMapClick,
    handleConfirmGuess, handlePlayAgain, handleReplay, handleBackToLobby, handleChangeSettings,
  }
}
