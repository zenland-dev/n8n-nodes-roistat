# n8n-nodes-roistat

n8n community nodes for [Roistat](https://roistat.com) — end-to-end marketing analytics:
46 operations across 11 resources of its REST API, plus a webhook trigger for calls.

Roistat ties a website visit to the advertising channel that brought it, follows that visit
into a CRM deal, and reports what each channel earned. Most of what people build around it
in n8n is one of three things: pull a report on a schedule, feed it the numbers it cannot
collect by itself (spend for a channel with no integration, deals from a CRM it is not
connected to), or react to a call.

Written from scratch against [Roistat's own API documentation](https://help-en.roistat.com/API/methods/about/).
No code from any other package.

- [Installation](#installation)
- [Credentials](#credentials)
- [Roistat node](#roistat-node)
- [Roistat Trigger](#roistat-trigger)
- [Rate limits](#rate-limits)
- [Quirks worth knowing](#quirks-worth-knowing)
- [What is not here](#what-is-not-here)
- [Feedback and bugs](#feedback-and-bugs)

## Installation

In n8n: **Settings → Community nodes → Install**, then enter `n8n-nodes-roistat`.

Self-hosted, from the command line:

```bash
npm install n8n-nodes-roistat
```

Requires n8n 2.x and Node 20.19 or newer.

## Credentials

Both nodes share one credential, **Roistat API**, and it has two fields that matter.

**API Key** — from Профиль → Настройки → API key. One key per Roistat profile, not per
project: it opens every project that profile can see. There is no OAuth and no scoping, so
treat it as an account-wide secret.

**Project ID** — the digits in the project URL, `12345` in `cloud.roistat.com/project/12345`.
Every API call names a project, and since the key covers several, the number is a separate
field. Pasting the whole URL works; everything but the digits is dropped. Every operation has
its own **Project ID** field that overrides this one per item, which is what an agency with
one key and twenty clients needs.

The **Test** button calls `/project/settings/counter/list`, the cheapest call that needs both
halves. It reports a wrong key and a wrong project number separately, and it can only do that
because the node sends the `Use-Http-Code: 1` header — see [Quirks](#quirks-worth-knowing).

The credential deliberately has no `authenticate` block, so n8n never offers it inside an
HTTP Request node. Nothing is lost: Roistat serves one host, `cloud.roistat.com`, so there is
no address field to point anywhere, and both nodes attach the header themselves.

## Roistat node

| Resource | Operations |
|---|---|
| **Analytics** | Get Report, Get Funnel Report, Get Metrics, Get Dimensions, Get Dimension Values, Get Attribution Models, Set Custom Metric Value |
| **Deal** | Get Many, Get, Upload, Update Status, Delete, Get External URL, Get Statuses, Set Statuses, Get Custom Fields |
| **Lead** | Get Many, Create, Update, Get Statuses |
| **Site Lead** | Get Many, Get |
| **Client** | Get Many, Get Feed, Import |
| **Call** | Get Many, Create, Get Recording, Get Dashboard, Get Phones |
| **Visit** | Get Many, Update Params |
| **Advertising Cost** | Get Many, Add, Update, Delete, Get Channels |
| **Event** | Send, Send Many, Create |
| **Statistic** | Get Daily |
| **Project** | Get Many, Create, Get Counter, Get Access, Set Access |

### Deal, Lead and Site Lead are three different things

The split is Roistat's own, not this node's, and it decides which half of the node works at all.

A project integrated with a CRM receives **deals** — the Deal resource. A project without
one uses «Управление заявками», Roistat's built-in lead board, and those are **leads** — the
Lead resource. A project uses one or the other, and the methods of the wrong half answer with
an error rather than an empty list.

**Site Lead** is neither. Roistat's own widgets — the callback form, the lead catcher — record
the submission before anything else happens to it, together with the visit that produced it.
That record survives even when the CRM never got the deal, which is exactly when you want to
read it. Its `order_id` field is empty in that case.

### Analytics: dimensions and metrics come from the project

`Get Report` is the same data the Аналитика screen draws. Pick what to group by (dimensions)
and what to count (metrics) — both dropdowns read the project's own dictionaries, because the
vocabulary differs per project: no calltracking option means no call metrics.

**Simplify Output** is on by default and worth understanding. Roistat sends every metric as
`{value, formatted, metric_name, attribution_model_id}` and every dimension as
`{value, title, icon}`. With Simplify on, a row becomes

```json
{ "marker_level_1": "Yandex.Direct", "visits": 7556, "roi": 27, "_row": "item" }
```

and the originals stay under `_dimensions` and `_metrics`. With it off, the row arrives
exactly as Roistat sent it. Note `_row`: each interval also produces a totals row, tagged
`total` instead of `item`, because an average of ROI is not the ROI of the average and
recomputing it downstream gives a different number.

**Attribution Model** only changes metrics whose dictionary entry has
`is_has_attribution_model` set. Visits and costs are counted the same way whatever is picked.
The node reads the metric dictionary first and attaches the model only where it means
something — sending `{metric: "visits", attribution: "first_click"}` is a validation error,
and it names a metric the user never thought about.

### The visit number is what makes any of this work

`Upload` a deal, `Create` a lead, `Create` a call: each has a field for the visit number —
the value of the `roistat_visit` cookie, called `roistat` on deals and `source` on leads.
Without it Roistat has nothing to attribute the row to, and it lands in «Прямые заходы». The
request still succeeds. Nothing warns you. The report is quietly wrong a month later.

`Upload` answers with a tally rather than the deal: `{"uploaded": 0, "processed": 1,
"skipped_by_waiting_visit_info": 1, …}`. That particular combination is normal and means
Roistat has not seen that visit yet — it will match the deal up when it does.

### Get Recording gives you an MP3

`Call → Get Recording` puts the file in a binary field, `data` by default. A call with no
recording answers 200 with an empty body, and the node raises an error naming the call rather
than passing on a zero-byte file. If the recording lives with a third-party calltracking
provider, the call's own `link` field points at it instead.

## Roistat Trigger

**Roistat has no API for webhooks.** No subscribe, no unsubscribe, no listing. So this
trigger cannot register itself, and the address has to be pasted into Roistat by hand:

- for calls — Коллтрекинг → the scenario → Настройте интеграцию, into **Webhook в момент
  звонка** or **Webhook после звонка**;
- for anything else — a scenario in Автоматизация маркетинга with a URL action.

Three consequences follow, and all three are worth knowing before wiring anything up:

1. **Each of those fields holds exactly one address.** Pasting a second workflow into it
   replaces the first, and nothing in Roistat says so.
2. **Deactivating the workflow does not stop the deliveries.** Roistat keeps posting to a URL
   n8n is no longer listening on. Clear the field in Roistat to stop it.
3. **"Listen for test event" gets you a different URL** than the active workflow, so testing
   means pasting the test URL in, and pasting the real one back afterwards.

The in-call and after-call bodies differ: the first has the caller, the number dialled, the
visit and the source, the second adds `status`, `duration` and `link`. **Call Statuses** filters
on the second — leave it empty to pass everything, or pick `NOANSWER`, `BUSY` and `CANCEL` for
a workflow that chases missed calls.

A calltracking webhook always posts. A scenario in Автоматизация маркетинга can be set to
call the URL with GET instead — for that, set **Event** to *Any* and **HTTP Method** to *GET*,
and the query parameters arrive as the item.

Deliveries carry no signature and no headers of yours, so the URL is the only thing keeping
them private. **Shared Secret** is a second lock: set one, append `?token=<secret>` to the
address you paste into Roistat, and anything arriving without it gets a 403.

## Rate limits

Roistat counts these **per project, across every integration touching it** — your workflow,
someone else's, and the Roistat interface itself. Going over answers 429 for all of them.

| Scope | Limit |
|---|---|
| Everything | 10 requests per second, 5000 per hour |
| `Deal → Get Many` | 20 per minute |
| `Deal → Get Many` with Include Visit | 10 per minute; 5 above 100 rows a page, 1 above 1000 |
| `Statistic → Get Daily` | **5 per hour** |

The node paces itself against all of them. The two project-wide budgets are queues: requests
wait their turn, and the credential's **Requests per Second** (8 by default) and **Requests per
Hour** (4000) leave room for whatever else uses the project. The per-method budgets are not
queues — when one is spent and the wait would be over a minute, the node refuses with a message
naming the limit. Five calls an hour means the sixth would wait twelve minutes, and a workflow
parked that long reads as broken.

So: ask `Get Daily` for a whole month in one call. A loop over days runs out of budget on the
sixth day.

## Quirks worth knowing

Everything below was checked against a live project on 11.09.2026, not taken from the
documentation. Several of these contradict it.

**Roistat answers 200 to failures.** By default every error, a rejected key included, comes
back as `200 OK` with the real code inside the body. Every request this node makes carries
`Use-Http-Code: 1`, which switches that off. Worth knowing if you also call the API from an
HTTP Request node: without that header a credential test passes on any key at all.

**A filter with exactly one condition crashes the server.** `{"and": [["date", ">=", …]]}`
answers `500 internal_error` on the visit list and the deal list alike; the same condition as
a bare list, `[["date", ">=", …]]`, answers 200, and two conditions inside `and` answer 200.
The node sends one condition flat and several as a tree, so you will not meet this — unless
you write an `and` of one yourself in the Filters field.

**Metrics in a report come back as an array, not an object.** The documentation shows
`{"visits": {...}, "roi": {...}}`. A live project sends
`[{value, formatted, metric_name, attribution_model_id}, …]`. Simplify Output reads both, keyed
by `metric_name`; a metric requested under a non-default attribution model gets the model
appended to its key, so two attributions of one metric do not overwrite each other.

**The funnel report requires `next_dimensions`,** which the documentation calls optional.
Without it: `400 incorrect_request — Required argument next_dimensions is missing`. The node
always sends it, empty when you picked nothing.

**The channel list is enormous and not shaped as documented.** 18 121 channels in one 2.3 MB
answer on the project this was checked against: 955 at level 1, 4 998 at level 2, 12 168 at
level 3. Rows carry `source`, `title`, `type` and `level` — not the `name` and `system_name` the
docs describe. The Channel dropdowns therefore list level 1 only; for a deeper channel, switch
the field to an expression and enter its system name. `Advertising Cost → Get Channels` still
returns the whole tree.

**Errors put their text in `description`, not `message`,** and a 402 names the missing option
under `details.option`. A refusal looks like
`{"status": "error", "error": "option_not_paid", "description": "…", "details": {"option": "multi_channel"}}`.
The node reads all three.

**Two documented methods answer 404 `resource_not_found`** on a live project, with a correct
key and project, for both POST and GET: `/project/settings/counter/list` (Project → Get Counter)
and `/project/access/get-authorized-users` (Project → Get Access). They are still in the node in
case another account has them; the credential test deliberately uses a different endpoint.

**A feature that is off answers 402, not an empty list.** Управление клиентами answers
`option_not_enabled`, the CRM-less lead board answers `400 integration_error` on a project that
has a CRM, and multi-channel attribution answers `402 option_not_paid` when it is not on the
plan. All three are reported as what they are rather than as a failure of the request.

**Two date formats, and the API is inconsistent about which.** The analytics half takes ISO
instants with an offset. `Get Daily` and `Site Lead → Get Many` take a single dotted string,
`2026-07-01-2026-07-31`. `Upload` takes `YYYY-MM-DD HH:MM`. The node converts whatever the date
picker gives it, and a value with no offset is read by Roistat as UTC.

**The funnel filter spells one key differently.** `Get Report` filters use
`{field, operation, value}`; `Get Funnel Report` uses `{field, operator, value}`.

**`Set Statuses` replaces the dictionary, not adds to it.** Send every status you use. A status
left out stops being recognised and its deals fall into «не учитывается».

**`Advertising Cost → Get Many` reads the whole history.** No period, no filter. Limit trims the
answer after it arrives.

**A visit list answers at most 10 000 rows.** Narrow the period rather than raising the limit.

## What is not here

0.1.0 covers analytics, deals, leads, clients, calls, visits, costs, events, statistics and
projects. Roistat's API is larger than that. Not implemented:

- Речевая аналитика (dictionaries, call transcripts, comments) — a large section on its own;
- Виртуальная АТС (operators, groups, numbers);
- Медиаплан;
- Emailtracking;
- Ловец лидов;
- managers, billing transactions, SMS reports, project health indicators;
- the Excel export variants of the report, the call history and the transaction list — they
  answer with a file rather than data, and a workflow that wants the numbers wants the JSON.

Ask for any of it in an [issue](https://github.com/zenland-dev/n8n-nodes-roistat/issues) and
say what you are building; that is how the order gets decided.

**What has been run, and what has not.** On 11.09.2026 every *reading* operation was run
against a live paid project: all 11 resources, every dropdown, the report, the funnel, the deal
card, the daily summary. Four bugs came out of that hour and are fixed in 0.1.0 — the crash on
a one-condition filter, the metrics array, the missing `next_dimensions`, and a channel
dropdown that read fields the API does not send.

The *writing* half has not been run, deliberately: the only project available was a live one,
and uploading a test deal into someone's analytics is not a test, it is a mess in their
reports. Upload, Import, the cost writes, Send Event, Create Call, Update Params, the lead
writes and the access change are written from the documentation only. If one of them comes back
in a shape the node does not expect, that is where it will happen, and an issue with the
endpoint and the raw answer is the fastest way to fix it.

## Feedback and bugs

[Issues](https://github.com/zenland-dev/n8n-nodes-roistat/issues) — a bug report that names
the operation, the raw answer and what you expected gets fixed; "does not work" does not.

Do not paste your API key into an issue. It is one key for every project in the profile.

## Using the node with an AI agent

Both nodes are exposed as tools (`usableAsTool`), and the action node's own description tells
a model what the resources mean. Two warnings:

- do not wire **Resource** or **Operation** to `$fromAI` — the model gets a free-form string
  with no enumeration and invents values;
- an agent given `Deal → Upload` or `Advertising Cost → Add` is writing into analytics that
  someone reports on. Pin the project number on the credential rather than leaving it to the
  model, and keep `Delete` away from it.

## License

[MIT](LICENSE.md)
