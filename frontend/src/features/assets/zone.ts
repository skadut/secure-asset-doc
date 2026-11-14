import type { Asset, PurdueLevel } from '@/data/grc'

// Mirrors backend nextId: max AST-NNNN + 1, padded to 4. Preview only.
export function previewAssetId(ids: string[]): string {
  const max = ids.reduce((m, id) => {
    const match = /^AST-(\d+)$/.exec(id)
    return match ? Math.max(m, Number(match[1])) : m
  }, 0)
  return `AST-${String(max + 1).padStart(4, '0')}`
}

export function zoneFor(purdueLevel: PurdueLevel, type: Asset['type']): string {
  switch (purdueLevel) {
    case 'L0':
    case 'L1':
      return 'Z1 Control'
    case 'L2':
      return 'Z2 Supervisory'
    case 'L3':
      return type === 'Engineering workstation'
        ? 'Z3 Engineering'
        : 'Z2 Supervisory'
    case 'L3.5':
      return 'DMZ'
    case 'L4':
      return 'Z4 Enterprise'
  }
}
