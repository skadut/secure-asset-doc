// SAMPLE DATA ONLY. Not real records. Fictional org "Sample Grid Co" and fictional vendors.

export const TODAY = '2026-10-21' // ponytail: fixed date keeps sample statuses deterministic; use new Date() with real data

export type Tlp = 'CLEAR' | 'GREEN' | 'AMBER' | 'AMBER+STRICT' | 'RED' // FIRST TLP 2.0
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

export type DocVersion = {
  version: string
  date: string
  author: string
  summary: string
  approvedBy?: string
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
  tlp: Tlp
  status: 'draft' | 'in review' | 'approved' | 'expired'
  owner: string
  approver: string
  nextReview: string // ISO date
  versions: DocVersion[] // newest first, >= 1 entry; approved docs have approvedBy on the current version
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
  action: 'create' | 'update' | 'approve' | 'link' | 'unlink' | 'export' | 'delete'
  objectType: 'asset' | 'document' | 'evidence'
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

export const csfSubcategories: CsfSubcategory[] = [
  { id: 'GV.OC-01', fn: 'GV', category: 'GV.OC', categoryName: 'Organizational Context', outcome: 'The organizational mission is understood and informs cybersecurity risk management' },
  { id: 'GV.RM-01', fn: 'GV', category: 'GV.RM', categoryName: 'Risk Management Strategy', outcome: 'Risk management objectives are established and agreed to by organizational stakeholders' },
  { id: 'GV.RR-02', fn: 'GV', category: 'GV.RR', categoryName: 'Roles, Responsibilities, and Authorities', outcome: 'Roles, responsibilities, and authorities related to cybersecurity risk management are established, communicated, understood, and enforced' },
  { id: 'GV.PO-01', fn: 'GV', category: 'GV.PO', categoryName: 'Policy', outcome: 'Policy for managing cybersecurity risks is established based on organizational context, cybersecurity strategy, and priorities and is communicated and enforced' },
  { id: 'GV.SC-07', fn: 'GV', category: 'GV.SC', categoryName: 'Cybersecurity Supply Chain Risk Management', outcome: 'The risks posed by a supplier, their products and services, and other third parties are understood, recorded, prioritized, assessed, responded to, and monitored over the course of the relationship' },
  { id: 'ID.AM-01', fn: 'ID', category: 'ID.AM', categoryName: 'Asset Management', outcome: 'Inventories of hardware managed by the organization are maintained' },
  { id: 'ID.AM-02', fn: 'ID', category: 'ID.AM', categoryName: 'Asset Management', outcome: 'Inventories of software, services, and systems managed by the organization are maintained' },
  { id: 'ID.AM-03', fn: 'ID', category: 'ID.AM', categoryName: 'Asset Management', outcome: "Representations of the organization's authorized network communication and internal and external network data flows are maintained" },
  { id: 'ID.RA-01', fn: 'ID', category: 'ID.RA', categoryName: 'Risk Assessment', outcome: 'Vulnerabilities in assets are identified, validated, and recorded' },
  { id: 'ID.RA-05', fn: 'ID', category: 'ID.RA', categoryName: 'Risk Assessment', outcome: 'Threats, vulnerabilities, likelihoods, and impacts are used to understand inherent risk and inform risk response prioritization' },
  { id: 'PR.AA-01', fn: 'PR', category: 'PR.AA', categoryName: 'Identity Management, Authentication, and Access Control', outcome: 'Identities and credentials for authorized users, services, and hardware are managed by the organization' },
  { id: 'PR.AA-05', fn: 'PR', category: 'PR.AA', categoryName: 'Identity Management, Authentication, and Access Control', outcome: 'Access permissions, entitlements, and authorizations are defined in a policy, managed, enforced, and reviewed, and incorporate the principles of least privilege and separation of duties' },
  { id: 'PR.DS-01', fn: 'PR', category: 'PR.DS', categoryName: 'Data Security', outcome: 'The confidentiality, integrity, and availability of data-at-rest are protected' },
  { id: 'PR.PS-01', fn: 'PR', category: 'PR.PS', categoryName: 'Platform Security', outcome: 'Configuration management practices are established and applied' },
  { id: 'PR.IR-01', fn: 'PR', category: 'PR.IR', categoryName: 'Technology Infrastructure Resilience', outcome: 'Networks and environments are protected from unauthorized logical access and usage' },
  { id: 'DE.CM-01', fn: 'DE', category: 'DE.CM', categoryName: 'Continuous Monitoring', outcome: 'Networks and network services are monitored to find potentially adverse events' },
  { id: 'DE.AE-02', fn: 'DE', category: 'DE.AE', categoryName: 'Adverse Event Analysis', outcome: 'Potentially adverse events are analyzed to better understand associated activities' },
  { id: 'RS.MA-01', fn: 'RS', category: 'RS.MA', categoryName: 'Incident Management', outcome: 'The incident response plan is executed in coordination with relevant third parties once an incident is declared' },
  { id: 'RS.CO-02', fn: 'RS', category: 'RS.CO', categoryName: 'Incident Response Reporting and Communication', outcome: 'Internal and external stakeholders are notified of incidents' },
  { id: 'RC.RP-01', fn: 'RC', category: 'RC.RP', categoryName: 'Incident Recovery Plan Execution', outcome: 'The recovery portion of the incident response plan is executed once initiated from the incident response process' },
  { id: 'RC.CO-03', fn: 'RC', category: 'RC.CO', categoryName: 'Incident Recovery Communication', outcome: 'Recovery activities and progress in restoring operational capabilities are communicated to designated internal and external stakeholders' },
]

export const assets: Asset[] = [
  { id: 'AST-0001', name: 'Intake Pump PLC 1', type: 'PLC', site: 'North Pumping Station', sector: 'Water', purdueLevel: 'L1', zone: 'Z1 Control', vendor: 'Northgate Controls', model: 'NC-500', firmware: '3.2.1', ipAddress: '10.20.1.11', criticality: 'high', owner: 'OT Engineering', lastReviewed: '2026-09-02', status: 'active' },
  { id: 'AST-0002', name: 'Intake Pump HMI', type: 'HMI', site: 'North Pumping Station', sector: 'Water', purdueLevel: 'L2', zone: 'Z2 Supervisory', vendor: 'Northgate Controls', model: 'NC-HMI-10', firmware: '5.0.4', ipAddress: '10.20.2.21', criticality: 'medium', owner: 'Plant Operations', lastReviewed: '2026-08-14', status: 'active' },
  { id: 'AST-0003', name: 'Water SCADA Server A', type: 'SCADA server', site: 'Central Control Room', sector: 'Water', purdueLevel: 'L3', zone: 'Z2 Supervisory', vendor: 'Ridgeway Automation', model: 'RA-SRV-400', firmware: '7.1.0', ipAddress: '10.20.3.5', criticality: 'high', owner: 'OT Engineering', lastReviewed: '2026-10-01', status: 'active' },
  { id: 'AST-0004', name: 'Water Historian', type: 'Historian', site: 'Central Control Room', sector: 'Water', purdueLevel: 'L3', zone: 'Z2 Supervisory', vendor: 'Ridgeway Automation', model: 'RA-HIST-2', firmware: '4.8.2', ipAddress: '10.20.3.8', criticality: 'medium', owner: 'Data Services', lastReviewed: '2026-07-22', status: 'active' },
  { id: 'AST-0005', name: 'Water Engineering Workstation', type: 'Engineering workstation', site: 'Central Control Room', sector: 'Water', purdueLevel: 'L3', zone: 'Z3 Engineering', vendor: 'Halcyon Networks', model: 'HN-EWS-1', firmware: '2.4.0', ipAddress: '10.20.3.30', criticality: 'high', owner: 'OT Engineering', lastReviewed: '2026-06-30', status: 'maintenance' },
  { id: 'AST-0006', name: 'Water Zone Firewall', type: 'Firewall', site: 'Central Control Room', sector: 'Water', purdueLevel: 'L3.5', zone: 'DMZ', vendor: 'Halcyon Networks', model: 'HN-FW-220', firmware: '9.3.2', ipAddress: '10.20.0.1', criticality: 'high', owner: 'Network Security', lastReviewed: '2026-09-18', status: 'active' },
  { id: 'AST-0007', name: 'Water Data Diode', type: 'Data diode', site: 'Central Control Room', sector: 'Water', purdueLevel: 'L3.5', zone: 'DMZ', vendor: 'Halcyon Networks', model: 'HN-DD-3', firmware: '1.6.0', ipAddress: '10.20.0.2', criticality: 'high', owner: 'Network Security', lastReviewed: '2026-05-10', status: 'active' },
  { id: 'AST-0008', name: 'Reservoir RTU 4', type: 'RTU', site: 'East Reservoir', sector: 'Water', purdueLevel: 'L1', zone: 'Z1 Control', vendor: 'Ridgeway Automation', model: 'RA-RTU-60', firmware: '2.0.7', ipAddress: '10.20.4.14', criticality: 'medium', owner: 'Field Maintenance', lastReviewed: '2026-04-19', status: 'active' },
  { id: 'AST-0009', name: 'Substation Switch 1', type: 'Switch', site: 'Ridge Substation', sector: 'Energy', purdueLevel: 'L2', zone: 'Z2 Supervisory', vendor: 'Halcyon Networks', model: 'HN-SW-48', firmware: '12.0.3', ipAddress: '10.30.2.2', criticality: 'high', owner: 'Network Operations', lastReviewed: '2026-09-25', status: 'active' },
  { id: 'AST-0010', name: 'Substation RTU 1', type: 'RTU', site: 'Ridge Substation', sector: 'Energy', purdueLevel: 'L1', zone: 'Z1 Control', vendor: 'Northgate Controls', model: 'NC-RTU-8', firmware: '4.1.0', ipAddress: '10.30.1.10', criticality: 'high', owner: 'Grid Operations', lastReviewed: '2026-08-30', status: 'active' },
  { id: 'AST-0011', name: 'Substation RTU 2', type: 'RTU', site: 'Ridge Substation', sector: 'Energy', purdueLevel: 'L1', zone: 'Z1 Control', vendor: 'Northgate Controls', model: 'NC-RTU-8', firmware: '4.0.2', ipAddress: '10.30.1.11', criticality: 'high', owner: 'Grid Operations', lastReviewed: '2026-03-12', status: 'active' },
  { id: 'AST-0012', name: 'Substation Historian', type: 'Historian', site: 'Ridge Substation', sector: 'Energy', purdueLevel: 'L3', zone: 'Z2 Supervisory', vendor: 'Ridgeway Automation', model: 'RA-HIST-2', firmware: '4.7.9', ipAddress: '10.30.3.8', criticality: 'medium', owner: 'Data Services', lastReviewed: '2026-06-01', status: 'active' },
  { id: 'AST-0013', name: 'Energy SCADA Server', type: 'SCADA server', site: 'Harbor Operations Center', sector: 'Energy', purdueLevel: 'L3', zone: 'Z2 Supervisory', vendor: 'Ridgeway Automation', model: 'RA-SRV-400', firmware: '7.1.0', ipAddress: '10.30.3.5', criticality: 'high', owner: 'Grid Operations', lastReviewed: '2026-09-29', status: 'active' },
  { id: 'AST-0014', name: 'Harbor Engineering Workstation', type: 'Engineering workstation', site: 'Harbor Operations Center', sector: 'Energy', purdueLevel: 'L3', zone: 'Z3 Engineering', vendor: 'Halcyon Networks', model: 'HN-EWS-1', firmware: '2.3.1', ipAddress: '10.30.3.30', criticality: 'medium', owner: 'OT Engineering', lastReviewed: '2026-02-28', status: 'retired' },
  { id: 'AST-0015', name: 'Harbor Firewall', type: 'Firewall', site: 'Harbor Operations Center', sector: 'Energy', purdueLevel: 'L3.5', zone: 'DMZ', vendor: 'Halcyon Networks', model: 'HN-FW-220', firmware: '9.2.8', ipAddress: '10.30.0.1', criticality: 'high', owner: 'Network Security', lastReviewed: '2026-08-08', status: 'active' },
  { id: 'AST-0016', name: 'Telemetry RTU 7', type: 'RTU', site: 'Hilltop Relay Site', sector: 'Telecom', purdueLevel: 'L1', zone: 'Z1 Control', vendor: 'Northgate Controls', model: 'NC-RTU-4', firmware: '3.0.0', ipAddress: '10.40.1.7', criticality: 'medium', owner: 'Field Maintenance', lastReviewed: '2026-05-27', status: 'active' },
  { id: 'AST-0017', name: 'Relay Site PLC', type: 'PLC', site: 'Hilltop Relay Site', sector: 'Telecom', purdueLevel: 'L1', zone: 'Z1 Control', vendor: 'Northgate Controls', model: 'NC-500', firmware: '3.1.4', ipAddress: '10.40.1.20', criticality: 'medium', owner: 'Network Operations', lastReviewed: '2026-07-04', status: 'active' },
  { id: 'AST-0018', name: 'Telecom Core Switch', type: 'Switch', site: 'Metro Exchange', sector: 'Telecom', purdueLevel: 'L2', zone: 'Z2 Supervisory', vendor: 'Halcyon Networks', model: 'HN-SW-48', firmware: '12.0.3', ipAddress: '10.40.2.2', criticality: 'high', owner: 'Network Operations', lastReviewed: '2026-10-05', status: 'active' },
  { id: 'AST-0019', name: 'Metro Exchange Historian', type: 'Historian', site: 'Metro Exchange', sector: 'Telecom', purdueLevel: 'L3', zone: 'Z2 Supervisory', vendor: 'Ridgeway Automation', model: 'RA-HIST-2', firmware: '4.8.0', ipAddress: '10.40.3.8', criticality: 'low', owner: 'Data Services', lastReviewed: '2026-01-20', status: 'maintenance' },
  { id: 'AST-0020', name: 'Metro Exchange Firewall', type: 'Firewall', site: 'Metro Exchange', sector: 'Telecom', purdueLevel: 'L3.5', zone: 'DMZ', vendor: 'Halcyon Networks', model: 'HN-FW-220', firmware: '9.3.2', ipAddress: '10.40.0.1', criticality: 'high', owner: 'Network Security', lastReviewed: '2026-09-11', status: 'active' },
]

export const documents: Document[] = [
  { id: 'DOC-0001', title: 'OT Security Policy', type: 'Policy', tlp: 'CLEAR', status: 'approved', owner: 'CISO Office', approver: 'Executive Board', nextReview: '2027-03-01', versions: [
    { version: '3.0', date: '2026-03-01', author: 'CISO Office', summary: 'Annual review, added remote access clause', approvedBy: 'Executive Board' },
    { version: '2.1', date: '2025-03-04', author: 'CISO Office', summary: 'Scope extended to telecom sites', approvedBy: 'Executive Board' },
    { version: '2.0', date: '2024-02-12', author: 'Policy Team', summary: 'Rewrite aligned to NIST CSF 2.0 draft' },
  ] },
  { id: 'DOC-0002', title: 'Asset Inventory Procedure', type: 'Procedure', tlp: 'GREEN', status: 'approved', owner: 'OT Engineering', approver: 'CISO Office', nextReview: '2026-12-15', versions: [
    { version: '2.2', date: '2026-06-15', author: 'OT Engineering', summary: 'Added discovery sweep cadence', approvedBy: 'CISO Office' },
    { version: '2.1', date: '2025-12-15', author: 'OT Engineering', summary: 'Owner field made mandatory', approvedBy: 'CISO Office' },
  ] },
  { id: 'DOC-0003', title: 'Water Network Diagram', type: 'Network diagram', tlp: 'AMBER', status: 'approved', owner: 'Network Security', approver: 'OT Engineering', nextReview: '2026-11-20', versions: [
    { version: '4.0', date: '2026-05-20', author: 'Network Security', summary: 'Data diode added between L3 and L3.5', approvedBy: 'OT Engineering' },
    { version: '3.2', date: '2025-11-20', author: 'Network Security', summary: 'Historian relocated to Central Control Room', approvedBy: 'OT Engineering' },
    { version: '3.1', date: '2025-06-02', author: 'Network Security', summary: 'Remote engineering access path documented', approvedBy: 'OT Engineering' },
    { version: '3.0', date: '2024-09-10', author: 'Network Security', summary: 'Initial zone and conduit model' },
  ] },
  { id: 'DOC-0004', title: 'Energy Network Diagram', type: 'Network diagram', tlp: 'AMBER+STRICT', status: 'in review', owner: 'Network Security', approver: 'Grid Operations', nextReview: '2027-01-10', versions: [
    { version: '2.0', date: '2026-10-02', author: 'Network Security', summary: 'Substation switch replaced, awaiting review' },
    { version: '1.1', date: '2025-09-30', author: 'Network Security', summary: 'Harbor center firewall added', approvedBy: 'Grid Operations' },
    { version: '1.0', date: '2025-01-15', author: 'Network Security', summary: 'First release', approvedBy: 'Grid Operations' },
  ] },
  { id: 'DOC-0005', title: 'Incident Response Plan (OT)', type: 'Incident response plan', tlp: 'AMBER', status: 'approved', owner: 'CSIRT', approver: 'Executive Board', nextReview: '2026-11-30', versions: [
    { version: '5.0', date: '2026-05-30', author: 'CSIRT', summary: 'Added OT containment playbooks', approvedBy: 'Executive Board' },
    { version: '4.2', date: '2025-11-30', author: 'CSIRT', summary: 'Contact tree refreshed', approvedBy: 'Executive Board' },
    { version: '4.0', date: '2025-05-30', author: 'CSIRT', summary: 'Recovery phase expanded', approvedBy: 'Executive Board' },
  ] },
  { id: 'DOC-0006', title: 'Water Risk Assessment 2025', type: 'Risk assessment', tlp: 'AMBER+STRICT', status: 'expired', owner: 'Risk Office', approver: 'Executive Board', nextReview: '2026-06-30', versions: [
    { version: '1.3', date: '2025-06-30', author: 'Risk Office', summary: 'Pump station likelihood revised', approvedBy: 'Executive Board' },
    { version: '1.2', date: '2025-03-14', author: 'Risk Office', summary: 'Telemetry threats added', approvedBy: 'Executive Board' },
    { version: '1.1', date: '2024-12-01', author: 'Risk Office', summary: 'Initial impact scoring' },
  ] },
  { id: 'DOC-0007', title: 'Energy Risk Assessment', type: 'Risk assessment', tlp: 'AMBER+STRICT', status: 'approved', owner: 'Risk Office', approver: 'Executive Board', nextReview: '2026-10-28', versions: [
    { version: '2.1', date: '2026-04-28', author: 'Risk Office', summary: 'Substation threat model refreshed', approvedBy: 'Executive Board' },
    { version: '2.0', date: '2025-10-28', author: 'Risk Office', summary: 'Full reassessment', approvedBy: 'Executive Board' },
  ] },
  { id: 'DOC-0008', title: 'PLC Configuration Baseline (NC-500)', type: 'Configuration baseline', tlp: 'GREEN', status: 'approved', owner: 'OT Engineering', approver: 'OT Engineering', nextReview: '2026-12-01', versions: [
    { version: '3.1', date: '2026-06-01', author: 'OT Engineering', summary: 'Firmware 3.2.1 baseline', approvedBy: 'OT Engineering' },
    { version: '3.0', date: '2026-01-10', author: 'OT Engineering', summary: 'Firmware 3.1.4 baseline', approvedBy: 'OT Engineering' },
    { version: '2.0', date: '2025-04-08', author: 'OT Engineering', summary: 'Initial baseline' },
  ] },
  { id: 'DOC-0009', title: 'RTU Hardening Standard', type: 'Configuration baseline', tlp: 'GREEN', status: 'in review', owner: 'Field Maintenance', approver: 'OT Engineering', nextReview: '2027-02-02', versions: [
    { version: '1.2', date: '2026-10-10', author: 'Field Maintenance', summary: 'Serial console lockout added' },
    { version: '1.1', date: '2026-04-02', author: 'Field Maintenance', summary: 'Default credential removal', approvedBy: 'OT Engineering' },
    { version: '1.0', date: '2025-08-02', author: 'Field Maintenance', summary: 'Draft baseline', approvedBy: 'OT Engineering' },
  ] },
  { id: 'DOC-0010', title: 'Remote Access Procedure', type: 'Procedure', tlp: 'AMBER', status: 'approved', owner: 'Network Security', approver: 'CISO Office', nextReview: '2026-10-29', versions: [
    { version: '2.4', date: '2026-04-29', author: 'Network Security', summary: 'MFA enforced for vendor sessions', approvedBy: 'CISO Office' },
    { version: '2.3', date: '2025-10-29', author: 'Network Security', summary: 'Jump host requirement', approvedBy: 'CISO Office' },
    { version: '2.2', date: '2025-04-29', author: 'Network Security', summary: 'Session recording', approvedBy: 'CISO Office' },
    { version: '2.1', date: '2024-10-29', author: 'Network Security', summary: 'Vendor account expiry', approvedBy: 'CISO Office' },
    { version: '2.0', date: '2024-04-29', author: 'Network Security', summary: 'Rewrite', approvedBy: 'CISO Office' },
  ] },
  { id: 'DOC-0011', title: 'Access Review Procedure', type: 'Procedure', tlp: 'CLEAR', status: 'approved', owner: 'Identity Team', approver: 'CISO Office', nextReview: '2026-11-15', versions: [
    { version: '1.4', date: '2026-05-15', author: 'Identity Team', summary: 'Quarterly review cadence', approvedBy: 'CISO Office' },
    { version: '1.3', date: '2025-11-15', author: 'Identity Team', summary: 'Separation of duties check', approvedBy: 'CISO Office' },
    { version: '1.2', date: '2025-05-15', author: 'Identity Team', summary: 'Service accounts included', approvedBy: 'CISO Office' },
  ] },
  { id: 'DOC-0012', title: 'Historian Backup Procedure', type: 'Procedure', tlp: 'GREEN', status: 'draft', owner: 'Data Services', approver: 'OT Engineering', nextReview: '2027-04-01', versions: [
    { version: '0.3', date: '2026-10-15', author: 'Data Services', summary: 'Retention window draft' },
    { version: '0.2', date: '2026-09-01', author: 'Data Services', summary: 'Restore test steps' },
  ] },
  { id: 'DOC-0013', title: 'Telecom Vulnerability Assessment 2024', type: 'Risk assessment', tlp: 'RED', status: 'expired', owner: 'Risk Office', approver: 'Executive Board', nextReview: '2026-02-28', versions: [
    { version: '1.0', date: '2024-02-28', author: 'Risk Office', summary: 'Initial assessment', approvedBy: 'Executive Board' },
  ] },
  { id: 'DOC-0014', title: 'Quarterly Audit Report Q3 2026', type: 'Audit report', tlp: 'AMBER', status: 'in review', owner: 'Internal Audit', approver: 'Executive Board', nextReview: '2027-01-15', versions: [
    { version: '1.0', date: '2026-10-08', author: 'Internal Audit', summary: 'Findings draft for management response' },
  ] },
  { id: 'DOC-0015', title: 'Metro Exchange Incident Playbook', type: 'Incident response plan', tlp: 'AMBER', status: 'draft', owner: 'CSIRT', approver: 'CISO Office', nextReview: '2026-11-05', versions: [
    { version: '0.1', date: '2026-10-18', author: 'CSIRT', summary: 'Scaffold for telecom recovery steps' },
  ] },
  { id: 'DOC-0016', title: 'Recovery Runbook: SCADA Restore', type: 'Procedure', tlp: 'AMBER+STRICT', status: 'approved', owner: 'OT Engineering', approver: 'CSIRT', nextReview: '2026-10-25', versions: [
    { version: '2.0', date: '2026-04-25', author: 'OT Engineering', summary: 'Restore order revised for historian', approvedBy: 'CSIRT' },
    { version: '1.1', date: '2025-10-25', author: 'OT Engineering', summary: 'Backup verification step', approvedBy: 'CSIRT' },
    { version: '1.0', date: '2025-04-25', author: 'OT Engineering', summary: 'First runbook', approvedBy: 'CSIRT' },
  ] },
]

export const assetDocLinks: AssetDocLink[] = [
  { assetId: 'AST-0001', documentId: 'DOC-0008' },
  { assetId: 'AST-0001', documentId: 'DOC-0003' },
  { assetId: 'AST-0002', documentId: 'DOC-0008' },
  { assetId: 'AST-0003', documentId: 'DOC-0003' },
  { assetId: 'AST-0003', documentId: 'DOC-0016' },
  { assetId: 'AST-0004', documentId: 'DOC-0012' },
  { assetId: 'AST-0005', documentId: 'DOC-0009' },
  { assetId: 'AST-0006', documentId: 'DOC-0010' },
  { assetId: 'AST-0007', documentId: 'DOC-0003' },
  { assetId: 'AST-0007', documentId: 'DOC-0010' },
  { assetId: 'AST-0008', documentId: 'DOC-0009' },
  { assetId: 'AST-0009', documentId: 'DOC-0004' },
  { assetId: 'AST-0010', documentId: 'DOC-0007' },
  { assetId: 'AST-0010', documentId: 'DOC-0008' },
  { assetId: 'AST-0011', documentId: 'DOC-0007' },
  { assetId: 'AST-0012', documentId: 'DOC-0012' },
  { assetId: 'AST-0013', documentId: 'DOC-0004' },
  { assetId: 'AST-0013', documentId: 'DOC-0016' },
  { assetId: 'AST-0014', documentId: 'DOC-0009' },
  { assetId: 'AST-0015', documentId: 'DOC-0010' },
  { assetId: 'AST-0016', documentId: 'DOC-0013' },
  { assetId: 'AST-0017', documentId: 'DOC-0013' },
  { assetId: 'AST-0018', documentId: 'DOC-0010' },
  { assetId: 'AST-0019', documentId: 'DOC-0012' },
  { assetId: 'AST-0020', documentId: 'DOC-0015' },
  { assetId: 'AST-0020', documentId: 'DOC-0010' },
  { assetId: 'AST-0003', documentId: 'DOC-0005' },
  { assetId: 'AST-0013', documentId: 'DOC-0005' },
  { assetId: 'AST-0018', documentId: 'DOC-0005' },
  { assetId: 'AST-0006', documentId: 'DOC-0005' },
]

export const evidenceLinks: EvidenceLink[] = [
  { subcategoryId: 'GV.OC-01', documentId: 'DOC-0001', note: 'Policy scope statement' },
  { subcategoryId: 'GV.RM-01', documentId: 'DOC-0006', note: 'Water risk objectives (expired)' },
  { subcategoryId: 'GV.RM-01', documentId: 'DOC-0007', note: 'Energy risk objectives' },
  { subcategoryId: 'GV.RR-02', documentId: 'DOC-0001', note: 'Roles defined in policy' },
  { subcategoryId: 'GV.RR-02', documentId: 'DOC-0011', note: 'Access review roles' },
  { subcategoryId: 'GV.PO-01', documentId: 'DOC-0001', note: 'Current OT security policy' },
  { subcategoryId: 'GV.SC-07', documentId: 'DOC-0013', note: 'Telecom vendor review (expired, RED)' },
  { subcategoryId: 'GV.SC-07', documentId: 'DOC-0010', note: 'Vendor access controls' },
  { subcategoryId: 'ID.AM-01', assetId: 'AST-0001', note: 'Asset in inventory' },
  { subcategoryId: 'ID.AM-01', assetId: 'AST-0003', note: 'Asset in inventory' },
  { subcategoryId: 'ID.AM-03', documentId: 'DOC-0003', note: 'Water network diagram' },
  { subcategoryId: 'ID.AM-03', documentId: 'DOC-0004', note: 'Energy diagram in review, not current' },
  { subcategoryId: 'ID.RA-01', documentId: 'DOC-0006', note: 'Water vulnerability findings (expired)' },
  { subcategoryId: 'ID.RA-01', assetId: 'AST-0008', note: 'RTU scan result' },
  { subcategoryId: 'ID.RA-05', documentId: 'DOC-0007', note: 'Threat and impact scoring' },
  { subcategoryId: 'PR.AA-01', documentId: 'DOC-0011', note: 'Credential review procedure' },
  { subcategoryId: 'PR.AA-05', documentId: 'DOC-0011', note: 'Least-privilege review' },
  { subcategoryId: 'PR.AA-05', documentId: 'DOC-0010', note: 'Vendor session entitlements' },
  { subcategoryId: 'PR.PS-01', documentId: 'DOC-0008', note: 'PLC configuration baseline' },
  { subcategoryId: 'PR.PS-01', documentId: 'DOC-0009', note: 'RTU hardening draft' },
  { subcategoryId: 'PR.IR-01', documentId: 'DOC-0010', note: 'Remote access controls' },
  { subcategoryId: 'PR.IR-01', assetId: 'AST-0007', note: 'Data diode enforcing one-way flow' },
  { subcategoryId: 'DE.CM-01', assetId: 'AST-0006', note: 'Firewall logging enabled' },
  { subcategoryId: 'RS.MA-01', documentId: 'DOC-0005', note: 'Incident response plan' },
  { subcategoryId: 'RS.MA-01', documentId: 'DOC-0015', note: 'Telecom playbook draft' },
  { subcategoryId: 'RS.CO-02', documentId: 'DOC-0005', note: 'Notification contacts' },
  { subcategoryId: 'RC.RP-01', documentId: 'DOC-0016', note: 'SCADA restore runbook' },
]

export const auditEvents: AuditEvent[] = [
  { id: 'AUD-0001', at: '2026-08-03T09:12:00Z', actor: 'a.khoury', action: 'create', objectType: 'asset', objectId: 'AST-0016', summary: 'Registered telemetry RTU 7' },
  { id: 'AUD-0002', at: '2026-08-04T14:05:00Z', actor: 'j.lindqvist', action: 'update', objectType: 'asset', objectId: 'AST-0005', summary: 'Engineering workstation moved to maintenance', changes: [{ field: 'status', from: 'active', to: 'maintenance' }] },
  { id: 'AUD-0003', at: '2026-08-05T10:30:00Z', actor: 'm.ortega', action: 'update', objectType: 'document', objectId: 'DOC-0003', summary: 'Network diagram v4.0 published', changes: [{ field: 'version', from: '3.2', to: '4.0' }] },
  { id: 'AUD-0004', at: '2026-08-06T08:45:00Z', actor: 'p.nakamura', action: 'approve', objectType: 'document', objectId: 'DOC-0002', summary: 'Inventory procedure v2.2 approved' },
  { id: 'AUD-0005', at: '2026-08-07T11:20:00Z', actor: 'a.khoury', action: 'link', objectType: 'evidence', objectId: 'ID.AM-03', summary: 'Linked water network diagram to ID.AM-03' },
  { id: 'AUD-0006', at: '2026-08-08T16:02:00Z', actor: 'r.delgado', action: 'create', objectType: 'document', objectId: 'DOC-0012', summary: 'Draft historian backup procedure created' },
  { id: 'AUD-0007', at: '2026-08-10T09:00:00Z', actor: 'j.lindqvist', action: 'update', objectType: 'asset', objectId: 'AST-0001', summary: 'Firmware recorded', changes: [{ field: 'firmware', from: '3.1.4', to: '3.2.1' }] },
  { id: 'AUD-0008', at: '2026-08-11T13:15:00Z', actor: 'm.ortega', action: 'unlink', objectType: 'asset', objectId: 'AST-0009', summary: 'Unlinked draft diagram from substation switch' },
  { id: 'AUD-0009', at: '2026-08-12T07:50:00Z', actor: 'p.nakamura', action: 'approve', objectType: 'document', objectId: 'DOC-0011', summary: 'Access review procedure v1.4 approved' },
  { id: 'AUD-0010', at: '2026-08-13T10:10:00Z', actor: 'r.delgado', action: 'export', objectType: 'evidence', objectId: 'GV.RM-01', summary: 'Exported evidence list for GV.RM-01' },
  { id: 'AUD-0011', at: '2026-08-14T15:40:00Z', actor: 'a.khoury', action: 'update', objectType: 'document', objectId: 'DOC-0009', summary: 'RTU hardening draft updated', changes: [{ field: 'status', from: 'draft', to: 'in review' }] },
  { id: 'AUD-0012', at: '2026-08-17T08:25:00Z', actor: 'j.lindqvist', action: 'create', objectType: 'asset', objectId: 'AST-0017', summary: 'Registered relay site PLC' },
  { id: 'AUD-0013', at: '2026-08-18T12:00:00Z', actor: 'm.ortega', action: 'update', objectType: 'asset', objectId: 'AST-0019', summary: 'Historian placed in maintenance', changes: [{ field: 'status', from: 'active', to: 'maintenance' }] },
  { id: 'AUD-0014', at: '2026-08-19T09:33:00Z', actor: 'p.nakamura', action: 'approve', objectType: 'document', objectId: 'DOC-0010', summary: 'Remote access procedure v2.3 approved' },
  { id: 'AUD-0015', at: '2026-08-20T14:18:00Z', actor: 'r.delgado', action: 'link', objectType: 'evidence', objectId: 'PR.IR-01', summary: 'Linked data diode to PR.IR-01' },
  { id: 'AUD-0016', at: '2026-08-24T11:05:00Z', actor: 'a.khoury', action: 'update', objectType: 'document', objectId: 'DOC-0005', summary: 'IR plan v5.0 published', changes: [{ field: 'version', from: '4.2', to: '5.0' }] },
  { id: 'AUD-0017', at: '2026-08-25T16:45:00Z', actor: 'j.lindqvist', action: 'update', objectType: 'asset', objectId: 'AST-0011', summary: 'Firmware recorded', changes: [{ field: 'firmware', from: '3.9.0', to: '4.0.2' }] },
  { id: 'AUD-0018', at: '2026-08-27T10:20:00Z', actor: 'm.ortega', action: 'create', objectType: 'document', objectId: 'DOC-0014', summary: 'Quarterly audit report draft created' },
  { id: 'AUD-0019', at: '2026-08-28T13:30:00Z', actor: 'r.delgado', action: 'link', objectType: 'asset', objectId: 'AST-0013', summary: 'Linked IR plan to energy SCADA server' },
  { id: 'AUD-0020', at: '2026-08-31T08:00:00Z', actor: 'p.nakamura', action: 'delete', objectType: 'evidence', objectId: 'ID.RA-05', summary: 'Removed stale link to expired risk note' },
  { id: 'AUD-0021', at: '2026-09-01T09:50:00Z', actor: 'a.khoury', action: 'update', objectType: 'document', objectId: 'DOC-0004', summary: 'Energy diagram v2.0 submitted for review', changes: [{ field: 'status', from: 'draft', to: 'in review' }] },
  { id: 'AUD-0022', at: '2026-09-03T15:12:00Z', actor: 'j.lindqvist', action: 'create', objectType: 'asset', objectId: 'AST-0018', summary: 'Registered telecom core switch' },
  { id: 'AUD-0023', at: '2026-09-04T11:40:00Z', actor: 'm.ortega', action: 'approve', objectType: 'document', objectId: 'DOC-0007', summary: 'Energy risk assessment v2.1 approved' },
  { id: 'AUD-0024', at: '2026-09-07T10:00:00Z', actor: 'r.delgado', action: 'update', objectType: 'asset', objectId: 'AST-0014', summary: 'Engineering workstation retired', changes: [{ field: 'status', from: 'active', to: 'retired' }] },
  { id: 'AUD-0025', at: '2026-09-09T14:25:00Z', actor: 'p.nakamura', action: 'approve', objectType: 'document', objectId: 'DOC-0008', summary: 'PLC baseline v3.1 approved' },
  { id: 'AUD-0026', at: '2026-09-11T08:55:00Z', actor: 'a.khoury', action: 'export', objectType: 'document', objectId: 'DOC-0001', summary: 'Exported policy for auditor' },
  { id: 'AUD-0027', at: '2026-09-14T12:10:00Z', actor: 'j.lindqvist', action: 'link', objectType: 'evidence', objectId: 'DE.CM-01', summary: 'Linked firewall logging to DE.CM-01' },
  { id: 'AUD-0028', at: '2026-09-16T17:00:00Z', actor: 'm.ortega', action: 'update', objectType: 'document', objectId: 'DOC-0016', summary: 'Recovery runbook v2.0 published', changes: [{ field: 'version', from: '1.1', to: '2.0' }] },
  { id: 'AUD-0029', at: '2026-09-18T09:05:00Z', actor: 'r.delgado', action: 'update', objectType: 'asset', objectId: 'AST-0006', summary: 'Firewall firmware recorded', changes: [{ field: 'firmware', from: '9.2.8', to: '9.3.2' }] },
  { id: 'AUD-0030', at: '2026-09-21T13:45:00Z', actor: 'p.nakamura', action: 'create', objectType: 'document', objectId: 'DOC-0015', summary: 'Metro exchange playbook scaffold created' },
  { id: 'AUD-0031', at: '2026-09-24T10:30:00Z', actor: 'a.khoury', action: 'update', objectType: 'asset', objectId: 'AST-0020', summary: 'Firewall firmware recorded', changes: [{ field: 'firmware', from: '9.2.0', to: '9.3.2' }] },
  { id: 'AUD-0032', at: '2026-09-28T08:15:00Z', actor: 'j.lindqvist', action: 'unlink', objectType: 'evidence', objectId: 'GV.SC-07', summary: 'Unlinked stale telecom review from GV.SC-07' },
  { id: 'AUD-0033', at: '2026-09-30T15:50:00Z', actor: 'm.ortega', action: 'approve', objectType: 'document', objectId: 'DOC-0011', summary: 'Access review procedure v1.4 re-approved after edit' },
  { id: 'AUD-0034', at: '2026-10-02T11:00:00Z', actor: 'r.delgado', action: 'create', objectType: 'document', objectId: 'DOC-0009', summary: 'RTU hardening standard created' },
  { id: 'AUD-0035', at: '2026-10-05T09:20:00Z', actor: 'a.khoury', action: 'update', objectType: 'asset', objectId: 'AST-0003', summary: 'SCADA server last reviewed', changes: [{ field: 'lastReviewed', from: '2026-09-02', to: '2026-10-01' }] },
  { id: 'AUD-0036', at: '2026-10-07T14:35:00Z', actor: 'p.nakamura', action: 'link', objectType: 'evidence', objectId: 'RC.RP-01', summary: 'Linked SCADA restore runbook to RC.RP-01' },
  { id: 'AUD-0037', at: '2026-10-09T10:45:00Z', actor: 'm.ortega', action: 'update', objectType: 'document', objectId: 'DOC-0014', summary: 'Audit report draft sent for management response', changes: [{ field: 'status', from: 'draft', to: 'in review' }] },
  { id: 'AUD-0038', at: '2026-10-12T16:20:00Z', actor: 'j.lindqvist', action: 'update', objectType: 'asset', objectId: 'AST-0010', summary: 'Substation RTU firmware recorded', changes: [{ field: 'firmware', from: '4.0.0', to: '4.1.0' }] },
  { id: 'AUD-0039', at: '2026-10-15T08:40:00Z', actor: 'r.delgado', action: 'create', objectType: 'document', objectId: 'DOC-0012', summary: 'Historian backup draft version 0.3 recorded' },
  { id: 'AUD-0040', at: '2026-10-18T13:10:00Z', actor: 'a.khoury', action: 'export', objectType: 'evidence', objectId: 'ID.AM-01', summary: 'Exported asset inventory evidence for ID.AM-01' },
]
