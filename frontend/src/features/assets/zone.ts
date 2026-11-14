import type { Asset, PurdueLevel } from '@/data/grc'

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
