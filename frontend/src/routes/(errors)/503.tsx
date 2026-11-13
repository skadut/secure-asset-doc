import { createFileRoute } from '@tanstack/react-router'
import { ServiceBusy } from '@/features/errors/service-busy'

export const Route = createFileRoute('/(errors)/503')({
  component: ServiceBusy,
})
