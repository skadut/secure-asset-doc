import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth-store'
import { listAccessRequests } from '@/lib/access-api'
import { getMe } from '@/lib/session'
import { useLayout } from '@/context/layout-provider'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '@/components/ui/sidebar'
import { pendingDocCount } from '@/features/requests/pending-count'
import { navGroupsFor } from './data/sidebar-data'
import { NavGroup } from './nav-group'
import { NavUser } from './nav-user'

export function AppSidebar() {
  const { variant, collapsible } = useLayout()
  const me = getMe()
  const canReview =
    me !== null && (me.accessLevel === 5 || me.securityOfficer === true)
  const pending = useQuery({
    queryKey: ['access-requests'],
    queryFn: listAccessRequests,
    select: pendingDocCount,
    enabled: canReview,
    retry: false,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
  const pendingCount = pending.data ?? 0
  const navGroups = navGroupsFor(me).map((group) => ({
    ...group,
    items: group.items.map((item) =>
      item.url === '/requests' && pendingCount > 0
        ? {
            ...item,
            badge: String(pendingCount),
            badgeLabel: `${pendingCount} dokumen menunggu persetujuan`,
          }
        : item
    ),
  }))
  const exp = useAuthStore((s) => s.auth.user?.exp)
  return (
    <Sidebar collapsible={collapsible} variant={variant}>
      <SidebarHeader>
        <div className='flex min-h-[46px] items-center gap-2.5 px-1.5'>
          <span
            aria-hidden='true'
            className='flex size-[30px] shrink-0 items-center justify-center rounded-[8px] font-heading text-[14px] font-bold text-[#0f1411] shadow-[0_4px_12px_rgb(0_0_0/.35)]'
            style={{
              background:
                'linear-gradient(160deg, #e8ede6 10.99%, #b9c4b8 89.01%)',
            }}
          >
            AR
          </span>
          <div className='min-w-0'>
            <div className='truncate font-heading text-[15px] leading-[1.15] font-semibold text-rail-ink'>
              ARCA
            </div>
            <div className='truncate font-mono text-[9px] leading-[1.4] tracking-[.08em] text-rail-dim uppercase'>
              Digital Asset Security
            </div>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent className='gap-2 overflow-x-visible bg-[linear-gradient(180deg,var(--rail-top),var(--rail))] px-1.5'>
        {navGroups.map((props) => (
          <NavGroup key={props.title} {...props} />
        ))}
      </SidebarContent>
      <SidebarFooter className='bg-[linear-gradient(180deg,var(--rail-top),var(--rail))] px-1.5'>
        <NavUser
          user={{
            name: me?.name ?? '',
            email: me
              ? `${me.superAdmin ? 'Super Admin · ' : ''}${me.rank} · Level ${me.accessLevel} · ${me.golongan}`
              : '',
            avatar: '',
            level: me?.accessLevel,
            role: me
              ? me.superAdmin
                ? 'Super Admin'
                : me.rankName
              : undefined,
            exp,
          }}
        />
        <div className='px-2 pb-1 text-center font-mono text-[9px] leading-[1.4] tracking-[.08em] text-rail-dim uppercase'>
          Aeru Team · Kartika Cyberhackaton 2026 ·{' '}
          <a
            href='https://github.com/skadut'
            target='_blank'
            rel='noopener noreferrer'
            className='underline underline-offset-2'
          >
            github.com/skadut
          </a>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
