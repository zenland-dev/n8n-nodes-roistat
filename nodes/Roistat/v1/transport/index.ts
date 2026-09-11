import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IPollFunctions,
	IWebhookFunctions,
} from 'n8n-workflow';
import { NodeOperationError, randomInt, sleep } from 'n8n-workflow';

import { API_BASE_URL, projectNumber } from '../../../../credentials/RoistatApi.credentials';
import { cached } from '../../../../utils/cache';
import { extractRetryAfterMs, extractStatusCode } from '../../../../utils/httpError';
import { acquireSlot } from '../../../../utils/rateLimiter';
import type { RoistatEnvelope } from '../helpers/errors';
import { envelopeError, toRoistatError } from '../helpers/errors';

/** Every context this node makes API calls from. */
export type RoistatContext =
	| IExecuteFunctions
	| ILoadOptionsFunctions
	| IHookFunctions
	| IWebhookFunctions
	| IPollFunctions;

export const CREDENTIAL_NAME = 'roistatApi';

/** Server errors worth a second try, but only for reads. */
const RETRYABLE_READ_STATUSES = new Set([500, 502, 503, 504]);

/**
 * A per-method budget, on top of the project-wide 10 per second and 5000 per hour.
 *
 * Several Roistat endpoints publish their own, much tighter limit, and going over
 * one answers 429 for every integration on the project — not just for the
 * workflow that spent it. So they are enforced here rather than discovered at
 * runtime: `statistics/get-daily` allows five calls an hour, and the order list
 * allows between one and twenty a minute depending on how much of it is asked
 * for in one page.
 */
export interface MethodBudget {
	/** Distinguishes this budget from the project-wide one. */
	name: string;
	limit: number;
	windowMs: number;
}

export const BUDGETS = {
	/** `POST /project/statistics/get-daily` — five per hour, and the docs mean it. */
	dailyStatistics: { name: 'statistics', limit: 5, windowMs: 3_600_000 } as MethodBudget,
	/** `POST /project/integration/order/list` without `extend`. */
	orderList: { name: 'order-list', limit: 20, windowMs: 60_000 } as MethodBudget,
	/** The same call with `extend: ["visit"]`, which Roistat prices by page size. */
	orderListWithVisit: (pageSize: number): MethodBudget => ({
		name: 'order-list-visit',
		limit: pageSize > 1000 ? 1 : pageSize > 100 ? 5 : 10,
		windowMs: 60_000,
	}),
} as const;

export interface RoistatRequestOptions {
	/** Overrides the credential's project number for this call. */
	project?: string;
	/** A method-specific limit to respect on top of the project-wide ones. */
	budget?: MethodBudget;
	/** Total attempts, including the first one. */
	maxAttempts?: number;
	/** Extra headers, merged last. */
	headers?: IDataObject;
	/**
	 * Safe to send again after a server error.
	 *
	 * Most reads in this API are POSTs — every `…/list` method takes its filters in
	 * the body — so the HTTP verb says nothing about whether replaying a request is
	 * safe. Callers that only read set this, and a 502 on the way back then costs a
	 * retry instead of the whole workflow.
	 */
	readOnly?: boolean;
	/** Take the body as bytes — for the endpoints that answer with an MP3. */
	binary?: boolean;
	/**
	 * Leave the project out of the query.
	 *
	 * Two methods are account-wide rather than project-wide — listing the projects
	 * a key can see, and creating a new one — and sending `project` to them is
	 * harmless but dishonest: it would make a credential with no project number
	 * fail on the one call that could tell the user what to put there.
	 */
	omitProject?: boolean;
}

interface Connection {
	apiKey: string;
	project: string;
	requestsPerSecond: number;
	requestsPerHour: number;
	credentialId: string;
}

