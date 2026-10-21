import { createFileRoute } from '@tanstack/react-router'
import { DocumentDetail } from '@/features/documents/detail'

export const Route = createFileRoute('/_authenticated/documents/$documentId')({
  component: DocumentDetailRoute,
})

function DocumentDetailRoute() {
  const { documentId } = Route.useParams()
  return <DocumentDetail documentId={documentId} />
}
