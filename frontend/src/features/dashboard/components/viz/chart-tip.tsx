export function ChartTip({ title, body }: { title: string; body: string }) {
  return (
    <div
      style={{
        background: 'var(--tip-bg)',
        color: 'var(--tip-fg)',
        fontSize: 14,
        padding: '6px 8px',
        borderRadius: 6,
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      <div style={{ fontWeight: 600 }}>{title}</div>
      <div style={{ fontWeight: 400 }}>{body}</div>
    </div>
  )
}
