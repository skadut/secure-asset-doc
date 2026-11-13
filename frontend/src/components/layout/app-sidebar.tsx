import { Shield } from 'lucide-react'
import { getMe } from '@/lib/session'
import { useLayout } from '@/context/layout-provider'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '@/components/ui/sidebar'
// import { AppTitle } from './app-title'
import { navGroupsFor } from './data/sidebar-data'
import { NavGroup } from './nav-group'
import { NavUser } from './nav-user'

export function AppSidebar() {
  const { variant, collapsible } = useLayout()
  const me = getMe()
  return (
    <Sidebar collapsible={collapsible} variant={variant}>
      <SidebarHeader>
        <div className='flex min-h-[46px] items-center gap-2.5 px-1.5'>
          <span className='flex size-[30px] shrink-0 items-center justify-center rounded-[8px] bg-gradient-to-br from-[#e8ede6] to-[#b9c4b8] text-rail font-heading text-sm font-bold shadow-[0_4px_12px_rgb(0_0_0/.35)]'>
            <Shield className='size-4' aria-hidden='true' />
          </span>
          <div className='min-w-0'>
            <div className='truncate font-heading text-[13px] font-semibold leading-[1.15] text-rail-ink'>
              Secure Asset Doc
            </div>
            <div className='truncate font-mono text-[8px] uppercase leading-[1.4] tracking-[.08em] text-rail-dim'>
              Kontrol akses dokumen
            </div>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent className='gap-2 overflow-x-visible bg-[linear-gradient(180deg,var(--rail-top),var(--rail))] px-1.5'>
        {navGroupsFor(me).map((props) => (
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
          }}
        />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
