// Self-check. Run: node --experimental-strip-types src/lib/grc.check.ts
// @ts-expect-error node types are not in tsconfig.app.json include scope
import assert from 'node:assert/strict'
import {
  assetDocLinks,
  assets,
  auditEvents,
  csfSubcategories,
  documents,
  evidenceLinks,
} from '../data/grc.ts'
import * as fixture from '../test-utils/grc-fixture.ts'
import { coverage, getAsset, getDocument } from './grc.ts'

// App arrays are empty in source; push fixture rows before asserting.
assetDocLinks.push(...fixture.assetDocLinks)
assets.push(...fixture.assets)
auditEvents.push(...fixture.auditEvents)
csfSubcategories.push(...fixture.csfSubcategories)
documents.push(...fixture.documents)
evidenceLinks.push(...fixture.evidenceLinks)

const assetIds = new Set(assets.map((a) => a.id))
const docIds = new Set(documents.map((d) => d.id))
const subIds = new Set(csfSubcategories.map((s) => s.id))

for (const link of assetDocLinks) {
  assert.ok(assetIds.has(link.assetId), `asset link ${link.assetId}`)
  assert.ok(docIds.has(link.documentId), `doc link ${link.documentId}`)
}
for (const link of evidenceLinks) {
  assert.ok(subIds.has(link.subcategoryId), `subcategory ${link.subcategoryId}`)
  if (link.assetId) assert.ok(assetIds.has(link.assetId), `evidence asset ${link.assetId}`)
  if (link.documentId) assert.ok(docIds.has(link.documentId), `evidence doc ${link.documentId}`)
}
for (const event of auditEvents) {
  if (event.objectType === 'asset') assert.ok(getAsset(event.objectId), `audit asset ${event.objectId}`)
  if (event.objectType === 'document') assert.ok(getDocument(event.objectId), `audit doc ${event.objectId}`)
  if (event.objectType === 'evidence') {
    assert.ok(subIds.has(event.objectId), `audit evidence ${event.objectId}`)
  }
}
for (const doc of documents) {
  assert.ok(doc.versions.length >= 1, `doc ${doc.id} has no versions`)
}

const seen = new Set(csfSubcategories.map((s) => coverage(s.id)))
for (const value of ['covered', 'partial', 'gap']) {
  assert.ok(seen.has(value as 'covered' | 'partial' | 'gap'), `coverage never returns ${value}`)
}

process.stdout.write(
  `grc self-check OK: ${assetDocLinks.length} asset-doc links, ${evidenceLinks.length} evidence links, ${auditEvents.length} audit events, coverage=${[...seen].join('/')}
`
)
