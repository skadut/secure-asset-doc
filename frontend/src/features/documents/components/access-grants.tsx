import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ConfirmDialog } from '@/components/confirm-dialog'

type Grant = {
  username: string
  rankName: string
  accessLevel: number
  grantedBy: string
  grantedAt: string
  expiresAt: string | null
  active: boolean
}

type GrantUser = {
  username: string
  rankName: string
  golongan: string
  accessLevel: number
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Request failed'

async function request(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...init,
    headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
  })
  if (!res.ok) {
    const json: { error?: string } = await res.json().catch(() => ({}))
    throw new Error(
      res.status === 403 ? 'Not allowed' : (json.error ?? `HTTP ${res.status}`)
    )
  }
  return res
}

const grantsUrl = (documentId: string) =>
  `/api/documents/${encodeURIComponent(documentId)}/grants`

const getJson = async <T,>(url: string): Promise<T> =>
  (await request(url)).json() as Promise<T>

export function AccessGrants({ documentId }: { documentId: string }) {
  const queryClient = useQueryClient()
  const queryKey = ['document-grants', documentId]
  const today = new Date().toISOString().slice(0, 10)

  const grants = useQuery({
    queryKey,
    queryFn: async () => {
      try {
        return await getJson<Grant[]>(grantsUrl(documentId))
      } catch (error) {
        toast.error(errorMessage(error))
        throw error
      }
    },
    retry: false,
  })
  const users = useQuery({
    queryKey: ['grant-users'],
    queryFn: async () => {
      try {
        return await getJson<GrantUser[]>('/api/users')
      } catch (error) {
        toast.error(errorMessage(error))
        throw error
      }
    },
    retry: false,
  })

  const [username, setUsername] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null)

  const refresh = () => queryClient.invalidateQueries({ queryKey })

  const add = useMutation({
    mutationFn: () =>
      request(grantsUrl(documentId), {
        method: 'POST',
        body: JSON.stringify(
          expiresAt ? { username, expiresAt } : { username }
        ),
      }),
    onSuccess: () => {
      toast.success(`Grant added for ${username}`)
      setUsername('')
      setExpiresAt('')
      void refresh()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const revoke = useMutation({
    mutationFn: (target: string) =>
      request(`${grantsUrl(documentId)}/${encodeURIComponent(target)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      toast.success('Grant revoked')
      setRevokeTarget(null)
      void refresh()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  return (
    <section className='flex min-w-0 flex-col gap-4'>
      <h2 className='text-lg font-semibold'>Access grants</h2>

      {grants.isPending ? (
        <p className='text-muted-foreground'>Loading grants…</p>
      ) : grants.data?.length ? (
        <div className='overflow-x-auto rounded-md border'>
          <Table className='min-w-3xl'>
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Rank</TableHead>
                <TableHead>Level</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className='sr-only'>Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grants.data.map((grant) => (
                <TableRow key={grant.username}>
                  <TableCell className='font-mono'>{grant.username}</TableCell>
                  <TableCell>{grant.rankName}</TableCell>
                  <TableCell className='font-mono tabular-nums'>
                    {grant.accessLevel}
                  </TableCell>
                  <TableCell className='font-mono tabular-nums'>
                    {grant.expiresAt
                      ? grant.expiresAt.slice(0, 10)
                      : 'No expiry'}
                  </TableCell>
                  <TableCell>
                    {!grant.active && (
                      <Badge variant='destructive'>Expired</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant='outline'
                      size='sm'
                      aria-label={`Revoke grant for ${grant.username}`}
                      onClick={() => setRevokeTarget(grant.username)}
                    >
                      Revoke
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className='text-muted-foreground'>No grants for this document.</p>
      )}

      <form
        className='flex min-w-0 flex-col gap-3 rounded-md border p-4 sm:flex-row sm:flex-wrap sm:items-end'
        onSubmit={(e) => {
          e.preventDefault()
          if (username) add.mutate()
        }}
      >
        <div className='flex min-w-0 flex-col gap-1.5 sm:min-w-56 sm:flex-1'>
          <Label htmlFor='grant-user'>User</Label>
          <Select
            value={username}
            onValueChange={setUsername}
            disabled={users.isPending}
          >
            <SelectTrigger id='grant-user' className='w-full'>
              <SelectValue
                placeholder={users.isPending ? 'Loading users…' : 'Select user'}
              />
            </SelectTrigger>
            <SelectContent>
              {(users.data ?? []).map((user) => (
                <SelectItem key={user.username} value={user.username}>
                  {user.username} · {user.rankName} · Level {user.accessLevel}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='flex min-w-0 flex-col gap-1.5'>
          <Label htmlFor='grant-expires'>Expiry (optional)</Label>
          <Input
            id='grant-expires'
            type='date'
            min={today}
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </div>
        <Button type='submit' disabled={!username || add.isPending}>
          Add grant
        </Button>
      </form>

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null)
        }}
        title='Revoke access'
        desc={`Remove the grant for ${revokeTarget ?? ''}? They will lose access to this document.`}
        destructive
        confirmText='Revoke'
        isLoading={revoke.isPending}
        handleConfirm={() => {
          if (revokeTarget) revoke.mutate(revokeTarget)
        }}
      />
    </section>
  )
}
