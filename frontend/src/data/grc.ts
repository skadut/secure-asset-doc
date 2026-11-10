// FICTIONAL DEMO DATA. NOT A REAL DOCUMENT. Fictional org "Demo Defense Command", fictional bases and vendors.
// Sample rows live in src/test-utils/grc-fixture.ts (test and seed only). App data hydrates from /api/grc.

const _now = new Date();
export const TODAY: string = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;

export type Tlp = 'CLEAR' | 'GREEN' | 'AMBER' | 'AMBER+STRICT' | 'RED' | 'RED+STRICT' // FIRST TLP 2.0 (RED+STRICT is app-local, not in FIRST spec)
export type Criticality = 'high' | 'medium' | 'low'
export type Sector = 'Energy' | 'Water' | 'Telecom'
export type PurdueLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L3.5' | 'L4'

export type Asset = {
  id: string // 'AST-0001'
  name: string
  type:
    | 'PLC'
    | 'RTU'
    | 'HMI'
    | 'SCADA server'
    | 'Historian'
    | 'Engineering workstation'
    | 'Firewall'
    | 'Switch'
    | 'Data diode'
  site: string
  sector: Sector
  purdueLevel: PurdueLevel
  zone: string // IEC 62443 zone, e.g. 'Z2 Supervisory'
  vendor: string
  model: string
  firmware: string
  ipAddress: string // use 10.x private IPs
  criticality: Criticality
  owner: string
  lastReviewed: string // ISO date
  status: 'active' | 'maintenance' | 'retired'
}

export type DocFile = { name: string; mime: 'application/pdf' | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; url: string } // url like '/api/files/DOC-0001/3.0'

export type DocVersion = {
  version: string
  date: string
  author: string
  summary: string
  approvedBy?: string
  file?: DocFile // current version only
}

export type Document = {
  id: string // 'DOC-0001'
  title: string
  type:
    | 'Policy'
    | 'Procedure'
    | 'Network diagram'
    | 'Risk assessment'
    | 'Incident response plan'
    | 'Configuration baseline'
    | 'Audit report'
    | 'Personnel roster'
    | 'Installation register'
    | 'Equipment register'
  tlp: Tlp
  status: 'draft' | 'in review' | 'approved' | 'expired'
  owner: string
  approver: string
  nextReview: string // ISO date
  versions: DocVersion[] // newest first, >= 1 entry; approved docs have approvedBy on the current version
  locked?: false
  granted?: boolean
  tokenOnly?: boolean
}

export type LockedDocument = {
  id: string
  tlp: Tlp
  locked: true
  title: string
  versions: { version: string; file?: { name: string } }[]
}

export type CsfFunction = 'GV' | 'ID' | 'PR' | 'DE' | 'RS' | 'RC'
export type CsfSubcategory = {
  id: string
  fn: CsfFunction
  category: string
  categoryName: string
  outcome: string
}
export type EvidenceLink = {
  subcategoryId: string
  documentId?: string
  assetId?: string
  note: string
}
export type AssetDocLink = { assetId: string; documentId: string }
export type AuditEvent = {
  id: string
  at: string // ISO datetime
  actor: string
  action: 'create' | 'update' | 'approve' | 'link' | 'unlink' | 'export' | 'delete' | 'access.denied' | 'purge' | 'derive'
  objectType: 'asset' | 'document' | 'evidence' | 'upload' | 'user' | 'audit'
  objectId: string
  summary: string
  changes?: { field: string; from: string; to: string }[]
}

export const CSF_FUNCTIONS: Record<CsfFunction, string> = {
  GV: 'Govern',
  ID: 'Identify',
  PR: 'Protect',
  DE: 'Detect',
  RS: 'Respond',
  RC: 'Recover',
}

// Hydrated from /api/grc at app load (main.tsx). Empty in source so no sample data ships in the bundle.
export const csfSubcategories: CsfSubcategory[] = []
export const assets: Asset[] = []
export const documents: Document[] = []
export const lockedDocuments: LockedDocument[] = []
export const assetDocLinks: AssetDocLink[] = []
export const evidenceLinks: EvidenceLink[] = []
export const auditEvents: AuditEvent[] = []
