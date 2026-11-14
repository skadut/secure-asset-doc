import { Navigate, createFileRoute } from '@tanstack/react-router'
import { Documents } from '@/features/documents'
import { parseUploadFlag } from '@/features/documents/uploads/uploads-helpers'

export const Route = createFileRoute('/_authenticated/documents/')({
  validateSearch: (search: Record<string, unknown>): { upload?: boolean } => ({
    upload: parseUploadFlag(search.upload),
  }),
  component: DocumentsRoute,
})

function DocumentsRoute() {
  const { upload } = Route.useSearch()
  // Old deep link: /documents?upload=1 opens the new six-step wizard.
  if (upload)
    return <Navigate to='/documents/upload' search={{ step: 1 }} replace />
  return <Documents />
}
