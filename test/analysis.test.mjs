import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, diffSnapshots, projectRows } from '../lib/analysis.mjs';

test('projection discards sensitive or undocumented fields', () => {
  assert.deepEqual(projectRows('webApps', [{ Name: '/sample', Namespace: 'USER', Secret: 'do-not-export' }]), [{ Name: '/sample', Namespace: 'USER' }]);
});

test('task analysis counts suspended work and groups non-success runs', () => {
  const report = analyze({ data: {
    tasks: [{ Id: 1, Suspended: true }, { Id: 2, Suspended: false }],
    upcoming: [{ Id: 2 }],
    history: [
      { TaskId: 1, Name: 'Archive', LastStart: '2026-09-23 12:00:00', Status: 'Error' },
      { TaskId: 1, Name: 'Archive', LastStart: '2026-09-23 11:00:00', Status: 'Success' }
    ]
  } });
  assert.equal(report.taskCount, 2);
  assert.equal(report.suspendedCount, 1);
  assert.equal(report.failureCount, 1);
  assert.deepEqual(report.hotTasks[0], { name: 'Archive', total: 2, failures: 1, latest: '2026-09-23 12:00:00' });
});

test('IRIS numeric success, running, and error status codes are classified correctly', () => {
  const report = analyze({ data: { tasks: [], upcoming: [], history: [
    { TaskId: 1, Name: 'Archive', Status: '1', Result: 'Task Has Expired for a missed run', ErrNumber: 0 },
    { TaskId: 1, Name: 'Archive', Status: '-1', ErrNumber: 0 },
    { TaskId: 1, Name: 'Archive', Status: '-3', ErrNumber: 0 },
    { TaskId: 2, Name: 'Refresh', Status: '1', ErrNumber: 42 }
  ] } });
  assert.equal(report.failureCount, 2);
  assert.equal(report.hotTasks[0].failures, 1);
  assert.equal(report.hotTasks[1].failures, 1);
});

test('diff identifies added, removed and changed task records', () => {
  const before = { capturedAt: 'a', data: { tasks: [{ Id: 1, Name: 'A', Suspended: false }, { Id: 2, Name: 'B' }] } };
  const after = { capturedAt: 'b', data: { tasks: [{ Id: 1, Name: 'A', Suspended: true }, { Id: 3, Name: 'C' }] } };
  const diff = diffSnapshots(before, after);
  assert.equal(diff.count, 3);
  assert.deepEqual(diff.changes.map(c => `${c.type}:${c.key}`), ['changed:1', 'added:3', 'removed:2']);
  assert.equal(diff.changes[0].fields[0].field, 'Suspended');
});

test('an unavailable endpoint is not interpreted as deleted configuration', () => {
  const before = { capturedAt: 'a', data: { roles: [{ Name: '%Developer' }] } };
  const after = { capturedAt: 'b', data: {} };
  const diff = diffSnapshots(before, after);
  assert.equal(diff.count, 0);
  assert.ok(diff.unavailable.includes('roles'));
});
