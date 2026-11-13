import assert from 'node:assert/strict';
import { truncate, isCredentialColumn, maskCell, quoteIdent, clampLimit, clampOffset, resolveTable, buildSelectSql } from './dbview.mjs';

function main() {
  // truncation
  assert.equal(truncate('a'.repeat(500)), 'a'.repeat(300) + '… (500 chars)');
  assert.equal(truncate('abc'), 'abc');
  assert.equal(truncate(42), 42);

  // credential masking
  assert.equal(isCredentialColumn('password_hash'), true);
  assert.equal(isCredentialColumn('totp_secret'), true);
  assert.equal(isCredentialColumn('Password'), true);
  assert.equal(isCredentialColumn('token_hash'), false);
  assert.equal(isCredentialColumn('username'), false);
  assert.equal(maskCell('password_hash', '$2b$hash'), '[DISEMBUNYIKAN]');
  assert.equal(maskCell('totp_secret', 'JBSWY3DP'), '[DISEMBUNYIKAN]');
  assert.equal(maskCell('password_hash', null), null);
  assert.equal(maskCell('token_hash', 'abc'), 'abc');
  assert.equal(maskCell('username', 'alice'), 'alice');
  assert.equal(maskCell('id', 42), 42);

  // quoting
  assert.equal(quoteIdent('a"b'), '"a""b"');
  assert.equal(quoteIdent('users'), '"users"');

  // clamping
  assert.equal(clampLimit(undefined), 50);
  assert.equal(clampLimit(0), 1);
  assert.equal(clampLimit(999), 200);
  assert.equal(clampLimit('abc'), 50);
  assert.equal(clampLimit('25'), 25);
  assert.equal(clampOffset(-5), 0);
  assert.equal(clampOffset('10'), 10);
  assert.equal(clampOffset(undefined), 0);

  // table resolution
  assert.equal(resolveTable('users', ['users', 'sessions']), 'users');
  assert.equal(resolveTable('USERS', ['users']), null);
  assert.equal(resolveTable(' users', ['users']), null);
  assert.equal(resolveTable('users; drop table x', ['users']), null);

  // sql building
  const cols = [{ name: 'id', dataType: 'uuid' }, { name: 'password_hash', dataType: 'text' }];
  const sql = buildSelectSql('users', cols, 'id', 50, 0);
  assert.ok(sql.includes('"password_hash"'));
  assert.equal(sql.includes('NULL AS password_hash'), false);
  assert.equal(sql.includes('NULL AS "password_hash"'), false);
  assert.ok(sql.includes('"id"'));
  assert.ok(sql.includes('LIMIT $1 OFFSET $2'));
  assert.equal(buildSelectSql('users', cols, null, 50, 0).includes('ORDER BY'), false);
  assert.ok(buildSelectSql('users', cols, 'password_hash', 50, 0).includes('ORDER BY "password_hash"'));

  console.log('dbview check ok');
}

main();
