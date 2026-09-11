import type { INodeProperties } from 'n8n-workflow';

import {
	filtersProperty,
	periodProperties,
	projectIdProperty,
	returnAllProperties,
} from '../../descriptions/common';

const showFor = (operations: string[]): INodeProperties['displayOptions'] => ({
	show: { resource: ['lead'], operation: operations },
});

/**
 * The lead board — Roistat's built-in replacement for a CRM.
 *
 * «Управление заявками» is a separate feature, switched on per project, and its
 * leads are not the deals the Order resource reads: a project uses one or the
 * other. Everything here answers with an error on a project that has a CRM
 * integrated instead, which is what the notice below is for.
 */
const operation: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	default: 'getMany',
	displayOptions: { show: { resource: ['lead'] } },
	options: [
		{
			name: 'Create',
			value: 'create',
			action: 'Create a lead',
			description:
				'Создать заявку в Управлении заявками. The source field takes the visit number, which is what ties the lead to an advertising channel.',
		},
		{
			name: 'Get Many',
			value: 'getMany',
			action: 'Get many leads',
			description: 'Список заявок за период, с суммами, статусами и контактами клиента',
		},
		{
			name: 'Get Statuses',
			value: 'getStatuses',
			action: 'Get many lead statuses',
			description: 'Статусы заявок проекта — то, что принимают поля Status у Create и Update',
		},
		{
			name: 'Update',
			value: 'update',
			action: 'Update a lead',
			description:
				'Изменить заявку. Only the fields filled in below are sent, so everything left alone stays as it is.',
		},
	],
};

const featureNotice: INodeProperties = {
	displayName:
		'Это заявки из «Управления заявками» — встроенной замены CRM, отдельной опции проекта. If the project is integrated with a CRM instead, its deals live under the Deal resource and these methods will refuse.',
	name: 'leadFeatureNotice',
	type: 'notice',
	default: '',
	displayOptions: { show: { resource: ['lead'] } },
};

const leadId: INodeProperties = {
	displayName: 'Lead ID',
	name: 'leadId',
	type: 'string',
	default: '',
	required: true,
	displayOptions: showFor(['update']),
	description: 'ID заявки в Roistat',
};

const sortField: INodeProperties = {
	displayName: 'Sort Field',
	name: 'leadSortField',
	type: 'options',
	default: 'creation_date',
	required: true,
	displayOptions: showFor(['getMany']),
	options: [
		{ name: 'Created At', value: 'creation_date' },
		{ name: 'ID', value: 'id' },
		{ name: 'Paid At', value: 'paid_date' },
		{ name: 'Price', value: 'price' },
		{ name: 'Source', value: 'source' },
		{ name: 'Status', value: 'status' },
	],
	description:
		'Поле сортировки. Roistat requires one on this method — unlike its other list endpoints, it refuses a request without it.',
};

const sortOrder: INodeProperties = {
	displayName: 'Sort Order',
	name: 'leadSortOrder',
	type: 'options',
	default: 'desc',
	displayOptions: showFor(['getMany']),
	options: [
		{ name: 'Ascending', value: 'asc' },
		{ name: 'Descending', value: 'desc' },
	],
	description: 'Порядок сортировки',
};

/**
 * The lead's own fields.
 *
 * Create requires four of them and Update requires none, so they share one set
 * of properties and the execute half decides what is mandatory. Marking them
 * required in the editor would make Update look like it needs a title to change
 * a phone number.
 */
const leadFields: INodeProperties[] = [
	{
		displayName: 'Title',
		name: 'title',
		type: 'string',
		default: '',
		displayOptions: showFor(['create', 'update']),
		description: 'Название заявки. Required when creating.',
	},
	{
		displayName: 'Client Name',
		name: 'name',
		type: 'string',
		default: '',
		displayOptions: showFor(['create', 'update']),
		description: 'Имя клиента. Required when creating.',
	},
	{
		displayName: 'Status Name or ID',
		name: 'status',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getLeadStatuses' },
		default: '',
		displayOptions: showFor(['create', 'update']),
		description: 'Статус заявки. Required when creating. The list is the project\'s own; the three built-in ones are «в работе», «оплачен» and «отменён». Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Created At',
		name: 'creationDate',
		type: 'dateTime',
		default: '',
		displayOptions: showFor(['create', 'update']),
		description:
			'Дата создания заявки. Required when creating, and it is the date the lead is counted on in reports — not the moment this node ran.',
	},
	{
		displayName: 'Phone',
		name: 'phone',
		type: 'string',
		default: '',
		displayOptions: showFor(['create', 'update']),
		description: 'Телефон клиента',
	},
	{
		displayName: 'Email',
		name: 'email',
		type: 'string',
		placeholder: 'name@email.com',
		default: '',
		displayOptions: showFor(['create', 'update']),
		description: 'Email клиента',
	},
	{
		displayName: 'Price',
		name: 'price',
		type: 'number',
		default: 0,
		displayOptions: showFor(['create', 'update']),
		description: 'Сумма заявки',
	},
	{
		displayName: 'Visit ID',
		name: 'source',
		type: 'string',
		default: '',
		displayOptions: showFor(['create', 'update']),
		description:
			'Номер визита из куки roistat_visit — поле source в API. Without it the lead has no advertising source and lands in «Прямые заходы».',
	},
	{
		displayName: 'Paid At',
		name: 'paidDate',
		type: 'dateTime',
		default: '',
		displayOptions: showFor(['create', 'update']),
		description: 'Дата оплаты заявки',
	},
	{
		displayName: 'Comment',
		name: 'text',
		type: 'string',
		default: '',
		displayOptions: showFor(['update']),
		description:
			'Комментарий к заявке. The create method has no field for it — add the comment with Update afterwards.',
	},
];

export const description: INodeProperties[] = [
	operation,
	featureNotice,
	{ ...projectIdProperty, displayOptions: { show: { resource: ['lead'] } } },
	leadId,
	...periodProperties('lead', ['getMany']),
	sortField,
	sortOrder,
	filtersProperty('lead', ['getMany']),
	...returnAllProperties('lead', ['getMany']),
	...leadFields,
];
