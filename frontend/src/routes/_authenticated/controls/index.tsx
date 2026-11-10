import { createFileRoute } from '@tanstack/react-router'
import { Controls } from '@/features/controls'

export const Route = createFileRoute('/_authenticated/controls/')({
  component: Controls,
})
