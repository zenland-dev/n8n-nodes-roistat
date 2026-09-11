import type { INodeProperties } from 'n8n-workflow';

import {
	filtersProperty,
	periodProperties,
	projectIdProperty,
	returnAllProperties,
	sortProperties,
} from '../../descriptions/common';

const showFor = (operations: string[]): INodeProperties['displayOptions'] => ({
	show: { resource: ['order'], operation: operations },
});

/** Every operation that addresses one deal. */
const NEEDS_ORDER = ['get', 'getExternalUrl', 'updateStatus', 'delete'];

/**
 * The deal — Roistat's copy of what lives in the CRM.
 *
 * Which half of this resource works depends on how the project gets its deals.
 * A project integrated with amoCRM or Bitrix24 receives them and this node reads
 * them; a project integrated «по API» is fed by whoever calls Upload, and only
 * such a project can have a deal updated or deleted through the API. Roistat says
 * so on the two write methods and answers the others with a refusal, which is
 * worth knowing before wiring a workflow around them.
 */
const operation: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	default: 'getMany',
	displayOptions: { show: { resource: ['order'] } },
	options: [
		{
			name: 'Delete',
			value: 'delete',
			action: 'Delete a deal',
			description:
				'Удалить сделку из Roistat. Only works on a project fed through the API — a deal that arrived from a CRM integration comes back on the next sync.',
		},
		{
			name: 'Get',
			value: 'get',
			action: 'Get a deal',
			description:
				'Полная карточка сделки: товары, клиент, статус и вся цепочка визитов, приведших к продаже. This is the richest single read in the API.',
		},
		{
			name: 'Get Custom Fields',
			value: 'getCustomFields',
			action: 'Get many deal custom fields',
			description:
				'Названия дополнительных полей сделок, которые Roistat получает из CRM. Fields are addressed by these names, not by an ID.',
		},
		{
			name: 'Get External URL',
			value: 'getExternalUrl',
			action: 'Get the CRM URL of a deal',
			description: 'Ссылка на сделку в самой CRM — то, что открывает карточку в amoCRM или Битрикс24',
		},
		{
			name: 'Get Many',
			value: 'getMany',
			action: 'Get many deals',
			description:
				'Список сделок проекта с их статусами и суммами. Turn on Include Visit to get the visit each deal came from in the same call.',
		},
		{
			name: 'Get Statuses',
			value: 'getStatuses',
			action: 'Get many deal statuses',
			description:
				'Статусы сделок в том виде, в каком их знает Roistat, с группой каждого: не учитывается, в работе, оплачен, отказ. These IDs are what Update Status takes.',
		},
		{
			name: 'Set Statuses',
			value: 'setStatuses',
			action: 'Set the deal statuses of a project',
			description:
				'Загрузить справочник статусов целиком. The list replaces what is there, so it has to contain every status you use, not just the new ones.',
		},
		{
			name: 'Update Status',
			value: 'updateStatus',
			action: 'Update the status of a deal',
			description:
				'Перевести сделку в другой статус. Available only on a project integrated through goals or through the API.',
		},
		{
			name: 'Upload',
			value: 'upload',
			action: 'Upload a deal',
			description:
				'Загрузить сделку в проект — создать новую или обновить существующую с тем же ID. The visit number in the roistat field is what ties the deal to an advertising channel.',
		},
	],
};

const orderId: INodeProperties = {
	displayName: 'Deal ID',
	name: 'orderId',
	type: 'string',
	default: '',
	required: true,
	displayOptions: showFor(NEEDS_ORDER),
	description: 'ID сделки в CRM — тот же, под которым она пришла в Roistat, и его выдаёт операция Get Many',
};

const statusFilter: INodeProperties = {
	displayName: 'Status Group',
	name: 'statusGroup',
	type: 'options',
	default: '',
	displayOptions: showFor(['getMany']),
	options: [
		{ name: 'Any', value: '' },
		{ name: 'In Progress', value: '0' },
		{ name: 'Paid', value: '1' },
		{ name: 'Cancelled', value: '2' },
	],
	description:
		'Группа воронки, в которую попадает статус сделки. This is the coarse three-way grouping Roistat keeps, not the CRM status itself — filter by that with the Filters field.',
};

const includeVisit: INodeProperties = {
	displayName: 'Include Visit',
	name: 'includeVisit',
	type: 'boolean',
	default: false,
	displayOptions: showFor(['getMany']),
	description:
		'Whether to include the visit each deal came from. It saves a second call, and it costs: Roistat drops the rate limit for this method from 20 requests a minute to 10, or to 1 when a page holds more than 1000 deals. The node paces itself accordingly.',
};

