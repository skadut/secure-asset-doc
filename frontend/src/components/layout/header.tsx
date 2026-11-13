import { useLocation } from '@tanstack/react-router'
import { LayoutGrid } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

const crumbs: Record<string, string> = {
  '/': 'OVERVIEW / DASHBOARD',
  '/assets': 'INVENTARIS / ASET',
  '/documents': 'AKSES DOKUMEN / REGISTRI DOKUMEN',
  '/requests': 'AKSES DOKUMEN / OTORISASI GANDA',
  '/operation': 'AKSES DOKUMEN / AKSES OPERASI',
  '/evidence': 'KEPATUHAN / CSF 2.0 EVIDENCE',
  '/controls': 'KEPATUHAN / KONTROL NIST 800-53',
  '/audit-log': 'KEPATUHAN / AUDIT LOG',
  '/traffic': 'OPERATIONS / SERVICE TRAFFIC',
  '/database': 'OPERATIONS / DATABASE VIEW',
  '/settings': 'PENGATURAN / TAMPILAN',
  '/settings/account': 'PENGATURAN / AKUN',
  '/settings/appearance': 'PENGATURAN / TAMPILAN',
  '/settings/notifications': 'PENGATURAN / NOTIFIKASI',
  '/settings/display': 'PENGATURAN / LAYAR',
}

type HeaderProps = React.HTMLAttributes<HTMLElement> & {
  fixed?: boolean
  ref?: React.Ref<HTMLElement>
}

export function Header({ className, fixed, children, ...props }: HeaderProps) {
  const location = useLocation()

  return (
    <header
      className={cn(
        'z-50 h-14 border-b border-line bg-bg',
        fixed && 'header-fixed peer/header sticky top-0 w-[inherit]',
        className
      )}
      {...props}
    >
      <div
        className={cn(
          'relative flex h-full min-w-0 items-center gap-3 px-4 sm:px-6',
          fixed && 'after:absolute after:inset-0 after:-z-10'
        )}
      >
        <div className='md:hidden'>
          <SidebarTrigger
            aria-label='Buka atau tutup navigasi'
            className='size-10 shrink-0 rounded-none border border-line bg-surface text-ink hover:bg-surface-2'
          />
        </div>
        <div className='flex min-w-0 items-center gap-2 font-mono text-[10px] font-normal tracking-[.12em] text-ink-3'>
          <LayoutGrid className='size-[13px] shrink-0' aria-hidden='true' />
          <span className='truncate'>
            {crumbs[location.pathname] ?? crumbs['/settings']}
          </span>
        </div>
        <div className='ms-auto flex shrink-0 items-center gap-1 sm:gap-2'>
          {children ?? (
            <>
              <div className='hidden sm:block'>
                <Search
                  className='h-8 min-w-0 font-bold sm:min-w-[200px]'
                  placeholder='Cari dokumen, aset, kontrol'
                />
              </div>
              <ThemeSwitch />
              <ProfileDropdown />
            </>
          )}
        </div>
      </div>
    </header>
  )
}
