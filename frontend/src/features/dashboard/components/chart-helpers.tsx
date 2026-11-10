export const docTone = {
  approved: 'var(--viz-good)',
  'in review': 'var(--viz-warning)',
  draft: 'var(--viz-neutral)',
  expired: 'var(--viz-danger)',
}
export const axis = { fontSize: 11, fill: 'var(--viz-ink)' }
// Legend text uses the ink token; only the swatch carries series colour. Order is explicit, not alphabetical.
export const legend = (order: string[]) => ({
  formatter: (value: string) => (
    <span className='text-foreground'>{value}</span>
  ),
  itemSorter: (item: { value?: unknown }) => order.indexOf(String(item.value)),
  wrapperStyle: { fontSize: 11 },
})
export const grid = 'var(--viz-grid)'
