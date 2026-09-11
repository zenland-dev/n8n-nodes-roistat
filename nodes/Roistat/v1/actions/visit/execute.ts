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
} from '../../helpers/request';
import { roistatApiRequest, roistatApiRequestAllItems } from '../../transport';

/** `POST /project/site/visit/list`. */
async function getMany(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const project = projectFor.call(this, itemIndex);
	const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
	const limit = this.getNodeParameter('limit', itemIndex, 50) as number;
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

	if (sortField !== '') body.sort = [sortField, sortOrder];

	const rows = await roistatApiRequestAllItems.call(this, '/project/site/visit/list', body, {
		listKey: 'data',
		limit: returnAll ? undefined : Math.max(1, limit),
		// Roistat caps a single answer at 10 000 visits. The page stays well under
		// that: a smaller page is a shorter time holding a busy project's budget,
		// and the walk stops on `total` anyway.
		pageSize: 500,
		project,
	});

	return rows.map((row) => ({ json: row }));
}

/** `POST /project/site/visit/params/update`. */
async function updateParams(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const project = projectFor.call(this, itemIndex);
	const visit = String(this.getNodeParameter('visitId', itemIndex, '') ?? '').trim();
	const params = omitEmpty(this.getNodeParameter('params', itemIndex, {}) as IDataObject);

	if (visit === '') {
		throw new NodeOperationError(this.getNode(), 'This operation needs a visit ID', {
			description: 'Fill in Visit ID — the value of the roistat_visit cookie for that visit.',
			itemIndex,
		});
	}

	if (Object.keys(params).length === 0) {
		throw new NodeOperationError(this.getNode(), 'No params to write', {
			description: 'Add at least one of roistat_param1…5 under Params.',
			itemIndex,
		});
	}

	const payload = await roistatApiRequest.call(
		this,
		'POST',
		'/project/site/visit/params/update',
		{ visit, ...params },
		undefined,
		{ project },
	);

	return toItems(payload, { visit, ...params, success: true }).map((row) => ({ json: row }));
}

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	switch (operation) {
		case 'getMany':
			return await getMany.call(this, itemIndex);
		case 'updateParams':
			return await updateParams.call(this, itemIndex);
		default:
			throw unknownOperation.call(this, 'Visit', operation, itemIndex);
	}
}