async function resolveConnection(
	this: RoistatContext,
	override?: string,
	optional = false,
): Promise<Connection> {
	const credentials = await this.getCredentials(CREDENTIAL_NAME);

	const apiKey = String(credentials.apiKey ?? '').trim();

	if (apiKey === '') {
		throw new NodeOperationError(this.getNode(), 'The Roistat credential has no API key', {
			description:
				'Open the credential and paste the key from Профиль → Настройки → API key in Roistat.',
		});
	}

	// Reduced to digits rather than taken as typed — the number is spliced into
	// the query string of every request, and people paste whole URLs into the
	// field. The same reduction runs in the credential's own test expression.
	const project = projectNumber(override !== undefined && override !== '' ? override : credentials.project);

	if (project === '' && !optional) {
		throw new NodeOperationError(this.getNode(), 'No Roistat project number', {
			description:
				'Every call names a project. Fill in Project ID on the credential, or set Project ID on the node to override it for this item. It is the digits in the project URL — 12345 in cloud.roistat.com/project/12345.',
		});
	}

	return {
		apiKey,
		project,
		requestsPerSecond: Number(credentials.requestsPerSecond) || 8,
		requestsPerHour: Number(credentials.requestsPerHour) || 4000,
		credentialId: this.getNode().credentials?.[CREDENTIAL_NAME]?.id ?? 'unbound',
	};
}

/** Waits 1s, 2s, 4s… with jitter, or honours `Retry-After` when one is sent. */
function backoffDelay(attempt: number, error: unknown): number {
	const advertised = extractRetryAfterMs(error);
	if (advertised !== undefined) return Math.min(advertised, 60_000);

	return Math.min(2 ** (attempt - 1) * 1000, 16_000) + randomInt(250);
}

/**
 * Waits for room in every budget this call has to fit into.
 *
 * The project-wide limits are shared by every integration touching the project,
 * so they are keyed on the project number rather than on the credential: two
 * credentials pointed at one project still add up to one budget.
 *
 * A method budget is refused rather than queued when the wait would be long.
 * Five calls an hour means the sixth waits up to twelve minutes, and a workflow
 * silently parked that long looks broken; saying so names the real cause.
 */
async function waitForSlot(
	this: RoistatContext,
	connection: Connection,
	budget?: MethodBudget,
): Promise<void> {
	// An account-wide call has no project to charge, so it is counted against the
	// credential instead of falling into a shared empty-string budget with every
	// other credential in the instance.
	const scope = connection.project === '' ? `account-${connection.credentialId}` : connection.project;

	await acquireSlot(`roistat|${scope}|second`, connection.requestsPerSecond, 1000);
	await acquireSlot(`roistat|${scope}|hour`, connection.requestsPerHour, 3_600_000);

	if (budget === undefined) return;

	const granted = await acquireSlot(
		`roistat|${scope}|${budget.name}`,
		budget.limit,
		budget.windowMs,
		60_000,
	);

	if (!granted) {
		const perWindow =
			budget.windowMs >= 3_600_000
				? `${budget.limit} per hour`
				: `${budget.limit} per ${Math.round(budget.windowMs / 1000)} seconds`;

		throw new NodeOperationError(this.getNode(), `Roistat allows this method ${perWindow}`, {
			description:
				'The budget for this method is already spent and the wait would be over a minute, so the request was not made rather than parked. It is counted per project across every integration using it — another workflow, or the Roistat interface itself, may have spent it.',
		});
	}
}

/**
 * One request against the Roistat REST API, rate-limited and retried.
 *
 * Returns the parsed body as it arrived. Roistat names the payload after the
 * resource — `data`, `clients`, `ProxyLeads`, `metrics` — and a couple of
 * endpoints answer with a bare array instead of an envelope, so unwrapping is
 * left to the caller, which knows what it asked for.
 *
 * 429 is retried for every method: the request is rejected before it touches any
 * data, so replaying a write is safe. Server errors are retried for reads only,
 * because a 504 on a write may well have been applied.
 */