const dealDateNotice: INodeProperties = {
	displayName:
		'Период фильтрует по дате создания сделки (creation_date). To filter by the update date instead, leave the period empty and write the condition in Filters.',
	name: 'orderPeriodNotice',
	type: 'notice',
	default: '',
	displayOptions: showFor(['getMany']),
};

const uploadFields: INodeProperties[] = [
	{
		displayName: 'Deal ID',
		name: 'dealId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: showFor(['upload']),
		description:
			'ID сделки в вашей системе. Uploading the same ID again updates that deal rather than creating a second one, which is what makes this operation safe to re-run.',
	},
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		default: '',
		displayOptions: showFor(['upload']),
		description: 'Название сделки, как оно будет видно в интерфейсе Roistat',
	},
	{
		displayName: 'Created At',
		name: 'dateCreate',
		type: 'dateTime',
		default: '',
		displayOptions: showFor(['upload']),
		description:
			'Дата создания сделки. Roistat takes a UNIX timestamp or YYYY-MM-DD HH:MM; the node sends the latter. This is the date the deal is counted on in reports.',
	},
	{
		displayName: 'Status ID',
		name: 'statusId',
		type: 'string',
		default: '',
		displayOptions: showFor(['upload']),
		description:
			'ID статуса из справочника проекта. Upload the dictionary first with Set Statuses — a status Roistat does not know puts the deal in the «не учитывается» group.',
	},
	{
		displayName: 'Visit ID',
		name: 'roistat',
		type: 'string',
		default: '',
		displayOptions: showFor(['upload']),
		description:
			'Номер визита из куки roistat_visit — the single most important field here. Without it Roistat has no way to attribute the deal to a channel, and the deal lands in «Прямые заходы».',
	},
	{
		displayName: 'Revenue',
		name: 'price',
		type: 'number',
		default: 0,
		displayOptions: showFor(['upload']),
		description: 'Сумма сделки. Feeds the Revenue metric.',
	},
	{
		displayName: 'Cost',
		name: 'cost',
		type: 'number',
		default: 0,
		displayOptions: showFor(['upload']),
		description: 'Себестоимость сделки. Feeds Profit, which is revenue minus this and the marketing spend.',
	},
	{
		displayName: 'Custom Fields',
		name: 'customFields',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		default: {},
		placeholder: 'Add Field',
		displayOptions: showFor(['upload']),
		description:
			'Дополнительные поля сделки, до 1000 символов на поле. They are addressed by the name shown in Roistat — Get Custom Fields lists the ones the project already knows.',
		options: [
			{
				displayName: 'Field',
				name: 'field',
				values: [
					{
						displayName: 'Name',
						name: 'name',
						type: 'string',
						default: '',
						description: 'Название поля, например Менеджер',
					},
					{ displayName: 'Value', name: 'value', type: 'string', default: '', description: 'Значение поля' },
				],
			},
		],
	},
];

const statusId: INodeProperties = {
	displayName: 'Status Name or ID',
	name: 'statusId',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getOrderStatuses' },
	default: '',
	required: true,
	displayOptions: showFor(['updateStatus']),
	description: 'Новый статус сделки. The list comes from the project — an empty one means no CRM statuses have been uploaded yet. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
};

const statusesJson: INodeProperties = {
	displayName: 'Statuses (JSON)',
	name: 'statusesJson',
	type: 'json',
	default: '[{"id": "1", "name": "New", "type": "progress"}]',
	typeOptions: { rows: 5 },
	required: true,
	displayOptions: showFor(['setStatuses']),
	description: 'Полный справочник статусов: массив объектов с ID, name и type. Type is one of unused, progress, paid, canceled — it decides which funnel group the status counts in. Sending a partial list is how a project loses statuses, so send every one you use.',
};

const setStatusesNotice: INodeProperties = {
	displayName:
		'Этот метод заменяет справочник целиком, а не дополняет его. List every status you use, including the ones already there — otherwise the missing ones stop being recognised and their deals fall into «не учитывается».',
	name: 'orderSetStatusesNotice',
	type: 'notice',
	default: '',
	displayOptions: showFor(['setStatuses']),
};

export const description: INodeProperties[] = [
	operation,
	{ ...projectIdProperty, displayOptions: { show: { resource: ['order'] } } },
	orderId,
	dealDateNotice,
	...periodProperties('order', ['getMany'], false),
	statusFilter,
	includeVisit,
	filtersProperty('order', ['getMany']),
	...sortProperties('order', ['getMany']),
	...returnAllProperties('order', ['getMany']),
	...uploadFields,
	statusId,
	setStatusesNotice,
	statusesJson,
];
