import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { type DocFile } from '@/data/grc'
import { type Sheet, readXlsx } from '@/lib/xlsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import './file-preview.css'

// Loader ring appearance adapted from Uiverse.io (see THIRD_PARTY_NOTICES.md). Shown only while the query is pending.
function LoadingStatus({ name }: { name: string }) {
  return (
    <p role='status' className='flex items-center gap-2 text-sm'>
      <span className='ui-file-spinner' aria-hidden='true' />
      <span>Loading {name}...</span>
    </p>
  )
}

const PDF = 'application/pdf'
const MAX_ROWS = 200
const WIDE = '(min-width: 640px)'

export function FilePreview({
  file,
  secure = false,
}: {
  file?: DocFile
  secure?: boolean
}) {
  if (!file) {
    return (
      <p className='text-muted-foreground'>Belum ada berkas pada versi ini.</p>
    )
  }
  return file.mime === PDF ? (
    <PdfPreview file={file} secure={secure} />
  ) : (
    <XlsxPreview file={file} secure={secure} />
  )
}

function PdfPreview({ file, secure }: { file: DocFile; secure: boolean }) {
  const wide = useWideScreen()
  const head = useQuery({
    queryKey: ['doc-file-head', file.url],
    queryFn: async () => {
      const res = await fetch(file.url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const type = res.headers.get('content-type') ?? ''
      if (!type.startsWith(PDF))
        throw new Error(
          `server returned ${type || 'no content type'}, not a PDF`
        )
      const length = Number(res.headers.get('content-length'))
      await res.body?.cancel()
      return { size: length > 0 ? length : undefined }
    },
    retry: false,
  })

  return (
    <div className='flex flex-col gap-3'>
      <FileHeader
        file={file}
        label='PDF'
        size={head.data?.size}
        secure={secure}
      />
      {!wide ? (
        <p className='text-sm text-muted-foreground'>
          Inline preview is available on larger screens.
        </p>
      ) : (
        <>
          {head.isPending && <LoadingStatus name={file.name} />}
          {head.isError && (
            <p role='alert'>
              Could not load {file.name}: {reason(head.error)}.
            </p>
          )}
          {head.isSuccess && (
            <iframe
              src={file.url}
              title={`Preview of ${file.name}`}
              className='h-[75vh] w-full rounded-md border'
            />
          )}
        </>
      )}
    </div>
  )
}

function XlsxPreview({ file, secure }: { file: DocFile; secure: boolean }) {
  const sheets = useQuery({
    queryKey: ['doc-file-xlsx', file.url],
    queryFn: async () => {
      const res = await fetch(file.url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = await res.arrayBuffer()
      return { size: buf.byteLength, sheets: await readXlsx(buf) }
    },
    retry: false,
  })

  return (
    <div className='flex flex-col gap-3'>
      <FileHeader
        file={file}
        label='Excel workbook'
        size={sheets.data?.size}
        secure={secure}
      />
      {sheets.isPending && <LoadingStatus name={file.name} />}
      {sheets.isError && (
        <p role='alert'>
          Could not load {file.name}: {reason(sheets.error)}.
        </p>
      )}
      {sheets.data && <SheetList sheets={sheets.data.sheets} />}
    </div>
  )
}

function FileHeader({
  file,
  label,
  size,
  secure = false,
}: {
  file: DocFile
  label: string
  size?: number
  secure?: boolean
}) {
  return (
    <div className='flex flex-wrap items-center gap-x-4 gap-y-2 text-sm'>
      <span className='font-mono break-all'>{file.name}</span>
      <span>{label}</span>
      {size !== undefined && (
        <span className='font-mono tabular-nums'>{formatSize(size)}</span>
      )}
      {!secure && (
        <>
          <a
            href={file.url}
            download={file.name}
            className='underline underline-offset-4'
          >
            Download
          </a>
          {file.mime === PDF && (
            <a
              href={file.url}
              target='_blank'
              rel='noopener'
              className='underline underline-offset-4'
            >
              Open in new tab
            </a>
          )}
        </>
      )}
    </div>
  )
}

function SheetList({ sheets }: { sheets: Sheet[] }) {
  if (!sheets.length)
    return <p className='text-muted-foreground'>This workbook has no sheets.</p>
  if (sheets.length === 1) return <SheetTable sheet={sheets[0]} />
  return (
    <Tabs defaultValue='0'>
      <TabsList className='h-auto max-w-full flex-wrap justify-start'>
        {sheets.map((sheet, i) => (
          <TabsTrigger key={i} value={String(i)}>
            {sheet.name}
          </TabsTrigger>
        ))}
      </TabsList>
      {sheets.map((sheet, i) => (
        <TabsContent key={i} value={String(i)}>
          <SheetTable sheet={sheet} />
        </TabsContent>
      ))}
    </Tabs>
  )
}

function SheetTable({ sheet }: { sheet: Sheet }) {
  if (sheet.rows.length === 0)
    return <p className='text-muted-foreground'>This sheet has no rows.</p>

  const notice = sheet.rows[0].filter(Boolean).join(' ')
  const header = sheet.rows[1] ?? []
  const rest = sheet.rows.slice(2)
  const body = rest.slice(0, MAX_ROWS)

  return (
    <div className='flex flex-col gap-2'>
      <div
        data-glass-panel
        className='max-h-[70vh] overflow-x-auto overflow-y-auto rounded-md border'
      >
        <table className='w-full caption-top text-sm'>
          {notice && (
            <caption className='p-2 text-start text-muted-foreground'>
              {notice}
            </caption>
          )}
          <thead>
            <tr>
              {header.map((cell, i) => (
                <th
                  key={i}
                  scope='col'
                  className='sticky top-0 border-b bg-(--table-header) px-3 py-2 text-start font-medium whitespace-nowrap'
                >
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, r) => (
              <tr key={r} className='border-b last:border-0'>
                {row.map((cell, c) => (
                  <td
                    key={c}
                    className='px-3 py-2 whitespace-nowrap tabular-nums'
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rest.length === 0 && (
        <p className='text-muted-foreground'>This sheet has no rows.</p>
      )}
      {rest.length > MAX_ROWS && (
        <p className='text-sm'>
          Showing {MAX_ROWS} of {rest.length} rows. Download for the full sheet.
        </p>
      )}
    </div>
  )
}

function useWideScreen() {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches)
  useEffect(() => {
    const mq = window.matchMedia(WIDE)
    const onChange = () => setWide(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return wide
}

function reason(err: unknown) {
  return err instanceof Error ? err.message : 'unknown error'
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
