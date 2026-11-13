import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { BadgeCheck, Bell, LogOut } from 'lucide-react'
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
  const { isMobile, state } = useSidebar()
  const collapsed = state === 'collapsed'
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
          <div
            className={`flex items-center gap-2.5 rounded-[10px] bg-[#00000047] shadow-[inset_0_1px_2px_#00000073,0_1px_0_#ffffff0a] ${collapsed ? 'p-0' : 'p-2.5'}`}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type='button'
                  className='flex min-w-0 flex-1 items-center gap-2.5 rounded-[10px] bg-transparent text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a8d8bc] data-[state=open]:bg-transparent'
                >
                  <span className='flex size-[34px] shrink-0 items-center justify-center rounded-full bg-[#a8d8bc] p-[3px]'>
                    <Avatar className='size-full rounded-full'>
                      <AvatarImage src={user.avatar} alt={user.name} />
                      <AvatarFallback className='rounded-full bg-[#1e2521] font-mono text-[11px] font-semibold text-[#d7ded6]'>
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                  </span>
                  {!collapsed && (
                    <span className='flex min-w-0 flex-1 flex-col gap-[3px]'>
                      <span className='truncate text-[13px] leading-[14px] font-semibold text-[#d7ded6]'>
                        {user.name}
                      </span>
                      {(level != null || user.role) && (
                        <span className='flex min-w-0 items-center gap-1.5'>
                          {level != null && (
                            <span
                              role='img'
                              aria-label={`Level akses ${level} dari ${LEVEL_MAX}`}
                              className='flex shrink-0 items-center gap-[5px] rounded-[4px] border-[0.67px] border-[#3a4a8f] py-[0.67px] pr-[6.67px] pl-[0.67px]'
                            >
                              <span className='flex h-3.5 items-center rounded-[3px_0_0_3px] bg-[#3a4a8f] px-1 font-mono text-[10.5px] leading-[9px] font-semibold tracking-[.18px] text-white'>
                                L{level}
                              </span>
                              <span
                                aria-hidden='true'
                                className='flex items-center gap-[1.5px]'
                              >
                                {Array.from({ length: LEVEL_MAX }, (_, i) => (
                                  <i
                                    key={i}
                                    className={`h-2 w-[3px] rounded-[1px] ${i < level ? 'bg-[#8fa6e6]' : 'bg-[#3a4a8f]'}`}
                                  />
                                ))}
                              </span>
                            </span>
                          )}
                          {user.role && (
                            <span className='truncate font-mono text-[8.5px] leading-[11px] tracking-[.15px] text-[#98a49a]'>
                              {user.role.toUpperCase()}
                            </span>
                          )}
                        </span>
                      )}
                      {user.exp != null && <SessionCountdown exp={user.exp} />}
                    </span>
                  )}
                </button>
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
                      <AvatarFallback className='rounded-full font-mono text-[10.5px]'>
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className='grid flex-1 text-start leading-tight'>
                      <span className='truncate font-semibold'>
                        {user.name}
                      </span>
                      <span className='truncate font-mono text-[9px] text-muted-foreground'>
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

            {!collapsed && (
              <Button
                type='button'
                variant='ghost'
                size='icon'
                aria-label='Keluar'
                title='Keluar'
                onClick={() => setSignOutOpen(true)}
                className='size-[30px] shrink-0 rounded-[8px] bg-[#ffffff0d] text-[#98a49a] hover:bg-[#ffffff1a] hover:text-[#d7ded6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a8d8bc]'
              >
                <LogOut className='size-3.5' aria-hidden='true' />
              </Button>
            )}
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
    <span
      className='font-mono text-[10px] leading-[12px] text-[#a8d8bc]'
      role='timer'
    >
      Sesi {formatRemaining(exp, now)}
    </span>
  )
}
