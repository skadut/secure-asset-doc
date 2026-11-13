import { createFileRoute } from '@tanstack/react-router'
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
  return <Documents autoUpload={upload === true} />
}
