import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { unknownOperation } from '../../../../../utils/router';
import {
	fieldsFromCollection,
	jsonParameter,
	filtersPayload,
	omitEmpty,
	periodFor,
	projectFor,
	toItems,
	toRoistatDateTime,
} from '../../helpers/request';
import { BUDGETS, listFrom, roistatApiRequest, roistatApiRequestAllItems } from '../../transport';

/** How many deals to ask for in one page. */
const PAGE_SIZE = 100;

/** The ID of the deal this item is about, refusing a blank one. */
function orderId(this: IExecuteFunctions, itemIndex: number): string {
	const id = String(this.getNodeParameter('orderId', itemIndex, '') ?? '').trim();

	if (id === '') {
		throw new NodeOperationError(this.getNode(), 'This operation needs a deal ID', {
			description: 'Fill in Deal ID — it is the id field of a deal from Get Many.',
			itemIndex,
		});
	}

	return id;
}

/** `POST /project/integration/order/list`. */
async function getMany(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const project = projectFor.call(this, itemIndex);
	const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
	const limit = this.getNodeParameter('limit', itemIndex, 50) as number;
	const includeVisit = this.getNodeParameter('includeVisit', itemIndex, false) as boolean;
	const statusGroup = String(this.getNodeParameter('statusGroup', itemIndex, '') ?? '');
	const sortField = String(this.getNodeParameter('sortField', itemIndex, '') ?? '').trim();
	const sortOrder = String(this.getNodeParameter('sortOrder', itemIndex, 'desc') ?? 'desc');
	const written = jsonParameter.call(this, 'filtersJson', 'Filters', itemIndex);

	const period = periodFor.call(this, itemIndex, false);
	const built: unknown[] = [];

	if (period !== undefined) {
		built.push(['creation_date', '>=', period.from], ['creation_date', '<=', period.to]);
	}

	if (statusGroup !== '') built.push(['status', '=', statusGroup]);

	const body: IDataObject = {};

	// A one-condition `and` answers 500 on a live project, so the shape is decided
	// by `filtersPayload` rather than here. Filtering by status alone builds
	// exactly one condition, which is how that bug is met in practice.
	const filters = filtersPayload(built, written);
	if (filters !== undefined) body.filters = filters;

	if (includeVisit) body.extend = ['visit'];
	if (sortField !== '') body.sort = [sortField, sortOrder];

	const pageSize = returnAll ? PAGE_SIZE : Math.min(PAGE_SIZE, Math.max(1, limit));

	const rows = await roistatApiRequestAllItems.call(this, '/project/integration/order/list', body, {
		listKey: 'data',
		limit: returnAll ? undefined : Math.max(1, limit),
		pageSize,
		project,
		// The list method carries its own limit, and asking for visits alongside
		// tightens it — to 10 a minute at this page size, and to 1 above a thousand
		// rows a page. Spending it is what makes every other integration on the
		// project wait, so the budget is respected rather than discovered.
		budget: includeVisit ? BUDGETS.orderListWithVisit(pageSize) : BUDGETS.orderList,
	});

	return rows.map((row) => ({ json: row }));
}

/** `GET /project/orders/{id}/info` — the deal, its products and its visit chain. */
async function get(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const project = projectFor.call(this, itemIndex);
	const id = orderId.call(this, itemIndex);

	const payload = (await roistatApiRequest.call(
		this,
		'GET',
		`/project/orders/${encodeURIComponent(id)}/info`,
		undefined,
		undefined,
		{ project },
	)) as IDataObject;

	// The three parts arrive as siblings — `order`, `visits`, `products` — and the
	// envelope's own `status` field is the request verdict, not the deal's, so it
	// is deliberately not merged in.
	const order = (payload.order ?? {}) as IDataObject;

	return [
		{
			json: {
				...order,
				visits: payload.visits ?? [],
				products: payload.products ?? [],
			},
		},
	];
}

/** `GET /project/orders/{id}/external-url`. */
async function getExternalUrl(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const project = projectFor.call(this, itemIndex);
	const id = orderId.call(this, itemIndex);

	const payload = (await roistatApiRequest.call(
		this,
		'GET',
		`/project/orders/${encodeURIComponent(id)}/external-url`,
		undefined,
		undefined,
		{ project },
	)) as IDataObject;

	return [{ json: { id, externalUrl: payload.externalUrl ?? null } }];
}

/**
 * `POST /project/add-orders` — create or update one deal.
 *
 * The endpoint takes an array, and this node sends one deal per input item
 * rather than batching: n8n's own item stream is the batch, `pairedItem` stays
 * honest, and a rejected deal names the item it came from. The answer is a tally
 * of what happened to the upload, which is returned as-is — `uploaded: 0` with
 * `skipped_by_waiting_visit_info: 1` is a normal answer meaning Roistat has not
 * seen that visit yet.
 */
