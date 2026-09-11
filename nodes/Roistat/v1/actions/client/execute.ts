import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { unknownOperation } from '../../../../../utils/router';
import {
	fieldsFromCollection,
	jsonParameter,
	filtersPayload,
	omitEmpty,
	projectFor,
	toItems,
	toRoistatDate,
} from '../../helpers/request';
import { listFrom, roistatApiRequest, roistatApiRequestAllItems } from '../../transport';

/** `POST /project/clients`. */
async function getMany(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const project = projectFor.call(this, itemIndex);
	const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
	const limit = this.getNodeParameter('limit', itemIndex, 50) as number;
	const written = jsonParameter.call(this, 'filtersJson', 'Filters', itemIndex);

	const body: IDataObject = {};
	const filters = filtersPayload([], written);
	if (filters !== undefined) body.filters = filters;

	const rows = await roistatApiRequestAllItems.call(this, '/project/clients', body, {
		listKey: 'clients',
		limit: returnAll ? undefined : Math.max(1, limit),
		pageSize: 100,
		project,
	});

	return rows.map((row) => ({ json: row }));
}

/**
 * `GET /project/clients/detail/feed` — one client's whole history.
 *
 * Every entry carries a `type` and a different set of fields for each: a visit
 * has a device, a call has a duration and a recording, a status change has the
 * status it moved to. They are emitted one item per entry rather than as one
 * nested blob, so a Switch node can route on `type` without unpacking anything.
 */
async function getFeed(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const project = projectFor.call(this, itemIndex);
	const client = String(this.getNodeParameter('clientId', itemIndex, '') ?? '').trim();

	if (client === '') {
		throw new NodeOperationError(this.getNode(), 'This operation needs a client ID', {
			description: 'Fill in Client ID — the id field of a client from Get Many.',
			itemIndex,
		});
	}

	const payload = await roistatApiRequest.call(
		this,
		'GET',
		'/project/clients/detail/feed',
		undefined,
		{ client },
		{ project },
	);

	return listFrom(payload, 'feed').map((row) => ({ json: { client, ...row } }));
}

/**
 * `POST /project/clients/import` — one client per input item.
 *
 * The endpoint takes an array and answers `{"status": "success"}` with no detail,
 * so sending one client at a time is what makes a rejected record attributable:
 * the failure names the item it came from instead of the batch it was in.
 */
async function importClient(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const project = projectFor.call(this, itemIndex);
	const id = String(this.getNodeParameter('externalId', itemIndex, '') ?? '').trim();
	const name = String(this.getNodeParameter('name', itemIndex, '') ?? '').trim();

	if (id === '' || name === '') {
		throw new NodeOperationError(this.getNode(), 'A client needs an ID and a name', {
			description:
				'Roistat requires both: External ID is what it matches on, and Name is what the interface shows.',
			itemIndex,
		});
	}

	const client: IDataObject = omitEmpty({
		id,
		name,
		phone: this.getNodeParameter('phone', itemIndex, ''),
		email: this.getNodeParameter('email', itemIndex, ''),
		company: this.getNodeParameter('company', itemIndex, ''),
		birth_date: toRoistatDate(this.getNodeParameter('birthDate', itemIndex, '')),
	});

	const fields = fieldsFromCollection(this.getNodeParameter('customFields', itemIndex, {}));
	if (Object.keys(fields).length > 0) client.fields = fields;

	const payload = await roistatApiRequest.call(
		this,
		'POST',
		'/project/clients/import',
		[client],
		undefined,
		{ project },
	);

	return toItems(payload, { id, success: true }).map((row) => ({ json: { id, ...row } }));
}

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	switch (operation) {
		case 'getMany':
			return await getMany.call(this, itemIndex);
		case 'getFeed':
			return await getFeed.call(this, itemIndex);
		case 'import':
			return await importClient.call(this, itemIndex);
		default:
			throw unknownOperation.call(this, 'Client', operation, itemIndex);
	}
}
