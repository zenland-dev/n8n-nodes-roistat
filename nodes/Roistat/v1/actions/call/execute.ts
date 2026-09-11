import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { unknownOperation } from '../../../../../utils/router';
import {
	jsonParameter,
	filtersPayload,
	omitEmpty,
	periodFor,
	projectFor,
	toItems,
	toRoistatInstant,
} from '../../helpers/request';
import { roistatApiRequest, roistatApiRequestAllItems } from '../../transport';

/** `POST /project/calltracking/call/list`. */
async function getMany(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const project = projectFor.call(this, itemIndex);
	const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
	const limit = this.getNodeParameter('limit', itemIndex, 50) as number;
	const includeVisit = this.getNodeParameter('includeVisit', itemIndex, false) as boolean;
	const includeOrder = this.getNodeParameter('includeOrder', itemIndex, false) as boolean;
	const sortField = String(this.getNodeParameter('sortField', itemIndex, '') ?? '').trim();
	const sortOrder = String(this.getNodeParameter('sortOrder', itemIndex, 'desc') ?? 'desc');
	const written = jsonParameter.call(this, 'filtersJson', 'Filters', itemIndex);

	const period = periodFor.call(this, itemIndex, false);
	const built: unknown[] = [];

	if (period !== undefined) {
		built.push(['date', '>=', period.from], ['date', '<=', period.to]);
	}

	const body: IDataObject = {};

	const filters = filtersPayload(built, written);
	if (filters !== undefined) body.filters = filters;

	const extend = [
		...(includeVisit ? ['visit'] : []),
		...(includeOrder ? ['order'] : []),
	];
	if (extend.length > 0) body.extend = extend;

	if (sortField !== '') body.sort = [sortField, sortOrder];

	const rows = await roistatApiRequestAllItems.call(this, '/project/calltracking/call/list', body, {
		listKey: 'data',
		limit: returnAll ? undefined : Math.max(1, limit),
		pageSize: 100,
		project,
	});

	return rows.map((row) => ({ json: row }));
}

/** `POST /project/calltracking/phone/list`. */
async function getPhones(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const project = projectFor.call(this, itemIndex);
	const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
	const limit = this.getNodeParameter('limit', itemIndex, 50) as number;

	const rows = await roistatApiRequestAllItems.call(
		this,
		'/project/calltracking/phone/list',
		{},
		{
			listKey: 'data',
			limit: returnAll ? undefined : Math.max(1, limit),
			pageSize: 100,
			project,
		},
	);

	return rows.map((row) => ({ json: row }));
}

/** `POST /project/calltracking/data` — the dashboard, as one object. */
async function getDashboard(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const project = projectFor.call(this, itemIndex);

	// Unlike the call list, this one has no default period: without it Roistat has
	// nothing to aggregate over and refuses the request.
	const period = periodFor.call(this, itemIndex);

	const payload = (await roistatApiRequest.call(
		this,
		'POST',
		'/project/calltracking/data',
		{ period },
		undefined,
		{ project, readOnly: true },
	)) as IDataObject;

	// The whole dashboard is one nested object under `data`: statistics by hour,
	// by weekday, by channel, by region. It is returned as a single item rather
	// than split up — the parts only mean something together.
	return [{ json: (payload.data ?? payload) as IDataObject }];
}

/** `POST /project/phone-call` — write a call that happened elsewhere. */
async function create(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const project = projectFor.call(this, itemIndex);
	const caller = String(this.getNodeParameter('caller', itemIndex, '') ?? '').trim();
	const callee = String(this.getNodeParameter('callee', itemIndex, '') ?? '').trim();
	const date = toRoistatInstant(this.getNodeParameter('date', itemIndex, ''));
	const extra = this.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject;

	if (caller === '' || callee === '' || date === '') {
		throw new NodeOperationError(this.getNode(), 'A call needs both numbers and a date', {
			description: 'Fill in Caller, Callee and Date — Roistat requires all three on this method.',
			itemIndex,
		});
	}

	const body: IDataObject = omitEmpty({
		caller,
		callee,
		date,
		status: this.getNodeParameter('status', itemIndex, 'ANSWER'),
		marker: extra.marker,
		order_id: extra.order_id,
		visit_id: extra.visit_id,
		comment: extra.comment,
	});

	// Durations are numbers where zero is meaningful — an unanswered call really
	// did last zero seconds of conversation — so they are set only when present
	// rather than run through `omitEmpty`.
	if (extra.duration !== undefined) body.duration = Number(extra.duration);
	if (extra.answer_duration !== undefined) body.answer_duration = Number(extra.answer_duration);

	// Documented as the string "0" or "1" rather than a boolean, and sent that way.
	// A JSON `false` might well be accepted, but the documented form is the one to
	// send when the endpoint's tolerance is unknown: guessing wrong here creates a
	// lead in the CRM nobody asked for.
	if (extra.save_to_crm !== undefined) body.save_to_crm = extra.save_to_crm === true ? '1' : '0';

	const payload = await roistatApiRequest.call(this, 'POST', '/project/phone-call', body, undefined, {
		project,
	});

	const created = (payload as IDataObject)?.phoneCall;

	return toItems(created ?? payload, { ...body, success: true }).map((row) => ({ json: row }));
}

/**
 * `POST /project/calltracking/call/{id}/file` — the recording, as bytes.
 *
 * The answer is an MP3 body, not JSON, so the transport is told to keep it raw.
 * A call with no recording answers with an empty body and no error, which is
 * reported here rather than handed on as a zero-byte file somebody has to open
 * to discover is empty.
 */
async function getRecording(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const project = projectFor.call(this, itemIndex);
	const id = String(this.getNodeParameter('callId', itemIndex, '') ?? '').trim();
	const target = String(this.getNodeParameter('binaryProperty', itemIndex, 'data') ?? 'data');

	if (id === '') {
		throw new NodeOperationError(this.getNode(), 'This operation needs a call ID', {
			description: 'Fill in Call ID — the id field of a call from Get Many.',
			itemIndex,
		});
	}

	const body = await roistatApiRequest.call(
		this,
		'POST',
		`/project/calltracking/call/${encodeURIComponent(id)}/file`,
		undefined,
		undefined,
		{ project, binary: true, readOnly: true },
	);

	const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body as ArrayBuffer);

	if (buffer.length === 0) {
		throw new NodeOperationError(this.getNode(), `Call ${id} has no recording`, {
			description:
				'Roistat answered with an empty body. The call was not recorded, the recording has expired, or it lives with a third-party calltracking provider — in which case the call\'s link field points at it.',
			itemIndex,
		});
	}

	const binary = await this.helpers.prepareBinaryData(buffer, `call-${id}.mp3`, 'audio/mpeg');

	return [{ json: { id, fileName: binary.fileName, fileSize: binary.fileSize }, binary: { [target]: binary } }];
}

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	switch (operation) {
		case 'getMany':
			return await getMany.call(this, itemIndex);
		case 'getPhones':
			return await getPhones.call(this, itemIndex);
		case 'getDashboard':
			return await getDashboard.call(this, itemIndex);
		case 'create':
			return await create.call(this, itemIndex);
		case 'getRecording':
			return await getRecording.call(this, itemIndex);
		default:
			throw unknownOperation.call(this, 'Call', operation, itemIndex);
	}
}
