# IRIS Driftline

**See what changed between two IRIS captures, and which scheduled tasks deserve attention.**

IRIS Driftline is a focused, read-only operations workspace built for the [InterSystems Programming Contest: Build Your Own Management Portal](https://community.intersystems.com/post/intersystems-programming-contest-build-your-own-management-portal). It calls the [official SysAdmin API](https://github.com/intersystems-community/sysadmin-api-specification) to show the next 48 hours of scheduled tasks, group non-success run history by task, and compare two captures of tasks, upcoming runs, web applications, and roles. It is not a replacement for the entire Management Portal; it helps an operator answer one question quickly: **what changed, and what may need a closer look?**

## What it does

- Captures `/api/admin/v2/tasks`, `/v2/task/history`, `/v2/task/upcoming`, and `/v2/task/manager` for a schedule and reliability view.
- Reads resource, process, system-usage, audit-enabled, audit-event, journal-file, web-application, and role metadata for context. Web applications, roles, audit counters, and the latest journal file are visible in the UI. Each endpoint is independent: a `403` on one does not suppress the others.
- Compares two captures by stable task ID or configuration name, showing added, removed, and changed records and the fields involved.
- Keeps credentials server-side. The browser receives an allowlisted subset of fields, not raw security objects. Captures live only in the current tab unless explicitly exported as JSON.
- Makes no mutating IRIS API calls. It does not run, pause, edit, or delete tasks.

## Run against IRIS Community Edition

Requires Node.js 20+ and a running InterSystems IRIS 2026.2 Community Edition instance with the SysAdmin API available. The official [Community Edition guide](https://docs.intersystems.com/irislatest/csp/docbook/DocBook.UI.Page.cls?KEY=ACLOUD) explains how to start a container and secure its default accounts. Bind its web port to localhost for local development.

```sh
git clone https://github.com/RowletCC/iris-driftline.git
cd iris-driftline
IRIS_URL=http://127.0.0.1:52773 \
IRIS_USER=_SYSTEM \
IRIS_PASSWORD='your-local-iris-password' \
npm start
```

Open `http://127.0.0.1:8781`. Select **Capture live state**. To compare two moments, select **Set current as baseline**, make a change in your own IRIS instance, then capture again. You can export the current capture as JSON or import a previous baseline. Exports can include system metadata; store them accordingly.

Schedule timestamps come from the IRIS instance clock. Driftline does not infer or convert its time zone, so compare timestamps with the instance's own time setting.

For a quick interface preview without an IRIS instance, run `DEMO=1 npm start`. Demo records are synthetic and labeled as such.

The server binds to `127.0.0.1` by default. If you make it reachable from another host, put authentication and TLS in front of it and use a least-privilege IRIS account. The browser never sees `IRIS_PASSWORD`; do not check credentials into Git.

## Design notes

The local Node server is a same-origin gateway because IRIS intentionally does not return CORS headers for these admin endpoints. A fixed endpoint allowlist prevents it from becoming an arbitrary HTTP proxy. Every IRIS request has a 12-second timeout. The UI uses text nodes instead of HTML injection for API-derived values, and the server sends a restrictive Content Security Policy.

The comparison is deliberately narrow. It does not treat a missing endpoint as a deletion. It can compare only the fields returned to the configured account and the first 500 rows from each list endpoint. The operational pulse is a point-in-time summary, not a time-series monitor; journal-file count is not a log-event count. A human should verify any change before using the Management Portal to act on it.

## Verify

```sh
npm test
```

The tests cover field allowlisting, task-history grouping, stable-key diffs, authentication/path handling with a mock IRIS server, and UI delivery.

Live smoke test: against a disposable IRIS 2026.2 Community Edition container, the initial seven selected SysAdmin endpoints responded; the dashboard rendered 16 tasks, 22 upcoming entries, and no error-coded task history records. The five later operational-context endpoints are verified with a mock API but have not been re-tested against that live container. These counts describe only that local test instance, not a typical production system.

## Contest disclosure

This application and its documentation were developed with AI assistance. The author reviewed the API choices, ran the tests, and verified the application against a local IRIS Community Edition instance. No proprietary or customer IRIS data is included in this repository.
