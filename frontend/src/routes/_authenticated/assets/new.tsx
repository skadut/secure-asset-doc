import { createFileRoute } from '@tanstack/react-router'
import { CreateAsset } from '@/features/assets/create'

export const Route = createFileRoute('/_authenticated/assets/new')({
  component: CreateAsset,
})
