import { useState, useEffect, useRef, useCallback } from 'react'

export default function useTimer() {
  const [timeLeft, setTimeLeft] = useState(null)
  const [isRunning, setIsRunning] = useState(false)
  const intervalRef = useRef(null)

  const stop = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = null
    setIsRunning(false)
  }, [])

  const start = useCallback((seconds) => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    setTimeLeft(seconds)
    setIsRunning(true)
  }, [])

  const reset = useCallback(() => {
    stop()
    setTimeLeft(null)
  }, [stop])

  useEffect(() => {
    if (!isRunning) return

    intervalRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev === null) return null
        if (prev <= 1) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
          setIsRunning(false)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [isRunning])

  return { timeLeft, isRunning, start, stop, reset }
}
