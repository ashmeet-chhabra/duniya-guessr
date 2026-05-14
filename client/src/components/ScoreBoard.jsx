export default function ScoreBoard({ players, currentPlayerIndex }) {
  return (
    <div className="score-display">
      {players.map((p, i) => (
        <span key={p.profileId} style={{ marginRight: 12, fontWeight: i === currentPlayerIndex ? 'bold' : 'normal' }}>
          {p.username}: {p.score || 0}
          {i === currentPlayerIndex ? ' ←' : ''}
        </span>
      ))}
    </div>
  )
}
