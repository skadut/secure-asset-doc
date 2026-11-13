import { Link } from '@tanstack/react-router'
import { BadgeCheck, Bell, ChevronsUpDown } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
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

type NavUserProps = {
  user: {
    name: string
    email: string
    avatar: string
    level?: number
  }
}

export function NavUser({ user }: NavUserProps) {
  const { isMobile } = useSidebar()
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size='lg'
                className='h-auto rounded-[10px] bg-black/25 p-2.5 shadow-[inset_0_1px_2px_rgb(0_0_0/.45),0_1px_0_rgb(255_255_255/.04)] hover:bg-black/30 data-[state=open]:bg-black/30'
              >
                <Avatar className='size-7 shrink-0 rounded-full border border-rail-line'>
                  <AvatarImage src={user.avatar} alt={user.name} />
                  <AvatarFallback className='rounded-full bg-rail-active font-mono text-[9px] font-semibold text-rail-ink'>
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className='grid min-w-0 flex-1 text-start leading-tight'>
                  <span className='truncate text-[11.5px] font-semibold text-rail-ink'>
                    {user.name}
                  </span>
                  <span className='truncate font-mono text-[7.5px] leading-[1.5] tracking-[.02em] text-rail-dim'>
                    {user.email}
                  </span>
                  {user.level != null && (
                    <span className='mt-0.5 inline-flex w-fit items-center gap-1 border border-[#3a4a8f] px-1 font-mono text-[7px] font-semibold leading-[14px] text-[#8fa6e6]'>
                      L{user.level}
                    </span>
                  )}
                </div>
                <ChevronsUpDown className='ms-auto size-3.5 shrink-0 text-rail-dim' aria-hidden='true' />
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
                    <span className='truncate font-semibold'>{user.name}</span>
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
        </SidebarMenuItem>
      </SidebarMenu>
    </>
  )
}
