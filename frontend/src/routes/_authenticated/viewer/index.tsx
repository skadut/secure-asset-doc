import { createFileRoute } from '@tanstack/react-router'
import { Viewer } from '@/features/viewer'

export const Route = createFileRoute('/_authenticated/viewer/')({
  validateSearch: (
    search: Record<string, unknown>
  ): { doc: string | undefined } => ({
    doc: typeof search.doc === 'string' ? search.doc : undefined,
  }),
  component: Viewer,
})
