import { useRef, useState } from 'react'
import { LoaderCircle, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useUploads } from './use-uploads'

const emptyClass = 'rounded-md border border-dashed p-4 text-sm text-muted-foreground'

export function UploadsSection() {
  const { upload } = useUploads()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const handleFile = async (file: File) => {
    setUploading(true)
    setStatus(null)
    const result = await upload(file)
    setUploading(false)
    if (result.ok) {
      toast.success(`Uploaded and encrypted: ${file.name}`)
    } else {
      setStatus(result.message)
    }
  }

  return (
    <section className='min-w-0 space-y-2'>
      <div className='flex items-baseline justify-between gap-2'>
        <h2 className='text-sm font-semibold'>Encrypted uploads</h2>
        <Button
          type='button'
          variant='outline'
          size='sm'
          className='aria-disabled:opacity-50'
          aria-disabled={uploading}
          onClick={() => {
            if (!uploading) inputRef.current?.click()
          }}
        >
          {uploading ? (
            <LoaderCircle aria-hidden='true' className='size-4 animate-spin motion-reduce:animate-none' />
          ) : (
            <Upload aria-hidden='true' className='size-4' />
          )}
          Upload
        </Button>
      </div>

      <p className='text-sm text-muted-foreground'>
        Files are sent as base64, sealed by the crypto service (/sealfile), and stored only as ciphertext. Opening a file unseals it (/unsealfile).
      </p>

      <input
        ref={inputRef}
        type='file'
        accept='application/pdf,image/png,image/jpeg,text/plain'
        className='sr-only'
        tabIndex={-1}
        aria-hidden='true'
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void handleFile(file)
        }}
      />

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const file = e.dataTransfer.files[0]
          if (file && !uploading) void handleFile(file)
        }}
        className={emptyClass}
      >
        Drop a file here or use Upload
      </div>

      <p aria-live='polite' className={cn('min-h-5 text-sm', status && 'text-destructive')}>
        {uploading ? 'Encrypting and uploading…' : status}
      </p>
    </section>
  )
}
