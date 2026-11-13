import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { listAccessRequests, listLevelRequests } from '@/lib/access-api'
import { getMe } from '@/lib/session'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { AccessSection } from './access-section'
import { LevelSection } from './level-section'
import './requests.css'

const TAB_TRIGGER =
  'group h-[38px] flex-none gap-[7px] rounded-none border-0 border-b-2 border-transparent px-3.5 py-0 pb-0.5 text-[14.5px] font-semibold text-ink-3 shadow-none data-[state=active]:border-ink data-[state=active]:bg-transparent data-[state=active]:text-ink data-[state=active]:shadow-none dark:bg-transparent dark:text-ink-3 dark:data-[state=active]:border-ink dark:data-[state=active]:bg-transparent dark:data-[state=active]:text-ink'

function TabCount({ count }: { count: number | undefined }) {
  if (count === undefined) return null
  return (
    <span className='inline-flex justify-center bg-sunken px-1.5 py-0.5 font-mono text-[9px] leading-none text-ink-2 tabular-nums group-data-[state=active]:bg-ink group-data-[state=active]:text-surface'>
      {count}
    </span>
  )
}

export function Requests() {
  const me = getMe()
  const canManage = me !== null && (me.accessLevel === 5 || me.securityOfficer)

  const access = useQuery({
    queryKey: ['access-requests'],
    queryFn: listAccessRequests,
    retry: false,
  })
  const levels = useQuery({
    queryKey: ['level-requests'],
    queryFn: listLevelRequests,
    retry: false,
    enabled: canManage,
  })

  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-6'>
        <header className='flex min-w-0 flex-wrap items-end justify-between gap-4'>
          <div className='min-w-0'>
            <p className='mb-1 font-mono text-[11.5px] tracking-[.14em] text-ink-3 uppercase'>
              Dua pihak · Komandan + Perwira Keamanan
            </p>
            <h1 className='page-title tracking-tight'>Otorisasi ganda</h1>
          </div>
          <Button variant='outline' asChild>
            <Link to='/documents'>Riwayat keputusan</Link>
          </Button>
        </header>

        <Tabs defaultValue='akses' className='min-w-0'>
          <TabsList className='h-auto w-full justify-start rounded-none border-b border-line bg-transparent p-0'>
            <TabsTrigger value='akses' className={TAB_TRIGGER}>
              Permintaan akses
              <TabCount count={access.data?.length} />
            </TabsTrigger>
            <TabsTrigger value='level' className={TAB_TRIGGER}>
              Perubahan level
              <TabCount count={levels.data?.length} />
            </TabsTrigger>
          </TabsList>
          <TabsContent value='akses'>
            <AccessSection />
          </TabsContent>
          <TabsContent value='level'>
            <LevelSection />
          </TabsContent>
        </Tabs>
      </Main>
    </>
  )
}
