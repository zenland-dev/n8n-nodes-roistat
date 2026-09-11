import { timingSafeEqual } from 'node:crypto';
import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

/** The call statuses Roistat sends, as the trigger's filter offers them. */
const CALL_STATUSES = [
	{ name: 'Answered (ANSWER)', value: 'ANSWER', description: 'Звонок принят и обработан сотрудником' },
	{ name: 'Busy (BUSY)', value: 'BUSY', description: 'Линия была занята' },
	{ name: 'Cancelled (CANCEL)', value: 'CANCEL', description: 'Клиент положил трубку до ответа' },
	{ name: 'In Progress (ACTIVE)', value: 'ACTIVE', description: 'Звонок ещё идёт' },
	{ name: 'No Answer (NOANSWER)', value: 'NOANSWER', description: 'Никто не ответил за время ожидания' },
	{ name: 'Not Called (DONTCALL)', value: 'DONTCALL', description: 'Входящий вызов был отменён' },
	{
		name: 'Technical Failure (CONGESTION)',
		value: 'CONGESTION',
		description: 'Вызов не состоялся по технической причине',
	},
	{
		name: 'To Answering Machine (TORTURE)',
		value: 'TORTURE',
		description: 'Вызов ушёл на автоответчик',
	},
	{ name: 'Unavailable (CHANUNAVAIL)', value: 'CHANUNAVAIL', description: 'Вызываемый номер был недоступен' },
];

/**
 * Compares two secrets without leaking their length through timing.
 *
 * `timingSafeEqual` throws on a length mismatch, so the lengths are compared
 * first and the result folded in — an attacker learns the length either way, and
 * that is not the secret.
 */
function secretMatches(expected: string, received: string): boolean {
	const a = Buffer.from(expected, 'utf8');
	const b = Buffer.from(received, 'utf8');

	if (a.length !== b.length) return false;

	return timingSafeEqual(a, b);
}

/**
 * Receives what Roistat pushes.
 *
 * Roistat has no API for managing webhooks — no subscribe, no unsubscribe, no
 * listing — so this node cannot register itself the way a GetCourse or a Slack
 * trigger does. The address is pasted into Roistat by hand, in one of two
 * places: a calltracking scenario, which offers a field for the moment the call
 * starts and another for the moment it ends, or a scenario in Автоматизация
 * маркетинга, which can call a URL as one of its actions.
 *
 * That has a consequence worth stating plainly rather than discovering: a
 * calltracking scenario holds **one address per field**. Pointing it at a second
 * n8n workflow replaces the first, and nothing in Roistat says so.
 *
 * Deliveries carry no signature and no header of yours, so the URL is the only
 * thing keeping them private. The optional shared secret below is a second lock:
 * add `?token=…` to the address pasted into Roistat and anything arriving without
 * it is refused.
 */
