export type Me = {
  id: string | number
  username: string
  name: string
  rank: string
  rankName: string
  golongan:
    | 'PATI'
    | 'PAMEN'
    | 'PAMA'
    | 'Bintara Tinggi'
    | 'Bintara'
    | 'Tamtama Kepala'
    | 'Tamtama'
  tlpMax: 'CLEAR' | 'GREEN' | 'AMBER' | 'AMBER+STRICT' | 'RED' | 'RED+STRICT'
  accessLevel: 1 | 2 | 3 | 4 | 5
  securityOfficer: boolean
  superAdmin: boolean
  unit: string | null
  unitHead: boolean
  ownerLabel: string | null
  can: {
    upload: { c: boolean; r: boolean; u: boolean; d: boolean }
    document: {
      c: boolean
      r: boolean
      u: boolean
      approve: boolean
      d: boolean
      uDraftOnly: boolean
    }
    asset: { c: boolean; r: boolean; u: boolean; uOwn: boolean; d: boolean }
    account: { c: boolean; r: boolean; u: boolean; d: boolean }
    version: { c: boolean }
    audit?: { purge: boolean }
    access?: {
      grant: boolean
      request: boolean
      approve: boolean
      revoke: boolean
    }
  }
}

let me: Me | null = null

export function getMe(): Me | null {
  return me
}

export function setMe(m: Me | null): void {
  me = m
}

export function goHome(): void {
  window.location.assign('/')
}
