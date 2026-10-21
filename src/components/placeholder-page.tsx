import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

type PlaceholderPageProps = {
  title: string
  children?: React.ReactNode
}

export function PlaceholderPage({ title, children }: PlaceholderPageProps) {
  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <h1 className='text-2xl font-bold tracking-tight'>{title}</h1>
        {children}
      </Main>
    </>
  )
}
