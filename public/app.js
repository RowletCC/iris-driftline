const $ = id => document.getElementById(id);
let current = null;
let baseline = null;

function elem(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = String(text);
  return node;
}

function clear(node) { node.replaceChildren(); node.classList.remove('empty'); }
function prettyDate(value) {
  if (!value) return '—';
  const iso = /^\d{4}-\d{2}-\d{2}T/.test(value);
  if (iso) return new Date(value).toLocaleString();
  return value;
}
function toast(message, isError = false) {
  const node = $('toast');
  node.textContent = message; node.classList.toggle('error', isError); node.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove('show'), 4400);
}
function field(id, value) { $(id).textContent = String(value); }

function renderSchedule(rows) {
  const host = $('schedule'); clear(host);
  if (!rows?.length) { host.classList.add('empty'); host.textContent = 'No upcoming tasks in this window.'; return; }
  for (const row of [...rows].sort((a,b) => String(a.Datetime).localeCompare(String(b.Datetime))).slice(0, 24)) {
    const card = elem('div', 'schedule-row');
    const time = elem('time', 'schedule-time', prettyDate(row.Datetime));
    const info = elem('div', 'schedule-info');
    info.append(elem('strong', '', row.Name || `Task ${row.Id}`), elem('small', '', row.Namespace || 'Namespace unknown'));
    const state = elem('span', row.Suspended ? 'state paused' : 'state', row.Suspended ? 'Suspended' : 'Scheduled');
    card.append(time, info, state); host.append(card);
  }
  if (rows.length > 24) host.append(elem('p', 'truncation', `Showing 24 of ${rows.length} upcoming tasks.`));
}

function renderFailures(rows) {
  const host = $('failures'); clear(host);
  if (!rows?.length) { host.classList.add('empty'); host.textContent = 'No non-success runs in the retrieved history.'; return; }
  for (const row of rows) {
    const card = elem('div', 'failure-row');
    const title = elem('div', 'failure-title');
    title.append(elem('strong', '', row.name), elem('span', 'failure-number', `${row.failures}/${row.total}`));
    card.append(title, elem('small', '', `Latest run ${prettyDate(row.latest)}`)); host.append(card);
  }
}

function renderSurfaces(data) {
  const host = $('surfaces'); clear(host);
  for (const [label, rows, format] of [
    ['WEB APPS', data.webApps, row => `${row.Name || 'Unnamed app'} · ${row.Namespace || 'namespace unknown'} · ${row.Enabled === false ? 'disabled' : 'enabled/unknown'}`],
    ['ROLES', data.roles, row => row.Name || 'Unnamed role']
  ]) {
    host.append(elem('div', 'context-list-label', label));
    if (!rows) host.append(elem('div', 'context-row muted', 'Endpoint unavailable for this account.'));
    else if (!rows.length) host.append(elem('div', 'context-row muted', 'No rows returned.'));
    else {
      for (const row of rows.slice(0, 5)) host.append(elem('div', 'context-row', format(row)));
      if (rows.length > 5) host.append(elem('div', 'context-row muted', `${rows.length - 5} more in exported capture.`));
    }
  }
}

function renderEvidence(data, insights) {
  const host = $('evidence'); clear(host);
  field('audit-loss', insights?.auditLossCount == null ? '— lost' : `${insights.auditLossCount} lost`);
  host.append(elem('div', 'context-list-label', 'AUDIT EVENTS'));
  if (!data.auditEvents) host.append(elem('div', 'context-row muted', 'Endpoint unavailable for this account.'));
  else if (!data.auditEvents.length) host.append(elem('div', 'context-row muted', 'No event definitions returned.'));
  else {
    for (const row of [...data.auditEvents].sort((a, b) => (Number(b.Lost) || 0) - (Number(a.Lost) || 0)).slice(0, 4)) {
      host.append(elem('div', 'context-row', `${row.EventName || 'Unnamed event'} · ${row.Lost ?? '—'} lost`));
    }
    if (data.auditEvents.length > 4) host.append(elem('div', 'context-row muted', `${data.auditEvents.length - 4} more in exported capture.`));
  }
  host.append(elem('div', 'context-list-label', 'JOURNAL FILES'));
  if (!data.journals) host.append(elem('div', 'context-row muted', 'Endpoint unavailable for this account.'));
  else if (!data.journals.length) host.append(elem('div', 'context-row muted', 'No files returned.'));
  else {
    const recent = [...data.journals].sort((a, b) => String(b.CreationTime || '').localeCompare(String(a.CreationTime || '')))[0];
    host.append(elem('div', 'context-row', `Latest created ${prettyDate(recent.CreationTime)} · ${Number(recent.Size || 0).toLocaleString()} bytes`));
  }
}

