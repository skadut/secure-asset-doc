import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { documents } from '@/data/grc'
import { DocumentsTable } from './components/documents-table'

export function Documents() {
  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div>
          <h1 className='text-2xl font-bold tracking-tight'>Documents</h1>
          <p className='text-muted-foreground'>
            Policies, procedures, diagrams and reports with TLP, status and review dates. Sample data.
          </p>
        </div>
        <DocumentsTable data={documents} />
      </Main>
    </>
  )
}
