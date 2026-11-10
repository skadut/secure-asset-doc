import { createFileRoute } from '@tanstack/react-router'
import { DatabaseView } from '@/features/database'

export const Route = createFileRoute('/_authenticated/database/')({
  component: DatabaseView,
})
