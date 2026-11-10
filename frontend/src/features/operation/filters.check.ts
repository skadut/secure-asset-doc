import assert from 'node:assert/strict'
import type { DirectoryUser } from '@/lib/access-api'
import { dimKey, filterUsers, groupUsers } from './access.ts'

const users = [
  { username: 'alpha', name: 'Alice North', rankName: 'Captain', golongan: null, accessLevel: 3, unit: 'Zulu', unitHead: false, securityOfficer: false, email: 'hidden@example.test' },
  { username: 'bravo', name: null, rankName: null, golongan: null, accessLevel: 1, unit: null, unitHead: false, securityOfficer: false, email: 'other@example.test' },
  { username: 'charlie', name: 'CHARLIE', rankName: 'Private', golongan: null, accessLevel: 5, unit: 'Alpha', unitHead: false, securityOfficer: false, email: 'charlie@example.test' },
  { username: 'delta', name: 'Delta', rankName: 'Captain', golongan: null, accessLevel: 2, unit: 'Beta', unitHead: false, securityOfficer: false, email: 'delta@example.test' },
] as unknown as DirectoryUser[]

assert.deepEqual(filterUsers(users, { query: '  ALIce ', dim: 'all', value: '' }).map((u) => u.username), ['alpha'])
assert.deepEqual(filterUsers(users, { query: 'BRAV', dim: 'all', value: '' }).map((u) => u.username), ['bravo'])
assert.deepEqual(filterUsers(users, { query: 'zulu captain', dim: 'all', value: '' }), [])
assert.deepEqual(filterUsers(users, { query: 'example.test', dim: 'all', value: '' }), [])
assert.deepEqual(filterUsers(users, { query: '3', dim: 'all', value: '' }), [])
assert.deepEqual(filterUsers(users, { query: 'alpha', dim: 'level', value: '3' }).map((u) => u.username), ['alpha'])
assert.deepEqual(filterUsers(users, { query: '', dim: 'rank', value: 'Captain' }).map((u) => u.username), ['alpha', 'delta'])
assert.deepEqual(filterUsers(users, { query: '', dim: 'unit', value: '__none__' }).map((u) => u.username), ['bravo'])
assert.equal(filterUsers(users, { query: 'alice', dim: 'unit', value: 'Alpha' }).length, 0)
assert.deepEqual(filterUsers(users, { query: 'alice', dim: 'all', value: 'not-a-dim' }).map((u) => u.username), ['alpha'])
assert.equal(dimKey(users[1], 'level'), '1')
assert.deepEqual(groupUsers(users, 'level').map((g) => g.key), ['1', '2', '3', '5'])
assert.deepEqual(groupUsers(users, 'unit').map((g) => g.label), ['Alpha', 'Beta', 'Zulu', 'Tanpa unit'])
assert.deepEqual(groupUsers(users, 'rank').map((g) => g.label), ['Captain', 'Tanpa pangkat', 'Private'])
assert.deepEqual(groupUsers(users, 'rank')[0].users.map((u) => u.username), ['alpha', 'delta'])
assert.deepEqual(groupUsers(users, 'all'), [{ key: 'all', label: 'Semua pengguna', users }])

