import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { unknownOperation } from '../../../../../utils/router';
import {
	fieldsFromCollection,
	jsonParameter,
	omitEmpty,
	projectFor,
	toItems,
} from '../../helpers/request';
import { listFrom, roistatApiRequest } from '../../transport';

/** `POST /project/events/send`. */
async function send(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const project = projectFor.call(this, itemIndex);
	const name = String(this.getNodeParameter('eventName', itemIndex, '') ?? '').trim();

	if (name === '') {
		throw new NodeOperationError(this.getNode(), 'An event needs a name', {
			description:
				'Fill in Event Name. It has to match a name registered in the project — Roistat accepts an unknown one and counts it nowhere.',
			itemIndex,
		});
	}

	const body: IDataObject = omitEmpty({
		name,
		visit: this.getNodeParameter('visitId', itemIndex, ''),
	});

	const data = fieldsFromCollection(this.getNodeParameter('eventData', itemIndex, {}));
	if (Object.keys(data).length > 0) body.data = data;

	const payload = await roistatApiRequest.call(
		this,
		'POST',
		'/project/events/send',
		body,
		undefined,
		{ project },
	);

	return toItems(payload, { ...body, success: true }).map((row) => ({ json: row }));
}

/** `POST /project/events/bulk/send` — a whole batch on one request. */
async function sendMany(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const project = projectFor.call(this, itemIndex);
	const events = jsonParameter.call(this, 'eventsJson', 'Events', itemIndex);

	if (!Array.isArray(events) || events.length === 0) {
		throw new NodeOperationError(this.getNode(), 'Events must be a non-empty array', {
			description: 'This operation takes a list: [{"name": "…", "visit": "…"}, …].',
			itemIndex,
		});
	}

	const payload = await roistatApiRequest.call(
		this,
		'POST',
		'/project/events/bulk/send',
		events as IDataObject[],
		undefined,
		{ project },
	);

	// The answer is a bare status, so the item says how many went out. Roistat
	// reports no per-event verdict, and inventing one would be a guess.
	return toItems(payload, { sent: events.length, success: true }).map((row) => ({
		json: { sent: events.length, ...row },
	}));
}

/** `POST /project/events/add` — register an event name. */
async function create(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const project = projectFor.call(this, itemIndex);

	const event: IDataObject = {
		display_name: this.getNodeParameter('displayName', itemIndex, ''),
		type: this.getNodeParameter('eventType', itemIndex, 'js'),
		parameter: this.getNodeParameter('parameter', itemIndex, ''),
	};

	const payload = await roistatApiRequest.call(
		this,
		'POST',
		'/project/events/add',
		[event],
		undefined,
		{ project },
	);

	const created = listFrom(payload, 'events');

	return created.length > 0
		? created.map((row) => ({ json: row }))
		: [{ json: { ...event, success: true } }];
}

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	switch (operation) {
		case 'send':
			return await send.call(this, itemIndex);
		case 'sendMany':
			return await sendMany.call(this, itemIndex);
		case 'create':
			return await create.call(this, itemIndex);
		default:
			throw unknownOperation.call(this, 'Event', operation, itemIndex);
	}
}
