export function StatTile({
  label,
  value,
  definition,
}: {
  label: string
  value: string | number
  definition: string
}) {
  return (
    <div className='min-w-0 rounded-md border p-3'>
      <div className='text-xs text-muted-foreground'>{label}</div>
      <div className='text-xl font-semibold tabular-nums'>{value}</div>
      <p className='text-xs text-muted-foreground'>{definition}</p>
    </div>
  )
}
