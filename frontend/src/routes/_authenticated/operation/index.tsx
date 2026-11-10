import { createFileRoute } from '@tanstack/react-router'
import { Operation } from '@/features/operation'

export const Route = createFileRoute('/_authenticated/operation/')({
  component: Operation,
})
