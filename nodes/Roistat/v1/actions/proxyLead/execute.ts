import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { unknownOperation } from '../../../../../utils/router';
import { periodStringFor, projectFor } from '../../helpers/request';
import { listFrom, roistatApiRequest } from '../../transport';

/**
 * `GET /project/proxy-leads` — the whole period, in one answer.
 *
 * No limit, no offset, no total: the endpoint takes a period and returns what is
 * in it. That is why the operation has no Return All switch — there is nothing to
 * page through, and pretending otherwise would only hide how much a wide period
 * costs.
 */
async function getMany(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const project = projectFor.call(this, itemIndex);
	const period = periodStringFor.call(this, itemIndex);

	const payload = await roistatApiRequest.call(
		this,
		'GET',
		'/project/proxy-leads',
		undefined,
		{ period },
		{ project },
	);

	return listFrom(payload, 'ProxyLeads').map((row) => ({ json: row }));
}

/** `GET /project/proxy-leads/{id}`. */
async function get(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const project = projectFor.call(this, itemIndex);
	const id = String(this.getNodeParameter('proxyLeadId', itemIndex, '') ?? '').trim();

	if (id === '') {
		throw new NodeOperationError(this.getNode(), 'This operation needs a lead ID', {
			description: 'Fill in Lead ID — the id field of a lead from Get Many.',
			itemIndex,
		});
	}

	const payload = await roistatApiRequest.call(
		this,
		'GET',
		`/project/proxy-leads/${encodeURIComponent(id)}`,
		undefined,
		undefined,
		{ project },
	);

	// The documentation describes the answer as `ProxyLead` and shows it as
	// `ProxyLeads`, so both are read. Whichever arrives, the result is the lead.
	const single = listFrom(payload, 'ProxyLead');
	const rows = single.length > 0 ? single : listFrom(payload, 'ProxyLeads');

	return rows.map((row) => ({ json: row }));
}

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	switch (operation) {
		case 'getMany':
			return await getMany.call(this, itemIndex);
		case 'get':
			return await get.call(this, itemIndex);
		default:
			throw unknownOperation.call(this, 'Site Lead', operation, itemIndex);
	}
}
