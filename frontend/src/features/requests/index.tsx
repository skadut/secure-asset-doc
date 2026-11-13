import { PageHead } from '@/components/page-head'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { AccessSection } from './access-section'
import { LevelSection } from './level-section'

export function Requests() {
  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-6'>
        <PageHead
          title='Otorisasi ganda'
          eyebrow='Dua pihak · Komandan + Perwira Keamanan'
          note='Keputusan akses'
        />

        <Tabs defaultValue='akses' className='min-w-0'>
          <TabsList className='h-auto w-full justify-start rounded-none border-b border-line bg-transparent p-0'>
            <TabsTrigger value='akses' className='h-11 rounded-none border-b-2 border-transparent px-3 data-[state=active]:border-ink data-[state=active]:bg-transparent data-[state=active]:text-ink'>
              Permintaan akses
            </TabsTrigger>
            <TabsTrigger value='level' className='h-11 rounded-none border-b-2 border-transparent px-3 data-[state=active]:border-ink data-[state=active]:bg-transparent data-[state=active]:text-ink'>
              Perubahan level
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
