import { Outlet, createFileRoute } from '@tanstack/react-router'

function SettingsLayout() {
  return <Outlet />
}

export const Route = createFileRoute('/_authenticated/settings')({
  component: SettingsLayout,
})
