import assert from 'node:assert/strict';
import { clampDays, dashboardQueries } from './dashboard.mjs';

// clampDays tests
assert.equal(clampDays('5'), 5, '5 stays 5');
assert.equal(clampDays('100'), 30, 'clamp upper');
assert.equal(clampDays('0'), 1, 'clamp lower');
assert.equal(clampDays(undefined), 14, 'default 14');
assert.equal(clampDays('invalid'), 14, 'non-number defaults');

// dashboardQueries returns query map
const dq = dashboardQueries(14);
assert.ok(dq.sessions, 'sessions query exists');
assert.ok(dq.access, 'access query exists');
assert.ok(dq.heatmap, 'heatmap query exists');
assert.ok(dq.series, 'series query exists');

// series query should include $1 placeholder for days
assert.ok(dq.series[0].includes('$1'), 'series uses days param');

console.log('dashboard.check.mjs passed');