export class RoistatTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Roistat Trigger',
		name: 'roistatTrigger',
		icon: {
			light: 'file:../../icons/roistat.svg',
			dark: 'file:../../icons/roistat.dark.svg',
		},
		group: ['trigger'],
		version: 1,
		subtitle: '={{ $parameter["event"] }}',
		description: 'Starts a workflow when Roistat calls a webhook',
		defaults: { name: 'Roistat Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		webhooks: [
			{
				name: 'default',
				// The calltracking webhooks always POST. A scenario in Автоматизация
				// маркетинга can be set to either, so the method is a parameter — and the
				// fallback keeps the webhook registered as POST rather than as whatever an
				// unresolved expression evaluates to.
				httpMethod: '={{ $parameter["httpMethod"] || "POST" }}',
				// Roistat publishes no delivery timeout and no retry policy, so the safe
				// assumption is that it has one and it is short. Answering on receipt
				// keeps the reply independent of how long the workflow runs.
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName:
					'В Roistat нет API для вебхуков — адрес выше вставляется руками. For calls: Коллтрекинг → сценарий → Настройте интеграцию, into «Webhook в момент звонка» or «Webhook после звонка». For anything else: a scenario in Автоматизация маркетинга with a URL action. Each of those fields holds one address, so pasting a second workflow there replaces the first.',
				name: 'setupNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				noDataExpression: true,
				default: 'callFinished',
				options: [
					{
						name: 'Call Finished',
						value: 'callFinished',
						description:
							'Webhook после звонка. Carries the outcome: status, duration and a link to the recording. This is the one most workflows want.',
					},
					{
						name: 'Call Started',
						value: 'callStarted',
						description:
							'Webhook в момент звонка — приходит, когда Roistat набирает номер. It has the caller and the source but no outcome yet, so a status filter never matches one.',
					},
					{
						name: 'Any',
						value: 'any',
						description:
							'Любое тело, как пришло. Use for a scenario from Автоматизация маркетинга, where the fields are whatever that scenario sends.',
					},
				],
				description:
					'Что вставлено в этот адрес на стороне Roistat. It does not change what is received — Roistat decides that — but it does decide which options below make sense.',
			},
			{
				displayName: 'HTTP Method',
				name: 'httpMethod',
				type: 'options',
				default: 'POST',
				options: [
					{ name: 'POST', value: 'POST' },
					{ name: 'GET', value: 'GET' },
				],
				displayOptions: { show: { event: ['any'] } },
				description:
					'Каким методом сценарий вызывает адрес. The calltracking webhooks always post, so this only matters for a scenario in Автоматизация маркетинга. With GET the data arrives as query parameters instead of a body, and the node passes those on.',
			},
			{
				displayName: 'Call Statuses',
				name: 'statuses',
				type: 'multiOptions',
				default: [],
				options: CALL_STATUSES,
				displayOptions: { show: { event: ['callFinished'] } },
				description:
					'Пропускать дальше только звонки с этими статусами. Leave empty to pass everything. Roistat sends every call whatever happened to it, and a workflow that creates a task for a missed call wants NOANSWER, BUSY and CANCEL rather than all nine.',
			},
			{
				displayName: 'Shared Secret',
				name: 'secret',
				type: 'string',
				typeOptions: { password: true },
				default: '',
				description: 'Необязательный секрет. Set one here and append ?token=&lt;secret&gt; to the URL pasted into Roistat; a delivery without it is refused with 403. Roistat sends no signature of its own, so without this the address itself is the only thing keeping deliveries private.',
			},
			{
				displayName: 'Secret Query Parameter',
				name: 'secretParameter',
				type: 'string',
				typeOptions: { password: true },
				default: 'token',
				displayOptions: { hide: { secret: [''] } },
				description: 'Имя параметра в адресе, в котором приходит секрет',
			},
		],
	};

	/**
	 * There is nothing to register, and that is Roistat's doing.
	 *
	 * The REST API has no method for creating, listing or deleting a webhook: the
	 * address is typed into a calltracking scenario or a marketing scenario in the
	 * Roistat interface, and only a person with access to that interface can put it
	 * there or take it away. So all three hooks answer that the subscription is
	 * already in place — `checkExists` returning true is what stops n8n from
	 * calling `create`, and `create` and `delete` are no-ops rather than lies about
	 * a call being made.
	 *
	 * The consequence for the user is that deactivating the workflow does not stop
	 * the deliveries; Roistat keeps posting to an address n8n is no longer
	 * listening on. Clearing the field in Roistat is the only way to stop them,
	 * which is why the node says so in its setup notice.
	 */
	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				return true;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const request = this.getRequestObject();
		const response = this.getResponseObject();

		const secret = String(this.getNodeParameter('secret', '') ?? '');

		if (secret !== '') {
			const parameterName = String(this.getNodeParameter('secretParameter', 'token') ?? 'token');
			const query = (this.getQueryData() ?? {}) as IDataObject;
			const received = String(query[parameterName] ?? '');

			if (!secretMatches(secret, received)) {
				// Refused with a status rather than an exception: Roistat is not going to
				// read a message, and a 403 is the honest answer to a delivery that could
				// not prove where it came from.
				response.writeHead(403);
				response.end('forbidden');

				return { noWebhookResponse: true };
			}
		}

		const event = String(this.getNodeParameter('event', 'callFinished') ?? 'callFinished');
		const method = String(this.getNodeParameter('httpMethod', 'POST') ?? 'POST');

		// A GET delivery carries its data in the query string, and the secret is in
		// there too — it is dropped so it does not travel on into the workflow.
		let body: IDataObject;

		if (method === 'GET') {
			const query = { ...((this.getQueryData() ?? {}) as IDataObject) };
			delete query[String(this.getNodeParameter('secretParameter', 'token') ?? 'token')];
			body = query;
		} else {
			const posted = request.body as IDataObject | undefined;

			if (posted === undefined || posted === null || typeof posted !== 'object') {
				throw new NodeOperationError(this.getNode(), 'Roistat sent a body that is not JSON', {
					description:
						'Calltracking webhooks post a JSON object. A body arriving as form data usually means the address was pasted somewhere other than a webhook field. A scenario from Автоматизация маркетинга that calls the URL with GET needs Event set to Any and HTTP Method set to GET.',
				});
			}

			body = posted;
		}

		if (event === 'callFinished') {
			const wanted = this.getNodeParameter('statuses', []) as string[];

			// An empty filter passes everything; a filter that names statuses drops a
			// delivery whose status is not among them, and a body with no status field
			// at all — which is what the in-call webhook sends — is dropped too rather
			// than passed as though it had matched.
			//
			// Dropping one means returning no `workflowData`: n8n then answers Roistat
			// 200 and starts nothing. Returning an empty array instead would start the
			// workflow with no items, which is not the same thing and shows up as a
			// stream of empty executions.
			if (wanted.length > 0 && !wanted.includes(String(body.status ?? ''))) {
				return {};
			}
		}

		return { workflowData: [this.helpers.returnJsonArray([body])] };
	}
}
