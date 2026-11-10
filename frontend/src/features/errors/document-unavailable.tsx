import { Link } from '@tanstack/react-router'

export function DocumentUnavailable() {
  return (
    <div className='min-h-[60svh]'>
      <div className='m-auto flex min-h-[60svh] w-full flex-col items-center justify-center gap-2 px-4'>
        <h1 className='text-center text-2xl font-bold tracking-tight'>
          Dokumen tidak tersedia
        </h1>
        <p className='text-center text-muted-foreground'>
          Dokumen ini tidak ada atau Anda tidak memiliki akses.
        </p>
        <Link
          to='/documents'
          className='mt-6 inline-flex min-h-11 items-center rounded-md px-2 text-sm font-medium underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none'
        >
          Kembali ke registri
        </Link>
      </div>
    </div>
  )
}
