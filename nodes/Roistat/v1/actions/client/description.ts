import type { INodeProperties } from 'n8n-workflow';

import {
	filtersProperty,
	projectIdProperty,
	returnAllProperties,
} from '../../descriptions/common';

const showFor = (operations: string[]): INodeProperties['displayOptions'] => ({
	show: { resource: ['client'], operation: operations },
});

/**
 * The client — Roistat's own record of a person, assembled across their deals.
 *
 * This is «Управление клиентами», not the CRM's contact list: Roistat keeps one
 * client per external ID and hangs every visit, call, event and deal off it. The
 * feed is what that record is for — the whole history of one person in the order
 * it happened, which no other endpoint in the API returns.
 */
const operation: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	default: 'getMany',
	displayOptions: { show: { resource: ['client'] } },
	options: [
		{
			name: 'Get Feed',
			value: 'getFeed',
			action: 'Get the feed of a client',
			description:
				'История клиента: визиты, звонки, события, сделки и смены их статусов, по порядку. Each entry says what kind it is in its type field.',
		},
		{
			name: 'Get Many',
			value: 'getMany',
			action: 'Get many clients',
			description:
				'Список клиентов с суммами, числом заказов и первым источником. The revenue and profit here are lifetime figures, not period ones.',
		},
		{
			name: 'Import',
			value: 'import',
			action: 'Create or update a client',
			description:
				'Создать клиента или обновить существующего с тем же ID из CRM. Matching is by that ID, so re-running an import updates rather than duplicates.',
		},
	],
};

const clientId: INodeProperties = {
	displayName: 'Client ID',
	name: 'clientId',
	type: 'string',
	default: '',
	required: true,
	displayOptions: showFor(['getFeed']),
	description: 'ID клиента в Roistat, каким его выдаёт операция Get Many. Not the CRM identifier, which sits beside it in external_id.',
};

const importFields: INodeProperties[] = [
	{
		displayName: 'External ID',
		name: 'externalId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: showFor(['import']),
		description:
			'ID клиента в вашей CRM. This is what Roistat matches on, so the same value has to be used every time for one person.',
	},
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		default: '',
		required: true,
		displayOptions: showFor(['import']),
		description: 'Имя клиента',
	},
	{
		displayName: 'Phone',
		name: 'phone',
		type: 'string',
		default: '',
		displayOptions: showFor(['import']),
		description:
			'Телефон клиента. Either a phone or an email is needed for Roistat to tie calls and letters to this client.',
	},
	{
		displayName: 'Email',
		name: 'email',
		type: 'string',
		placeholder: 'name@email.com',
		default: '',
		displayOptions: showFor(['import']),
		description: 'Email клиента',
	},
	{
		displayName: 'Company',
		name: 'company',
		type: 'string',
		default: '',
		displayOptions: showFor(['import']),
		description: 'Компания клиента',
	},
	{
		displayName: 'Birth Date',
		name: 'birthDate',
		type: 'dateTime',
		default: '',
		displayOptions: showFor(['import']),
		description: 'Дата рождения. Sent as YYYY-MM-DD; the time part is dropped.',
	},
	{
		displayName: 'Custom Fields',
		name: 'customFields',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		default: {},
		placeholder: 'Add Field',
		displayOptions: showFor(['import']),
		description: 'Дополнительные поля клиента, по имени поля',
		options: [
			{
				displayName: 'Field',
				name: 'field',
				values: [
					{ displayName: 'Name', name: 'name', type: 'string', default: '', description: 'Название поля' },
					{ displayName: 'Value', name: 'value', type: 'string', default: '', description: 'Значение поля' },
				],
			},
		],
	},
];

export const description: INodeProperties[] = [
	operation,
	{ ...projectIdProperty, displayOptions: { show: { resource: ['client'] } } },
	clientId,
	filtersProperty('client', ['getMany']),
	...returnAllProperties('client', ['getMany']),
	...importFields,
];