async function upload(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const project = projectFor.call(this, itemIndex);
	const id = String(this.getNodeParameter('dealId', itemIndex, '') ?? '').trim();

	if (id === '') {
		throw new NodeOperationError(this.getNode(), 'A deal needs an ID', {
			description:
				'Fill in Deal ID. Roistat keys deals on it, so uploading the same ID again updates that deal instead of adding another.',
			itemIndex,
		});
	}

	const fields = fieldsFromCollection(this.getNodeParameter('customFields', itemIndex, {}));

	const deal: IDataObject = omitEmpty({
		id,
		name: this.getNodeParameter('name', itemIndex, ''),
		date_create: toRoistatDateTime(this.getNodeParameter('dateCreate', itemIndex, '')),
		status: this.getNodeParameter('statusId', itemIndex, ''),
		roistat: this.getNodeParameter('roistat', itemIndex, ''),
	});

	// Money is sent as a string, which is how the documented example writes it, and
	// zero is a real value — it must not be dropped the way an empty field is.
	const price = this.getNodeParameter('price', itemIndex, 0) as number;
	const cost = this.getNodeParameter('cost', itemIndex, 0) as number;
	deal.price = String(price);
	deal.cost = String(cost);

	if (Object.keys(fields).length > 0) deal.fields = fields;

	const payload = await roistatApiRequest.call(this, 'POST', '/project/add-orders', [deal], undefined, {
		project,
	});

	return toItems(payload, { id, success: true }).map((row) => ({ json: { id, ...row } }));
}

/** `POST /project/integration/order/{id}/status/update`. */
async function updateStatus(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const project = projectFor.call(this, itemIndex);
	const id = orderId.call(this, itemIndex);
	const statusId = String(this.getNodeParameter('statusId', itemIndex, '') ?? '').trim();

	const payload = await roistatApiRequest.call(
		this,
		'POST',
		`/project/integration/order/${encodeURIComponent(id)}/status/update`,
		{ status_id: statusId },
		undefined,
		{ project },
	);

	return toItems(payload, { id, status_id: statusId, success: true }).map((row) => ({ json: row }));
}

/** `POST /project/integration/order/{id}/delete`. */
async function remove(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const project = projectFor.call(this, itemIndex);
	const id = orderId.call(this, itemIndex);

	const payload = await roistatApiRequest.call(
		this,
		'POST',
		`/project/integration/order/${encodeURIComponent(id)}/delete`,
		undefined,
		undefined,
		{ project },
	);

	return toItems(payload, { id, deleted: true }).map((row) => ({ json: row }));
}

/** `POST /project/set-statuses` — the whole dictionary, every time. */
async function setStatuses(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const project = projectFor.call(this, itemIndex);
	const statuses = jsonParameter.call(this, 'statusesJson', 'Statuses', itemIndex);

	if (!Array.isArray(statuses) || statuses.length === 0) {
		throw new NodeOperationError(this.getNode(), 'Statuses must be a non-empty array', {
			description:
				'This method replaces the project\'s status dictionary, so it takes the complete list: [{"id": "1", "name": "New", "type": "progress"}, …].',
			itemIndex,
		});
	}

	const payload = await roistatApiRequest.call(
		this,
		'POST',
		'/project/set-statuses',
		statuses as IDataObject[],
		undefined,
		{ project },
	);

	return toItems(payload, { uploaded: statuses.length, success: true }).map((row) => ({
		json: row,
	}));
}

/** `POST /project/analytics/order-custom-fields` — names only, no IDs. */
async function getCustomFields(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const project = projectFor.call(this, itemIndex);

	const payload = (await roistatApiRequest.call(
		this,
		'POST',
		'/project/analytics/order-custom-fields',
		undefined,
		undefined,
		{ project, readOnly: true },
	)) as IDataObject;

	// Documented as an object, delivered as an array of names on every project
	// seen. Both are handled, and either way the result is one item per field so
	// that the list can be looped over.
	const fields = payload.fields;

	if (Array.isArray(fields)) {
		return fields.map((name) => ({ json: { name: String(name) } }));
	}

	if (fields !== null && typeof fields === 'object') {
		return Object.values(fields as IDataObject).map((name) => ({ json: { name: String(name) } }));
	}

	return [];
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
		case 'getExternalUrl':
			return await getExternalUrl.call(this, itemIndex);
		case 'upload':
			return await upload.call(this, itemIndex);
		case 'updateStatus':
			return await updateStatus.call(this, itemIndex);
		case 'delete':
			return await remove.call(this, itemIndex);
		case 'setStatuses':
			return await setStatuses.call(this, itemIndex);
		case 'getCustomFields':
			return await getCustomFields.call(this, itemIndex);
		case 'getStatuses': {
			const payload = await roistatApiRequest.call(
				this,
				'POST',
				'/project/integration/status/list',
				undefined,
				undefined,
				{ project: projectFor.call(this, itemIndex), readOnly: true },
			);

			return listFrom(payload, 'data').map((row) => ({ json: row }));
		}
		default:
			throw unknownOperation.call(this, 'Deal', operation, itemIndex);
	}
}
