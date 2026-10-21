import { createFileRoute } from '@tanstack/react-router'
import { Evidence } from '@/features/evidence'

export const Route = createFileRoute('/_authenticated/evidence/')({
  component: Evidence,
})
