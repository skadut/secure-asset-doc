import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { BadgeCheck, Bell, ChevronsUpDown, LogOut } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { SignOutDialog } from '@/components/sign-out-dialog'

type NavUserProps = {
  user: {
    name: string
    email: string
    avatar: string
    level?: number
    role?: string
    /** Token expiry, epoch seconds. The countdown renders only when present. */
    exp?: number
  }
}

const LEVEL_MAX = 5

function formatRemaining(expSeconds: number, nowMs: number) {
  const left = Math.max(0, Math.floor(expSeconds - nowMs / 1000))
  const m = Math.floor(left / 60)
  const s = left % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function NavUser({ user }: NavUserProps) {
  const { isMobile } = useSidebar()
  const [signOutOpen, setSignOutOpen] = useState(false)
  const level = user.level
  const initials =
    user.name
      .replace(/[^\p{L}\s]/gu, '')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || '?'

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <div className='flex flex-col gap-1.5 rounded-[10px] bg-black/25 p-2.5 shadow-[inset_0_1px_2px_rgb(0_0_0/.45),0_1px_0_rgb(255_255_255/.04)]'>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size='lg'
                  className='h-auto p-0 hover:bg-transparent data-[state=open]:bg-transparent'
                >
                  <Avatar className='size-8 shrink-0 rounded-full border border-rail-line'>
                    <AvatarImage src={user.avatar} alt={user.name} />
                    <AvatarFallback className='rounded-full bg-rail-active font-mono text-[9px] font-semibold text-rail-ink'>
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className='grid min-w-0 flex-1 text-start leading-tight'>
                    <span className='truncate text-[11.5px] font-semibold text-rail-ink'>
                      {user.name}
                    </span>
                    {user.role && (
                      <span className='truncate font-mono text-[7.5px] leading-[1.5] tracking-[.02em] text-rail-dim'>
                        {user.role}
                      </span>
                    )}
                  </div>
                  {level != null && (
                    <span className='inline-flex shrink-0 items-center border border-[#3a4a8f] px-1 font-mono text-[7px] leading-[14px] font-semibold text-[#8fa6e6]'>
                      L{level}
                    </span>
                  )}
                  <ChevronsUpDown
                    className='size-3.5 shrink-0 text-rail-dim'
                    aria-hidden='true'
                  />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className='w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-none'
                side={isMobile ? 'bottom' : 'right'}
                align='end'
                sideOffset={4}
              >
                <DropdownMenuLabel className='p-0 font-normal'>
                  <div className='flex items-center gap-2 px-1 py-1.5 text-start text-sm'>
                    <Avatar className='size-8 rounded-full'>
                      <AvatarImage src={user.avatar} alt={user.name} />
                      <AvatarFallback className='rounded-full font-mono text-[9px]'>
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className='grid flex-1 text-start leading-tight'>
                      <span className='truncate font-semibold'>
                        {user.name}
                      </span>
                      <span className='truncate font-mono text-[8px] text-muted-foreground'>
                        {user.email}
                      </span>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem asChild>
                    <Link to='/settings/account'>
                      <BadgeCheck />
                      Akun
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to='/settings/notifications'>
                      <Bell />
                      Notifikasi
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            {level != null && (
              <div
                className='flex items-center gap-[3px] px-0.5'
                role='img'
                aria-label={`Level akses ${level} dari ${LEVEL_MAX}`}
              >
                {Array.from({ length: LEVEL_MAX }, (_, i) => (
                  <i
                    key={i}
                    aria-hidden='true'
                    className={`h-[3px] flex-1 ${i < level ? 'bg-[#8fa6e6]' : 'bg-rail-line'}`}
                  />
                ))}
              </div>
            )}

            <div className='flex items-center justify-between gap-2 px-0.5'>
              {user.exp != null ? (
                <SessionCountdown exp={user.exp} />
              ) : (
                <span />
              )}
              <Button
                type='button'
                variant='ghost'
                size='icon'
                aria-label='Keluar'
                title='Keluar'
                onClick={() => setSignOutOpen(true)}
                className='size-6 rounded-[6px] text-rail-dim hover:bg-white/5 hover:text-rail-ink'
              >
                <LogOut className='size-3.5' aria-hidden='true' />
              </Button>
            </div>
          </div>
        </SidebarMenuItem>
      </SidebarMenu>
      <SignOutDialog open={signOutOpen} onOpenChange={setSignOutOpen} />
    </>
  )
}

function SessionCountdown({ exp }: { exp: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  return (
    <span className='font-mono text-[8.5px] text-pass' role='timer'>
      Sesi {formatRemaining(exp, now)}
    </span>
  )
}