export async function roistatApiRequest(
	this: RoistatContext,
	method: IHttpRequestMethods,
	endpoint: string,
	body?: IDataObject | IDataObject[],
	qs?: IDataObject,
	options: RoistatRequestOptions = {},
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous by design
): Promise<any> {
	const connection = await resolveConnection.call(this, options.project, options.omitProject);

	const requestOptions: IHttpRequestOptions = {
		method,
		baseURL: API_BASE_URL,
		url: endpoint,
		json: options.binary !== true,
		returnFullResponse: true,
		// Statuses are read below rather than thrown, so that Roistat's own error
		// code can be reported instead of the transport's guess at what 403 means.
		ignoreHttpStatusErrors: true,
	};

	requestOptions.headers = {
		'Api-key': connection.apiKey,
		// Roistat answers 200 to a refused request by default and hides the real
		// code in the body. This header is what makes the status line mean
		// something — without it every failure looks like a success carrying odd
		// data, and the retry logic below would never fire.
		'Use-Http-Code': '1',
		...options.headers,
	};

	if (options.binary === true) requestOptions.encoding = 'arraybuffer';
	if (body !== undefined) requestOptions.body = body;

	requestOptions.qs =
		options.omitProject === true || connection.project === ''
			? compactQuery(qs)
			: { ...compactQuery(qs), project: connection.project };

	const maxAttempts = options.maxAttempts ?? 4;

	for (let attempt = 1; ; attempt++) {
		await waitForSlot.call(this, connection, options.budget);

		let response: IDataObject;

		try {
			// `httpRequest`, not `httpRequestWithAuthentication`: the credential has no
			// `authenticate` block to apply, and the key is already on the request.
			response = (await this.helpers.httpRequest(requestOptions)) as IDataObject;
		} catch (error) {
			// Status errors are switched off above, so anything here is a transport
			// failure: DNS, TLS, a reset connection.
			if (attempt < maxAttempts) {
				await sleep(backoffDelay(attempt, error));
				continue;
			}

			throw toRoistatError(this.getNode(), error, extractStatusCode(error));
		}

		const status = Number(response.statusCode);

		const replayable = options.readOnly === true || isRead(method);

		if (status === 429 || (replayable && RETRYABLE_READ_STATUSES.has(status))) {
			if (attempt < maxAttempts) {
				await sleep(backoffDelay(attempt, { response }));
				continue;
			}
		}

		if (status >= 400) {
			throw toRoistatError(
				this.getNode(),
				{ response: { status, data: response.body } },
				status,
			);
		}

		if (options.binary === true) return response.body;

		const envelope = readEnvelope.call(this, response.body, endpoint, status);

		// Two independent verdicts, and either can be the failure. The status line
		// only speaks because of `Use-Http-Code`; the body's own `status` field is
		// the one Roistat always fills in.
		if (typeof envelope === 'object' && !Array.isArray(envelope)) {
			const reported = (envelope as RoistatEnvelope).status;
			if (reported !== undefined && String(reported) !== 'success') {
				throw toRoistatError(
					this.getNode(),
					envelopeError(this.getNode(), envelope as RoistatEnvelope),
					status,
				);
			}
		}

		return envelope;
	}
}

/**
 * Whether replaying this call is free of side effects on the verb alone.
 *
 * A GET always is. A POST here may or may not be — Roistat reads through POST as
 * often as it writes through it — so callers that know they are reading pass
 * `readOnly` and everything else is treated as a write.
 */
function isRead(method: IHttpRequestMethods): boolean {
	return method === 'GET' || method === 'HEAD';
}

/**
 * Insists that the answer really is Roistat's.
 *
 * Almost every endpoint answers with an object carrying `status`, and a few —
 * the cost list among them — answer with a bare array and no envelope at all.
 * Anything else is not the API talking: a proxy in front of n8n, or a captive
 * portal on the way out, both of which otherwise arrive as an empty result that
 * a workflow happily treats as "no rows".
 */
export function readEnvelope(
	this: RoistatContext,
	body: unknown,
	endpoint: string,
	status: number,
): RoistatEnvelope | IDataObject[] {
	if (Array.isArray(body)) return body as IDataObject[];

	if (body !== null && typeof body === 'object') return body as RoistatEnvelope;

	const text = String(body ?? '').trim();

	throw new NodeOperationError(this.getNode(), 'Roistat answered with something other than API data', {
		description:
			`${endpoint} answered ${status} with ${text === '' ? 'an empty body' : 'a body that is not JSON'}. ` +
			'Every REST API response is either a JSON object or a JSON array, so this is not Roistat answering — the usual cause is a proxy in front of n8n.',
	});
}

/**
 * Pulls the payload out of an envelope, whatever Roistat named it.
 *
 * The name differs per endpoint (`data`, `clients`, `ProxyLeads`, `metrics`,
 * `values`, `feed`…), and a couple of endpoints skip the envelope entirely. The
 * caller passes the key it expects; everything else here is about the answer
 * arriving in a shape that is not the documented one, which happens often enough
 * to be worth handling rather than crashing on.
 */
