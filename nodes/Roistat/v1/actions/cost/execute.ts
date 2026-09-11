import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { unknownOperation } from '../../../../../utils/router';
import { omitEmpty, projectFor, toItems, toRoistatDate } from '../../helpers/request';
import { listFrom, roistatApiRequest } from '../../transport';

/**
 * `POST /project/analytics/source/cost/list` — every manual cost ever entered.
 *
 * The endpoint takes neither a period nor a limit, so paging would be a fiction:
 * Limit is applied here, after the answer arrives, and the notice on the field
 * says as much rather than letting it look like a cheaper request.
 *
 * The documentation shows a bare array; a live project answers `{data, total}`
 * like every other list (checked 11.09.2026). `listFrom` handles both, so the
 * difference costs nothing — but it is why the key is passed explicitly.
 */
async function getMany(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const project = projectFor.call(this, itemIndex);
	const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
	const limit = this.getNodeParameter('limit', itemIndex, 50) as number;

	const payload = await roistatApiRequest.call(
		this,
		'POST',
		'/project/analytics/source/cost/list',
		undefined,
		undefined,
		{ project, readOnly: true },
	);

	const rows = listFrom(payload, 'data');

	return (returnAll ? rows : rows.slice(0, Math.max(1, limit))).map((row) => ({ json: row }));
}

/** `POST /project/analytics/source/cost/add`. */
async function add(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const project = projectFor.call(this, itemIndex);
	const source = String(this.getNodeParameter('source', itemIndex, '') ?? '').trim();
	const fromDate = toRoistatDate(this.getNodeParameter('fromDate', itemIndex, ''));
	const toDate = toRoistatDate(this.getNodeParameter('toDate', itemIndex, ''));
	const amount = this.getNodeParameter('marketingCost', itemIndex, 0) as number;

	if (source === '' || fromDate === '' || toDate === '') {
		throw new NodeOperationError(this.getNode(), 'A cost needs a channel and a period', {
			description: 'Fill in Channel, Start Date and End Date. Roistat books spend against a channel over a period, and refuses a request missing any of the three.',
			itemIndex,
		});
	}

	const body: IDataObject = omitEmpty({
		source,
		from_date: fromDate,
		to_date: toDate,
		timezone: this.getNodeParameter('timezone', itemIndex, ''),
	});

	// Zero is a legitimate amount — it is how a mistaken cost is neutralised
	// without deleting the record — so it is set after `omitEmpty`, which drops
	// nothing here but would if the value ever became a string.
	body.marketing_cost = amount;

	const payload = await roistatApiRequest.call(
		this,
		'POST',
		'/project/analytics/source/cost/add',
		body,
		undefined,
		{ project },
	);

	// The answer wraps the created cost in `data`, unlike the update and delete
	// calls, which answer with a bare status.
	const created = (payload as IDataObject)?.data;

	return toItems(created ?? payload, { source, marketing_cost: amount, success: true }).map(
		(row) => ({ json: row }),
	);
}

/** `POST /project/analytics/source/cost/update` — the amount, and only the amount. */
async function update(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const project = projectFor.call(this, itemIndex);
	const id = String(this.getNodeParameter('costId', itemIndex, '') ?? '').trim();
	const amount = this.getNodeParameter('marketingCost', itemIndex, 0) as number;

	if (id === '') {
		throw new NodeOperationError(this.getNode(), 'This operation needs a cost ID', {
			description: 'Fill in Cost ID — the id field of a row from Get Many.',
			itemIndex,
		});
	}

	const payload = await roistatApiRequest.call(
		this,
		'POST',
		'/project/analytics/source/cost/update',
		{ id: Number(id), marketing_cost: amount },
		undefined,
		{ project },
	);

	return toItems(payload, { id, marketing_cost: amount, success: true }).map((row) => ({
		json: row,
	}));
}

/** `POST /project/analytics/source/cost/delete`. */
async function remove(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const project = projectFor.call(this, itemIndex);
	const id = String(this.getNodeParameter('costId', itemIndex, '') ?? '').trim();

	if (id === '') {
		throw new NodeOperationError(this.getNode(), 'This operation needs a cost ID', {
			description: 'Fill in Cost ID — the id field of a row from Get Many.',
			itemIndex,
		});
	}

	const payload = await roistatApiRequest.call(
		this,
		'POST',
		'/project/analytics/source/cost/delete',
		{ id: Number(id) },
		undefined,
		{ project },
	);

	return toItems(payload, { id, deleted: true }).map((row) => ({ json: row }));
}

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	switch (operation) {
		case 'getMany':
			return await getMany.call(this, itemIndex);
		case 'add':
			return await add.call(this, itemIndex);
		case 'update':
			return await update.call(this, itemIndex);
		case 'delete':
			return await remove.call(this, itemIndex);
		case 'getChannels': {
			const payload = await roistatApiRequest.call(
				this,
				'POST',
				'/project/analytics/source/list',
				undefined,
				undefined,
				{ project: projectFor.call(this, itemIndex), readOnly: true },
			);

			return listFrom(payload, 'data').map((row) => ({ json: row }));
		}
		default:
			throw unknownOperation.call(this, 'Advertising Cost', operation, itemIndex);
	}
}
