// ponytail: values only (no styles, merged cells, formulas show cached values, dates show as serial numbers). Swap for SheetJS if real-world files need more.
// ponytail: ZIP64 archives unsupported; only deflate (8) and stored (0) entries.

export type Sheet = { name: string; rows: string[][] }

type ZipEntry = { method: number; size: number; offset: number }

const ENTITY: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

function decodeXml(s: string): string {
  return s.replace(
    /&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g,
    (_, e: string) =>
      e[0] === '#'
        ? String.fromCodePoint(
            e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
          )
        : ENTITY[e]
  )
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag)
  return m ? decodeXml(m[1]) : undefined
}

function readZip(buf: ArrayBuffer): Map<string, ZipEntry> {
  const dv = new DataView(buf)
  const bytes = new Uint8Array(buf)
  let eocd = -1
  for (
    let i = bytes.length - 22;
    i >= Math.max(0, bytes.length - 22 - 0xffff);
    i--
  ) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0)
    throw new Error('Not a valid .xlsx file: ZIP end record not found')

  const entries = new Map<string, ZipEntry>()
  let p = dv.getUint32(eocd + 16, true)
  for (let n = dv.getUint16(eocd + 10, true); n > 0; n--) {
    if (dv.getUint32(p, true) !== 0x02014b50)
      throw new Error('Corrupt .xlsx: bad central directory')
    const nameLen = dv.getUint16(p + 28, true)
    const name = new TextDecoder().decode(
      bytes.subarray(p + 46, p + 46 + nameLen)
    )
    const size = dv.getUint32(p + 20, true)
    if (size === 0xffffffff)
      throw new Error('ZIP64 .xlsx files are not supported')
    entries.set(name, {
      method: dv.getUint16(p + 10, true),
      size,
      offset: dv.getUint32(p + 42, true),
    })
    p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true)
  }
  return entries
}

async function readEntry(
  buf: ArrayBuffer,
  entries: Map<string, ZipEntry>,
  name: string
): Promise<string | undefined> {
  const e = entries.get(name)
  if (!e) return undefined
  const dv = new DataView(buf)
  if (dv.getUint32(e.offset, true) !== 0x04034b50) {
    throw new Error(`Corrupt .xlsx: bad local header for ${name}`)
  }
  const start =
    e.offset +
    30 +
    dv.getUint16(e.offset + 26, true) +
    dv.getUint16(e.offset + 28, true)
  const data = new Uint8Array(buf, start, e.size)
  if (e.method === 0) return new TextDecoder().decode(data)
  if (e.method !== 8)
    throw new Error(`Unsupported ZIP compression method ${e.method} in ${name}`)
  const inflated = await new Response(
    new Blob([data])
      .stream()
      .pipeThrough(new DecompressionStream('deflate-raw'))
  ).arrayBuffer()
  return new TextDecoder().decode(inflated)
}

function parseShared(xml: string): string[] {
  return [...xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)].map((m) =>
    [
      ...(m[1] ?? '')
        .replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')
        .matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g),
    ]
      .map((t) => decodeXml(t[1]))
      .join('')
  )
}

function parseSheet(xml: string, shared: string[]): string[][] {
  const grid: string[][] = []
  let width = 0
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const ref = /\br="([A-Z]+)(\d+)"/.exec(m[1])
    if (!ref) continue
    const row = Number(ref[2]) - 1
    const col =
      [...ref[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
    const body = m[2] ?? ''
    const type = attr(m[1], 't')
    const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]
    let value = ''
    if (type === 's') value = shared[Number(raw)] ?? ''
    else if (type === 'inlineStr')
      value = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
        .map((t) => decodeXml(t[1]))
        .join('')
    else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE'
    else if (raw !== undefined) value = decodeXml(raw)
    if (!grid[row]) grid[row] = []
    grid[row][col] = value
    width = Math.max(width, col + 1)
  }
  return Array.from(grid, (r) =>
    Array.from({ length: width }, (_, i) => r?.[i] ?? '')
  )
}

async function parseWorkbook(buf: ArrayBuffer): Promise<Sheet[]> {
  const entries = readZip(buf)
  const workbook = await readEntry(buf, entries, 'xl/workbook.xml')
  if (workbook === undefined)
    throw new Error('Invalid .xlsx: xl/workbook.xml missing')

  const rels =
    (await readEntry(buf, entries, 'xl/_rels/workbook.xml.rels')) ?? ''
  const targets = new Map<string, string>()
  for (const tag of rels.match(/<Relationship\b[^>]*>/g) ?? []) {
    const id = attr(tag, 'Id')
    const target = attr(tag, 'Target')
    if (id && target)
      targets.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`)
  }

  const shared = parseShared(
    (await readEntry(buf, entries, 'xl/sharedStrings.xml')) ?? ''
  )

  const sheets: Sheet[] = []
  for (const tag of workbook.match(/<sheet\b[^>]*>/g) ?? []) {
    const name = attr(tag, 'name')
    const path = targets.get(attr(tag, 'r:id') ?? '')
    if (name === undefined || path === undefined)
      throw new Error('Invalid .xlsx: sheet without a target')
    const xml = await readEntry(buf, entries, path)
    if (xml === undefined) throw new Error(`Invalid .xlsx: ${path} missing`)
    sheets.push({ name, rows: parseSheet(xml, shared) })
  }
  return sheets
}

export async function readXlsx(buf: ArrayBuffer): Promise<Sheet[]> {
  try {
    return await parseWorkbook(buf)
  } catch (err) {
    if (err instanceof RangeError) {
      throw Object.assign(new Error('Corrupt .xlsx: ZIP data out of range'), {
        cause: err,
      })
    }
    throw err
  }
}
