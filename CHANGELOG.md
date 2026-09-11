# Changelog

## 0.1.0 — 2026-09-10

First release. 46 operations across 11 resources of the Roistat REST API v1, plus a webhook
trigger.

**Roistat** — Analytics (report, statuses funnel, metric and dimension dictionaries,
attribution models, custom metric values), Deal, Lead, Site Lead, Client, Call, Visit,
Advertising Cost, Event, Statistic, Project.

**Roistat Trigger** — receives the calltracking webhooks and any scenario that calls a URL.
Roistat has no API for managing webhooks, so the address is pasted into Roistat by hand and
the trigger registers nothing. An optional shared secret in the query string can be required.

Checked against a live paid project on 11.09.2026 — every reading operation, every dropdown.
Four things the documentation gets wrong came out of that and are fixed here:

- a filter holding exactly one condition inside `and` crashes Roistat with `500
  internal_error`; the node now sends a single condition as a flat list;
- metrics in an analytics report arrive as an **array** of
  `{value, formatted, metric_name, attribution_model_id}`, not the documented object keyed by
  metric name — Simplify Output used to produce rows keyed `0, 1, 2, 3`;
- the funnel report refuses a request without `next_dimensions`, which the docs call optional;
- the channel list carries `source`/`title`, not the documented `name`/`system_name`, so the
  Channel dropdowns were lists of empty strings. They now list top-level channels only: a live
  project had 18 121 channels across three levels in one 2.3 MB answer.

Also from that run: error text lives in `description` rather than `message`, a 402 names the
missing option in `details.option`, and `/project/settings/counter/list` — which the credential
test used to call — answers 404 on a live project. The test now calls
`/project/analytics/attribution-models`.

The writing half of the API has not been run: the only project available was a live one. Those
operations are written from the documentation.

Notes on this release:

- every request carries `Use-Http-Code: 1`, without which Roistat answers 200 to failures and
  hides the real code in the body;
- the client-side throttle covers all four documented limits, including the 5-per-hour ceiling
  on `Statistic → Get Daily` and the sliding limit on `Deal → Get Many` with Include Visit;
- the credential has no `authenticate` block, so it cannot be selected inside an HTTP Request
  node;
- written against the documentation. The requests have not been run against a paid Roistat
  project — see the end of the README.