export function listFrom(payload: unknown, key: string): IDataObject[] {
	if (Array.isArray(payload)) return payload as IDataObject[];

	if (payload === null || typeof payload !== 'object') return [];

	const value = (payload as IDataObject)[key];

	if (Array.isArray(value)) return value as IDataObject[];
	if (value !== null && typeof value === 'object') return [value as IDataObject];

	return [];
}

/**
 * Walks an endpoint that pages with `limit` and `offset` in the request body.
 *
 * Roistat reports `total` alongside the page, which is what ends the walk: a
 * page shorter than asked for ends it too, but `total` catches the case where a
 * server-side clamp keeps handing back full pages of the same size.
 */
export async function roistatApiRequestAllItems(
	this: RoistatContext,
	endpoint: string,
	body: IDataObject,
	options: {
		listKey: string;
		limit?: number;
		pageSize?: number;
		maxPages?: number;
		project?: string;
		budget?: MethodBudget;
	},
): Promise<IDataObject[]> {
	const pageSize = Math.max(1, options.pageSize ?? 100);
	const maxPages = options.maxPages ?? 500;
	const rows: IDataObject[] = [];

	for (let page = 0; ; page++) {
		// The cap exists so a paging bug cannot run forever, not to trim a result.
		// Reaching it means the answer is incomplete, and returning it as though it
		// were the whole list is the one outcome worth refusing: a workflow that
		// reconciles against a truncated list acts on rows it could not see.
		if (page >= maxPages) {
			throw new NodeOperationError(this.getNode(), `More than ${rows.length} rows to read`, {
				description:
					`${endpoint} is still returning rows after ${maxPages} pages. Narrow the period or the filters, or ` +
					'turn Return All off and take a defined number — this node will not hand back a silently shortened list.',
			});
		}

		const wanted =
			options.limit === undefined ? pageSize : Math.min(pageSize, options.limit - rows.length);
		if (wanted <= 0) break;

		const payload = await roistatApiRequest.call(
			this,
			'POST',
			endpoint,
			{ ...body, limit: wanted, offset: page * pageSize },
			undefined,
			{ project: options.project, budget: options.budget, readOnly: true },
		);

		const batch = listFrom(payload, options.listKey);
		if (batch.length === 0) break;

		rows.push(...batch);

		if (batch.length < wanted) break;

		const total = Number((payload as IDataObject)?.total);
		if (Number.isFinite(total) && rows.length >= total) break;
	}

	return options.limit === undefined ? rows : rows.slice(0, options.limit);
}

/**
 * A read whose result is shared between dropdowns for a minute.
 *
 * Opening a node with several project-aware pickers fires several requests, and
 * the editor re-runs them whenever a dependent parameter changes. Every one of
 * those counts against the project's hourly budget, which the workflows using
 * the project need more than the editor does.
 */
export async function roistatCachedRequest(
	this: RoistatContext,
	endpoint: string,
	body?: IDataObject,
	options: { project?: string; qs?: IDataObject; method?: IHttpRequestMethods } = {},
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see roistatApiRequest
): Promise<any> {
	const credentialId = this.getNode().credentials?.[CREDENTIAL_NAME]?.id ?? 'unbound';
	// The project is part of the key, not just the credential: one credential
	// reaches every project the profile can see, and a metric dictionary is a
	// property of the project rather than of the key.
	const key = `roistat|${credentialId}|${options.project ?? ''}|${endpoint}|${JSON.stringify(body ?? {})}|${JSON.stringify(options.qs ?? {})}`;

	return await cached(
		key,
		async () =>
			await roistatApiRequest.call(this, options.method ?? 'POST', endpoint, body, options.qs, {
				project: options.project,
				readOnly: true,
			}),
	);
}

/** Drops query keys the user left blank; an empty filter is not a filter. */
export function compactQuery(input?: IDataObject): IDataObject {
	const output: IDataObject = {};

	for (const [key, value] of Object.entries(input ?? {})) {
		if (value === undefined || value === null || value === '') continue;
		if (Array.isArray(value) && value.length === 0) continue;
		output[key] = value;
	}

	return output;
}
