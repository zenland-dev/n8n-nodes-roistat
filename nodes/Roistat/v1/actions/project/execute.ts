import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { unknownOperation } from '../../../../../utils/router';
import { projectFor, toItems } from '../../helpers/request';
import { listFrom, roistatApiRequest } from '../../transport';

/**
 * `GET /user/projects` — every project the key can reach.
 *
 * Account-wide, so the project number is deliberately left off the request: this
 * is the call somebody makes precisely because they do not know the number yet,
 * and sending an empty one would fail the only call that could tell them.
 */
async function getMany(this: IExecuteFunctions): Promise<INodeExecutionData[]> {
	const payload = await roistatApiRequest.call(
		this,
		'GET',
		'/user/projects',
		undefined,
		undefined,
		{ omitProject: true },
	);

	return listFrom(payload, 'projects').map((row) => ({ json: row }));
}

/** `POST /account/project/create` — also account-wide. */
async function create(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const body: IDataObject = {
		name: this.getNodeParameter('name', itemIndex, ''),
		currency: this.getNodeParameter('currency', itemIndex, 'RUB'),
	};

	const payload = await roistatApiRequest.call(
		this,
		'POST',
		'/account/project/create',
		body,
		undefined,
		{ omitProject: true },
	);

	// The answer nests the new project and its counter under `data`.
	const created = (payload as IDataObject)?.data;

	return toItems(created ?? payload, { ...body, success: true }).map((row) => ({ json: row }));
}

/** `POST /project/access/change`. */
async function setAccess(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const project = projectFor.call(this, itemIndex);

	const body: IDataObject = {
		email: this.getNodeParameter('email', itemIndex, ''),
		access: this.getNodeParameter('access', itemIndex, 'read'),
	};

	const payload = await roistatApiRequest.call(
		this,
		'POST',
		'/project/access/change',
		body,
		undefined,
		{ project },
	);

	return toItems(payload, { ...body, success: true }).map((row) => ({ json: row }));
}

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	switch (operation) {
		case 'getMany':
			return await getMany.call(this);
		case 'create':
			return await create.call(this, itemIndex);
		case 'setAccess':
			return await setAccess.call(this, itemIndex);
		case 'getAccess': {
			const payload = await roistatApiRequest.call(
				this,
				'GET',
				'/project/access/get-authorized-users',
				undefined,
				undefined,
				{ project: projectFor.call(this, itemIndex) },
			);

			return listFrom(payload, 'authorized_users').map((row) => ({ json: row }));
		}
		case 'getCounter': {
			const payload = await roistatApiRequest.call(
				this,
				'POST',
				'/project/settings/counter/list',
				undefined,
				undefined,
				{ project: projectFor.call(this, itemIndex), readOnly: true },
			);

			return listFrom(payload, 'data').map((row) => ({ json: row }));
		}
		default:
			throw unknownOperation.call(this, 'Project', operation, itemIndex);
	}
}