async function renderDiff() {
  const host = $('changes'); clear(host);
  if (!baseline || !current) { host.classList.add('empty'); host.textContent = 'The change review will appear after two captures.'; field('change-count', '— changes'); return; }
  try {
    const response = await fetch('/api/diff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ before: baseline, after: current }) });
    if (!response.ok) throw new Error(`Comparison failed (${response.status})`);
    const diff = await response.json();
    field('change-count', `${diff.count} ${diff.count === 1 ? 'change' : 'changes'}`);
    if (!diff.changes.length) {
      host.classList.add('empty');
      host.textContent = diff.unavailable?.length
        ? `No changes in comparable data. Unavailable in one capture: ${diff.unavailable.join(', ')}.`
        : 'No task or configuration changes detected between these captures.';
      return;
    }
    for (const entry of diff.changes.slice(0, 50)) {
      const card = elem('div', 'change-row');
      card.append(elem('span', `change-badge ${entry.type}`, entry.type.toUpperCase()), elem('strong', '', `${entry.kind} / ${entry.key}`));
      if (entry.fields?.length) card.append(elem('small', '', entry.fields.map(f => f.field).join(' · ')));
      host.append(card);
    }
    if (diff.count > 50) host.append(elem('p', 'truncation', `Showing 50 of ${diff.count} changes.`));
    if (diff.unavailable?.length) host.append(elem('p', 'truncation', `Not compared (unavailable in one capture): ${diff.unavailable.join(', ')}.`));
  } catch (error) { host.classList.add('empty'); host.textContent = error.message; }
}

function renderSnapshot(snapshot) {
  current = snapshot;
  field('source', snapshot.source || 'Unknown instance');
  field('capture-time', prettyDate(snapshot.capturedAt));
  const errorCount = Object.keys(snapshot.errors || {}).length;
  const isDemo = snapshot.source?.startsWith('Synthetic demo');
  field('capture-status', isDemo ? 'Synthetic dataset; no IRIS requests were sent.' : errorCount ? `${errorCount} endpoint${errorCount === 1 ? '' : 's'} unavailable; remaining data is shown.` : 'All selected endpoints responded.');
  field('task-count', snapshot.insights?.taskCount ?? '—');
  field('suspended-count', snapshot.insights?.suspendedCount ?? '—');
  field('upcoming-count', snapshot.insights?.upcomingCount ?? '—');
  field('failure-count', snapshot.insights?.failureCount ?? '—');
  field('process-count', snapshot.insights?.processCount ?? '—');
  field('audit-enabled', snapshot.insights?.auditEnabled == null ? '—' : snapshot.insights.auditEnabled ? 'On' : 'Off');
  field('journal-count', snapshot.insights?.journalCount ?? '—');
  field('global-references', snapshot.data.systemUsage?.[0]?.AllGlobalReferences?.toLocaleString() ?? '—');
  field('webapp-count', snapshot.data.webApps?.length ?? '—');
  field('role-count', snapshot.data.roles?.length ?? '—');
  field('resource-count', snapshot.data.resources?.length ?? '—');
  field('manager-status', `Manager ${snapshot.data.manager?.[0]?.Status || 'unavailable'}`);
  renderSchedule(snapshot.data.upcoming);
  renderFailures(snapshot.insights?.hotTasks);
  renderSurfaces(snapshot.data);
  renderEvidence(snapshot.data, snapshot.insights);
  $('baseline').disabled = false; $('export').disabled = false;
  renderDiff();
  if (isDemo) toast('Synthetic demo state loaded.');
  else if (errorCount) toast('Capture completed with limited API permissions. See the JSON export for endpoint errors.', true);
  else toast('Live state captured.');
}

$('refresh').addEventListener('click', async () => {
  const button = $('refresh'); button.disabled = true; button.textContent = 'Capturing…';
  try {
    const response = await fetch('/api/snapshot', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Capture failed (${response.status})`);
    renderSnapshot(await response.json());
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; button.textContent = current?.source?.startsWith('Synthetic demo') ? 'Advance demo snapshot ↗' : 'Capture live state ↗'; }
});

$('baseline').addEventListener('click', () => {
  if (!current) return;
  baseline = structuredClone(current);
  field('baseline-time', `Baseline · ${prettyDate(baseline.capturedAt)}`);
  renderDiff(); toast('Baseline saved in this tab. Capture again to compare.');
});

$('export').addEventListener('click', () => {
  if (!current) return;
  const blob = new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob);
  link.download = `iris-driftline-${current.capturedAt.replace(/[:.]/g, '-')}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});

$('import').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    if (file.size > 2_000_000) throw new Error('Baseline is too large (2 MB maximum).');
    const value = JSON.parse(await file.text());
    if (!value || typeof value.capturedAt !== 'string' || !value.data || typeof value.data !== 'object') throw new Error('This is not a Driftline snapshot.');
    baseline = value; field('baseline-time', `Baseline · ${prettyDate(value.capturedAt)}`);
    renderDiff(); toast('Baseline imported.');
  } catch (error) { toast(error.message, true); }
  event.target.value = '';
});
