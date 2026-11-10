import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { goHome, setMe } from '@/lib/session'
import { ConfirmDialog } from '@/components/confirm-dialog'

interface SignOutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SignOutDialog({ open, onOpenChange }: SignOutDialogProps) {
  const { auth } = useAuthStore()

  const handleSignOut = async () => {
    let res: Response
    try {
      res = await fetch('/api/logout', {
        method: 'POST',
        credentials: 'same-origin',
      })
    } catch {
      toast.error('Sign out failed. Please try again.')
      return
    }
    if (!res.ok) {
      toast.error('Sign out failed. Please try again.')
      return
    }
    setMe(null)
    auth.reset()
    goHome()
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title='Sign out'
      desc='Are you sure you want to sign out? You will need to sign in again to access your account.'
      confirmText='Sign out'
      destructive
      handleConfirm={() => {
        void handleSignOut()
      }}
      className='sm:max-w-sm'
    />
  )
}
