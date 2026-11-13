import { cn } from '@/lib/utils'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

type ConfirmDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  disabled?: boolean
  desc: React.JSX.Element | string
  cancelBtnText?: string
  confirmText?: React.ReactNode
  destructive?: boolean
  isLoading?: boolean
  className?: string
  children?: React.ReactNode
} & (
  | { form: string; handleConfirm?: undefined }
  | { form?: undefined; handleConfirm: () => void }
)

export function ConfirmDialog(props: ConfirmDialogProps) {
  const {
    title,
    desc,
    children,
    className,
    confirmText,
    cancelBtnText,
    destructive,
    isLoading,
    disabled = false,
    form,
    handleConfirm,
    ...actions
  } = props
  return (
    <AlertDialog {...actions}>
      <AlertDialogContent className={cn('rounded-none border-line-2 bg-surface p-0 text-ink shadow-lg', className)}>
        <AlertDialogHeader className='border-b border-line bg-surface-2 px-4 py-3 text-start'>
          <AlertDialogTitle className='font-sans text-[14px] font-semibold text-ink'>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild className='text-[11.5px] leading-[1.45] text-ink-2'>
            <div>{desc}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {children && <div className='p-4'>{children}</div>}
        <AlertDialogFooter className='border-t border-line px-4 py-3'>
          <AlertDialogCancel disabled={isLoading} className='min-h-8 rounded-none border-line bg-surface font-sans text-[12px] text-ink focus-visible:ring-2 focus-visible:ring-ring'>
            {cancelBtnText ?? 'Cancel'}
          </AlertDialogCancel>
          <Button
            type={form ? 'submit' : 'button'}
            form={form}
            onClick={handleConfirm}
            variant={destructive ? 'destructive' : 'default'}
            disabled={disabled || isLoading}
            className='min-h-8 rounded-none font-sans text-[12px] focus-visible:ring-2 focus-visible:ring-ring'
          >
            {confirmText ?? 'Continue'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
