import {
  assets,
  assetDocLinks,
  auditEvents,
  csfSubcategories,
  documents,
  evidenceLinks,
  TODAY,
  type Asset,
  type AuditEvent,
  type Document,
  type EvidenceLink,
} from '../data/grc.ts'

export const getAsset = (id: string): Asset | undefined =>
  assets.find((asset) => asset.id === id)

export const getDocument = (id: string): Document | undefined =>
  documents.find((document) => document.id === id)

export const documentsForAsset = (assetId: string): Document[] =>
  assetDocLinks
    .filter((link) => link.assetId === assetId)
    .flatMap((link) => {
      const document = getDocument(link.documentId)
      return document ? [document] : []
    })

export const assetsForDocument = (documentId: string): Asset[] =>
  assetDocLinks
    .filter((link) => link.documentId === documentId)
    .flatMap((link) => {
      const asset = getAsset(link.assetId)
      return asset ? [asset] : []
    })

export const evidenceForSubcategory = (id: string) =>
  evidenceLinks.filter((link) => link.subcategoryId === id)

export const subcategoriesForDocument = (id: string) =>
  csfSubcategories.filter((subcategory) =>
    evidenceLinks.some(
      (link) => link.subcategoryId === subcategory.id && link.documentId === id
    )
  )

export const subcategoriesForAsset = (id: string) =>
  csfSubcategories.filter((subcategory) =>
    evidenceLinks.some(
      (link) => link.subcategoryId === subcategory.id && link.assetId === id
    )
  )

export const isDocCurrent = (doc: Document): boolean =>
  doc.status === 'approved' && doc.nextReview >= TODAY

// Defaults = app globals (unchanged behaviour). Pass evidence/docs/today to evaluate purely.
export const coverage = (
  subcategoryId: string,
  evidence: EvidenceLink[] = evidenceLinks,
  docs: Document[] = documents,
  today: string = TODAY
): 'covered' | 'partial' | 'gap' => {
  const links = evidence.filter((link) => link.subcategoryId === subcategoryId)
  if (
    links.some((link) => {
      const document = link.documentId
        ? docs.find((doc) => doc.id === link.documentId)
        : undefined
      return document
        ? document.status === 'approved' && document.nextReview >= today
        : false
    })
  ) {
    return 'covered'
  }
  return links.length ? 'partial' : 'gap'
}

export const auditFor = (
  objectType: AuditEvent['objectType'],
  objectId: string
): AuditEvent[] =>
  auditEvents
    .filter(
      (event) => event.objectType === objectType && event.objectId === objectId
    )
    .sort((a, b) => b.at.localeCompare(a.at))
