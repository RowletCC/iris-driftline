const fields = {
  tasks: ['Id', 'Name', 'Type', 'Namespace', 'Description', 'Suspended', 'LastFinished', 'NextScheduled'],
  upcoming: ['Id', 'Name', 'Namespace', 'Datetime', 'Suspended'],
  history: ['TaskId', 'Name', 'Namespace', 'LastStart', 'Completed', 'LogDatetime', 'Status', 'Result', 'ErrNumber'],
  webApps: ['Name', 'Namespace', 'Enabled', 'AuthenticationMethods', 'Resource', 'Description'],
  roles: ['Name', 'Description'],
  resources: ['Name', 'Seize', 'Nseize', 'Aseize', 'Bseize', 'BusySet'],
  manager: ['Status']
};

export function projectRows(kind, rows) {
  const keep = fields[kind];
  const input = Array.isArray(rows) ? rows : kind === 'manager' && rows ? [rows] : [];
  return input.map(row => Object.fromEntries(keep.filter(k => Object.hasOwn(row, k)).map(k => [k, row[k]])));
}

export function analyze(snapshot) {
  const tasks = snapshot.data.tasks || [];
  const history = snapshot.data.history || [];
  const upcoming = snapshot.data.upcoming || [];
  // IRIS task history uses "1" for success and -1 for a running job.
  // Only documented error codes or explicit errors belong in the alert count.
  const isFailure = row => Number(row.ErrNumber) > 0 ||
    [-2, -3, -4, -5].includes(Number(row.Status)) ||
    /^(error|failed|failure)$/i.test(String(row.Status || '').trim());
  const failures = history.filter(isFailure);
  const recent = history.filter(row => row.LastStart);
  const byTask = new Map();
  for (const h of history) {
    const key = String(h.TaskId ?? h.Name ?? 'unknown');
    const current = byTask.get(key) || { name: h.Name || key, total: 0, failures: 0, latest: '' };
    current.total += 1;
    if (isFailure(h)) current.failures += 1;
    const recorded = String(h.LastStart || h.LogDatetime || '');
    if (recorded > current.latest) current.latest = recorded;
    byTask.set(key, current);
  }
  return {
    taskCount: tasks.length,
    suspendedCount: tasks.filter(t => t.Suspended === true || t.Suspended === 1).length,
    upcomingCount: upcoming.length,
    historyCount: recent.length,
    failureCount: failures.length,
    hotTasks: [...byTask.values()].filter(t => t.failures).sort((a, b) => b.failures - a.failures || b.total - a.total).slice(0, 8)
  };
}

function keyFor(kind, row) {
  if (kind === 'tasks' || kind === 'upcoming') return String(row.Id ?? `${row.Namespace || ''}/${row.Name || ''}`);
  if (kind === 'webApps' || kind === 'roles') return String(row.Name || '');
  return '';
}

function changeFields(before, after) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k])).map(k => ({ field: k, before: before[k] ?? null, after: after[k] ?? null }));
}

export function diffSnapshots(before, after) {
  const changes = [];
  const unavailable = [];
  for (const kind of ['tasks', 'upcoming', 'webApps', 'roles']) {
    if (!Array.isArray(before.data?.[kind]) || !Array.isArray(after.data?.[kind])) {
      unavailable.push(kind);
      continue;
    }
    const first = new Map((before.data?.[kind] || []).map(row => [keyFor(kind, row), row]));
    const second = new Map((after.data?.[kind] || []).map(row => [keyFor(kind, row), row]));
    for (const [key, row] of second) {
      if (!first.has(key)) changes.push({ kind, key, type: 'added', after: row });
      else {
        const fields = changeFields(first.get(key), row);
        if (fields.length) changes.push({ kind, key, type: 'changed', fields });
      }
    }
    for (const [key, row] of first) if (!second.has(key)) changes.push({ kind, key, type: 'removed', before: row });
  }
  return { from: before.capturedAt, to: after.capturedAt, changes, count: changes.length, unavailable };
}

export function validSnapshot(value) {
  return Boolean(value && typeof value === 'object' && typeof value.capturedAt === 'string' && value.data && typeof value.data === 'object');
}
