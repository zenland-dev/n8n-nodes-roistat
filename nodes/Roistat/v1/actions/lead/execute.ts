import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { unknownOperation } from '../../../../../utils/router';
import {
	jsonParameter,
	omitEmpty,
	periodFor,
	projectFor,
	toItems,
	toRoistatInstant,
} from '../../helpers/request';
import { listFrom, roistatApiRequest, roistatApiRequestAllItems } from '../../transport';

/** The fields both writes share, taken from the editor and trimmed of blanks. */
function leadPayload(this: IExecuteFunctions, itemIndex: number): IDataObject {
	const payload: IDataObject = omitEmpty({
		title: this.getNodeParameter('title', itemIndex, ''),
		name: this.getNodeParameter('name', itemIndex, ''),
		status: this.getNodeParameter('status', itemIndex, ''),
		creation_date: toRoistatInstant(this.getNodeParameter('creationDate', itemIndex, '')),
		paid_date: toRoistatInstant(this.getNodeParameter('paidDate', itemIndex, '')),
		phone: this.getNodeParameter('phone', itemIndex, ''),
		email: this.getNodeParameter('email', itemIndex, ''),
		source: this.getNodeParameter('source', itemIndex, ''),
		text: this.getNodeParameter('text', itemIndex, ''),
	});

	// Price is separate because zero is a real amount and `omitEmpty` keeps
	// numbers, but a lead created without a price should not be sent one.
	const price = this.getNodeParameter('price', itemIndex, 0) as number;
	if (price !== 0) payload.price = price;

	return payload;
}

/** `POST /project/leads/lead/list`. */
async function getMany(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const project = projectFor.call(this, itemIndex);
	const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
	const limit = this.getNodeParameter('limit', itemIndex, 50) as number;
	const written = jsonParameter.call(this, 'filtersJson', 'Filters', itemIndex);

	const body: IDataObject = {
		period: periodFor.call(this, itemIndex),
		sort_field: this.getNodeParameter('leadSortField', itemIndex, 'creation_date'),
		sort_order: this.getNodeParameter('leadSortOrder', itemIndex, 'desc'),
	};

	// This endpoint takes a flat list of triples and nothing else — no and/or tree
	// — so a filter written as an object is passed through untouched and Roistat
	// says what it thinks of it, rather than being silently reshaped here.
	if (written !== undefined) body.filters = written;

	const rows = await roistatApiRequestAllItems.call(this, '/project/leads/lead/list', body, {
		listKey: 'leads',
		limit: returnAll ? undefined : Math.max(1, limit),
		pageSize: 100,
		project,
	});

	return rows.map((row) => ({ json: row }));
}

/** `POST /project/leads/lead/create`. */
async function create(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const project = projectFor.call(this, itemIndex);
	const body = leadPayload.call(this, itemIndex);

	const missing = ['title', 'name', 'status', 'creation_date'].filter(
		(field) => body[field] === undefined,
	);

	if (missing.length > 0) {
		throw new NodeOperationError(this.getNode(), 'A new lead needs more fields', {
			description: `Roistat requires Title, Client Name, Status and Created At on this method. Missing: ${missing.join(', ')}.`,
			itemIndex,
		});
	}

	const payload = await roistatApiRequest.call(
		this,
		'POST',
		'/project/leads/lead/create',
		body,
		undefined,
		{ project },
	);

	// The answer is `{lead_id, status}` — the ID is the part worth keeping, and it
	// is merged with what was sent so the new lead can be used downstream without
	// a second read.
	const created = payload as IDataObject;

	return [{ json: { id: created?.lead_id ?? null, ...body } }];
}

/** `POST /project/leads/lead/update`. */
async function update(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const project = projectFor.call(this, itemIndex);
	const id = String(this.getNodeParameter('leadId', itemIndex, '') ?? '').trim();

	if (id === '') {
		throw new NodeOperationError(this.getNode(), 'This operation needs a lead ID', {
			description: 'Fill in Lead ID — the id field of a lead from Get Many.',
			itemIndex,
		});
	}

	const body = { id, ...leadPayload.call(this, itemIndex) };

	if (Object.keys(body).length === 1) {
		throw new NodeOperationError(this.getNode(), 'Nothing to change on the lead', {
			description: 'Fill in at least one field besides the ID.',
			itemIndex,
		});
	}

	const payload = await roistatApiRequest.call(
		this,
		'POST',
		'/project/leads/lead/update',
		body,
		undefined,
		{ project },
	);

	return toItems(payload, { ...body, success: true }).map((row) => ({ json: { id, ...row } }));
}

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	switch (operation) {
		case 'getMany':
			return await getMany.call(this, itemIndex);
		case 'create':
			return await create.call(this, itemIndex);
		case 'update':
			return await update.call(this, itemIndex);
		case 'getStatuses': {
			const payload = await roistatApiRequest.call(
				this,
				'POST',
				'/project/leads/status/list',
				undefined,
				undefined,
				{ project: projectFor.call(this, itemIndex), readOnly: true },
			);

			return listFrom(payload, 'data').map((row) => ({ json: row }));
		}
		default:
			throw unknownOperation.call(this, 'Lead', operation, itemIndex);
	}
}
