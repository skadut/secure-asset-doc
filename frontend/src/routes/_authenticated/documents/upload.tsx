import { createFileRoute } from '@tanstack/react-router'
import {
  clampStep,
  type UploadStep,
} from '@/features/documents/upload/upload-helpers'
import { DocumentUploadWizard } from '@/features/documents/upload/upload-wizard'

export const Route = createFileRoute('/_authenticated/documents/upload')({
  validateSearch: (search: Record<string, unknown>): { step: UploadStep } => ({
    step: clampStep(search.step),
  }),
  component: UploadRoute,
})

function UploadRoute() {
  const { step } = Route.useSearch()
  return <DocumentUploadWizard step={step} />
}
