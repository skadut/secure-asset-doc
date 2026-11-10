import { createFileRoute } from '@tanstack/react-router'
import { Documents } from '@/features/documents'

export const Route = createFileRoute('/_authenticated/documents/')({
  component: Documents,
})
