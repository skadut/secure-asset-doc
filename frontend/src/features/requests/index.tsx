import { AccessSection } from './access-section'
import { LevelSection } from './level-section'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

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
        <div>
          <h1 className='page-title tracking-tight'>Otorisasi ganda</h1>
          <p className='text-muted-foreground'>
            Penambahan akses dan perubahan level memerlukan persetujuan dua pihak.
          </p>
        </div>

        <Tabs defaultValue='akses'>
          <TabsList className='h-auto w-full'>
            <TabsTrigger value='akses' className='h-11'>
              Permintaan akses
            </TabsTrigger>
            <TabsTrigger value='level' className='h-11'>
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
