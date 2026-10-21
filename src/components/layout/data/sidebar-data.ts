import {
  Bell,
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  Monitor,
  Palette,
  ScrollText,
  Shield,
  UserCog,
  Wrench,
} from 'lucide-react'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: {
    name: 'Analyst (sample)',
    email: 'analyst@sample-grid.invalid',
    avatar: '',
  },
  teams: [
    {
      name: 'Secure Asset Doc',
      logo: Shield,
      plan: 'Sample data',
    },
  ],
  navGroups: [
    {
      title: 'Overview',
      items: [{ title: 'Dashboard', url: '/', icon: LayoutDashboard }],
    },
    {
      title: 'Inventory',
      items: [
        { title: 'Assets', url: '/assets', icon: Shield },
        { title: 'Documents', url: '/documents', icon: FileText },
      ],
    },
    {
      title: 'Compliance',
      items: [
        { title: 'CSF 2.0 evidence', url: '/evidence', icon: ClipboardCheck },
        { title: 'Audit log', url: '/audit-log', icon: ScrollText },
      ],
    },
    {
      title: 'Settings',
      items: [
        { title: 'Profile', url: '/settings', icon: UserCog },
        { title: 'Account', url: '/settings/account', icon: Wrench },
        { title: 'Appearance', url: '/settings/appearance', icon: Palette },
        { title: 'Notifications', url: '/settings/notifications', icon: Bell },
        { title: 'Display', url: '/settings/display', icon: Monitor },
      ],
    },
  ],
}
