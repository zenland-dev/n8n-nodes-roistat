import type { Icon, ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * The one host Roistat serves its REST API on.
 *
 * Unlike a CRM that gives every account its own subdomain, Roistat is a single
 * installation: every project of every customer is reached at this address, and
 * the project is named by a query parameter rather than by the host. So this
 * credential has no address field at all — there is nothing for a user to type
 * and therefore nothing to point somewhere unintended.
 */
export const API_BASE_URL = 'https://cloud.roistat.com/api/v1';

/**
 * Everything a Roistat project number may contain.
 *
 * The number is spliced into the query string of every request, so it is
 * reduced to digits rather than trusted as typed. People paste it out of the
 * browser address bar, where it arrives as `project=12345` or as part of a whole
 * URL, and all of those have to end up as `12345`.
 */
const PROJECT_ALLOWED = /[^0-9]/g;

/** The same reduction as `projectNumber`, written for the expression engine. */
const PROJECT_EXPRESSION = 'String($credentials.project || "").replace(/[^0-9]/g, "")';

/** Reduces whatever the user typed into a bare project number. */
export function projectNumber(value: unknown): string {
	return String(value ?? '').replace(PROJECT_ALLOWED, '');
}

/**
 * What the Test button asks, and why it is this endpoint.
 *
 * `/project/analytics/attribution-models` needs both halves of the credential —
 * the API key in the header and a project number the key can see — answers in
 * under a kilobyte, and exists on every project regardless of which options are
 * enabled.
 *
 * It is not the obvious choice. `/project/settings/counter/list` reads better and
 * was used here first, but on a live project it answered **404
 * `resource_not_found`** for both POST and GET, with a correct key and a correct
 * project number (checked 11.09.2026). A credential test that fails on a working
 * credential is worse than no test, so it was swapped for a method that answers.
 */
const TEST_URL = `=${API_BASE_URL}/project/analytics/attribution-models?project={{ ${PROJECT_EXPRESSION} }}`;

/**
 * What the Test button reports.
 *
 * The `responseCode` rules are only reachable because the request below sends
 * `Use-Http-Code: 1`. Without that header Roistat answers **200 OK for every
 * failure**, including a rejected key, and puts the real code inside the body —
 * so n8n would take the failure path never, the success path always, and a
 * credential with a wrong key would test green.
 *
 * The body rule is the second half of the same story: it catches an answer that
 * arrives 200 and still says it failed, which is what happens if the header is
 * ever ignored.
 */
const TEST_RULES: ICredentialTestRequest['rules'] = [
	{
		type: 'responseCode',
		properties: {
			value: 401,
			message:
				'Roistat не принял ключ или номер проекта. The key is the one in Профиль → Настройки → API key, and it is issued per user rather than per project — check that the project number belongs to the same profile.',
		},
	},
	{
		type: 'responseCode',
		properties: {
			value: 402,
			message:
				'Проект недоступен по биллингу: нет средств, опция не оплачена или проект заморожен. The key is fine; the project has to be unfrozen in Roistat before the API answers for it.',
		},
	},
	{
		type: 'responseCode',
		properties: {
			value: 403,
			message:
				'У этого ключа нет доступа к проекту. Open Roistat → Права доступа and give the profile that owns the key at least read access to the project.',
		},
	},
	{
		type: 'responseCode',
		properties: {
			value: 404,
			message:
				'Roistat не нашёл такого проекта. Check the number — it is the digits in the address bar of the project, for example 12345 in cloud.roistat.com/project/12345. A wrong API key answers the same way on this endpoint, so check both.',
		},
	},
	{
		type: 'responseCode',
		properties: {
			value: 429,
			message:
				'Roistat отклонил проверку по лимиту запросов (10 в секунду, 5000 в час на проект). Wait a minute and test again — the limit is counted per project, so another integration can spend it too.',
		},
	},
	{
		type: 'responseSuccessBody',
		properties: {
			key: 'status',
			value: 'error',
			message:
				'Roistat ответил отказом. The address is reachable, so check the API key and the project number, and that the key belongs to a profile with access to that project.',
		},
	},
] as ICredentialTestRequest['rules'];

/**
 * One credential for both nodes in this package.
 *
 * Roistat has no OAuth: a profile has a single API key that covers every project
 * it can see, and the project is named per request. That makes the credential
 * two fields — the key, and the project this credential is for. Keeping the
 * project here rather than only on the node is what lets a workflow be copied
 * between a test project and a live one by swapping the credential, and every
 * node still lets an item override it.
 *
 * There is deliberately no `authenticate` block. Declaring one makes n8n offer
 * this credential inside an HTTP Request node — where anyone who can edit a
 * workflow may point it at any URL and have n8n attach the key — and inject an
 * *Allowed HTTP Request Domains* field to fence that off, which then has to be
 * pinned and can refuse the credential's own Test button on some versions.
 * Omitting it removes the exposure at the source: n8n never offers the
 * credential there. Both nodes attach the header themselves.
 */
export class RoistatApi implements ICredentialType {
	name = 'roistatApi';

	displayName = 'Roistat API';

	documentationUrl = 'https://help-en.roistat.com/API/methods/about/';

	icon: Icon = {
		light: 'file:../icons/roistat.svg',
		dark: 'file:../icons/roistat.dark.svg',
	};

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Ключ API из настроек профиля (Профиль → Настройки → API key). One key per Roistat profile, not per project: it opens every project the profile has access to, so treat it as an account-wide secret.',
		},
		{
			displayName: 'Project ID',
			name: 'project',
			type: 'string',
			default: '',
			required: true,
			placeholder: '12345',
			description:
				'Номер проекта Roistat — the digits in the project URL, for example 12345 in cloud.roistat.com/project/12345. Every node can override it per item; this is the default. Pasting the whole URL works: everything but the digits is dropped.',
		},
		{
			displayName: 'Requests per Second',
			name: 'requestsPerSecond',
			type: 'number',
			typeOptions: { minValue: 1, maxValue: 10 },
			default: 8,
			description:
				'How fast this credential may call Roistat. The platform allows 10 per second per project and answers 429 above that, so the default leaves room for another integration on the same project.',
		},
		{
			displayName: 'Requests per Hour',
			name: 'requestsPerHour',
			type: 'number',
			typeOptions: { minValue: 1, maxValue: 5000 },
			default: 4000,
			description:
				'The hourly budget this credential may spend. Roistat allows 5000 per hour per project and counts every integration against it, so the default keeps a busy workflow from locking the project out for the rest of the hour.',
		},
	];

	test: ICredentialTestRequest = {
		request: {
			url: TEST_URL,
			method: 'POST',
			headers: {
				'Api-key': '={{ $credentials.apiKey }}',
				// Without this Roistat answers 200 to a rejected key and hides the real
				// code in the body, so every rule above that reads the status line would
				// be unreachable and the test would pass on any key at all.
				'Use-Http-Code': '1',
			},
		},
		rules: TEST_RULES,
	};
}
