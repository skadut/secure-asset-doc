import { createFileRoute } from '@tanstack/react-router'
import { AssetDetail } from '@/features/assets/detail'

export const Route = createFileRoute('/_authenticated/assets/$assetId')({
  component: AssetDetailRoute,
})

function AssetDetailRoute() {
  const { assetId } = Route.useParams()
  return <AssetDetail assetId={assetId} />
}
