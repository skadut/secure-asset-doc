import {
  Activity,
  ClipboardCheck,
  Database,
  FileText,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Radio,
  ScrollText,
  Settings,
  Shield,
} from 'lucide-react'
import { type Me } from '@/lib/session'
import { type NavGroup, type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  teams: [
    {
      name: 'Secure Asset Doc',
      logo: Shield,
      plan: 'Kontrol akses dokumen',
    },
  ],
  navGroups: [
    {
      title: 'Overview',
      items: [{ title: 'Dashboard', url: '/', icon: LayoutDashboard }],
    },
    {
      title: 'Inventaris',
      items: [{ title: 'Aset', url: '/assets', icon: Shield }],
    },
    {
      title: 'Akses dokumen',
      items: [
        { title: 'Registri dokumen', url: '/documents', icon: FileText },
        { title: 'Otorisasi ganda', url: '/requests', icon: KeyRound },
        { title: 'Akses operasi', url: '/operation', icon: Radio },
      ],
    },
    {
      title: 'Kepatuhan',
      items: [
        { title: 'CSF 2.0 evidence', url: '/evidence', icon: ClipboardCheck },
        { title: 'Kontrol NIST 800-53', url: '/controls', icon: ListChecks },
        { title: 'Audit log', url: '/audit-log', icon: ScrollText },
      ],
    },
    {
      title: 'Operations',
      items: [
        { title: 'Service traffic', url: '/traffic', icon: Activity },
        { title: 'Database view', url: '/database', icon: Database },
      ],
    },
    {
      title: 'Pengaturan',
      items: [{ title: 'Pengaturan', url: '/settings', icon: Settings }],
    },
  ],
}

// Role gates keyed by url. Items without a gate are visible to everyone.
const gates: Record<string, (me: Me) => boolean> = {
  '/operation': (me) => me.accessLevel === 5 || me.securityOfficer === true,
  '/controls': (me) => me.securityOfficer === true || me.superAdmin === true,
  '/audit-log': (me) => me.securityOfficer === true || me.superAdmin === true,
  '/database': (me) => me.superAdmin === true,
  '/traffic': (me) => me.superAdmin === true,
}

export function navGroupsFor(me: Me | null): NavGroup[] {
  return sidebarData.navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        const gate = typeof item.url === 'string' ? gates[item.url] : undefined
        return !gate || (me !== null && (me.superAdmin === true || gate(me)))
      }),
    }))
    .filter((group) => group.items.length > 0)
}
