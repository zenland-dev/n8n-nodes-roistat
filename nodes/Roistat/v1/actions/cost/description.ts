import type { INodeProperties } from 'n8n-workflow';

import { projectIdProperty, returnAllProperties } from '../../descriptions/common';

const showFor = (operations: string[]): INodeProperties['displayOptions'] => ({
	show: { resource: ['cost'], operation: operations },
});

/**
 * Advertising spend, and the channels it is booked against.
 *
 * Roistat pulls spend automatically from the ad systems it integrates with. This
 * resource is for everything else — an agency invoice, a billboard, a paid post,
 * a channel with no API — and it is the half of ROI that has to be fed by hand:
 * revenue arrives with the deals, spend does not.
 *
 * The channel list lives here rather than under its own resource because a
 * channel's system name is only ever needed to book a cost against it.
 */
const operation: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	default: 'getMany',
	displayOptions: { show: { resource: ['cost'] } },
	options: [
		{
			name: 'Add',
			value: 'add',
			action: 'Add an advertising cost',
			description:
				'Записать расход по каналу за период. Roistat spreads the amount evenly over the days of the period when it builds a report.',
		},
		{
			name: 'Delete',
			value: 'delete',
			action: 'Delete an advertising cost',
			description: 'Удалить ранее внесённый расход по его ID',
		},
		{
			name: 'Get Channels',
			value: 'getChannels',
			action: 'Get many advertising channels',
			description:
				'Рекламные каналы проекта с их системными именами. The system name is what Add books a cost against — «Yandex.Direct» in the interface may be direct2 underneath. This returns the whole tree, every nesting level: 18 121 channels and 2.3 MB on the project this was checked against, so it is worth a Limit unless you really want all of it. The rows carry source, title, type and level — not the name and system_name the API docs describe.',
		},
		{
			name: 'Get Many',
			value: 'getMany',
			action: 'Get many advertising costs',
			description:
				'Все расходы, когда-либо внесённые в проект вручную. The endpoint takes no period and no filter, so this always reads the whole history.',
		},
		{
			name: 'Update',
			value: 'update',
			action: 'Update an advertising cost',
			description:
				'Изменить сумму ранее внесённого расхода. Only the amount can be changed; a wrong period or channel has to be deleted and added again.',
		},
	],
};

const listNotice: INodeProperties = {
	displayName:
		'У этого метода нет ни периода, ни фильтров — он отдаёт всю историю расходов проекта. Limit trims the answer after it arrives, so it makes the output smaller, not the request cheaper.',
	name: 'costListNotice',
	type: 'notice',
	default: '',
	displayOptions: showFor(['getMany']),
};

const source: INodeProperties = {
	displayName: 'Channel Name or ID',
	name: 'source',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getChannels' },
	default: '',
	required: true,
	displayOptions: showFor(['add']),
	description: 'Рекламный канал, на который списывается расход. The list is the project\'s own — a channel that is not integrated yet cannot be booked against. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
};

const dateFrom: INodeProperties = {
	displayName: 'Start Date',
	name: 'fromDate',
	type: 'dateTime',
	default: '',
	required: true,
	displayOptions: showFor(['add']),
	description: 'Начало периода расхода. Sent as YYYY-MM-DD — the time part is dropped.',
};

const dateTo: INodeProperties = {
	displayName: 'End Date',
	name: 'toDate',
	type: 'dateTime',
	default: '',
	required: true,
	displayOptions: showFor(['add']),
	description:
		'Конец периода расхода, включительно. A cost for a single day has the same start and end.',
};

const timezone: INodeProperties = {
	displayName: 'Timezone',
	name: 'timezone',
	type: 'string',
	default: '',
	placeholder: 'Europe/Moscow',
	displayOptions: showFor(['add']),
	description:
		'Часовой пояс, в котором понимать даты периода. Leave empty to let Roistat use the project\'s own — worth setting only when the spend was reported in another zone.',
};

const amount: INodeProperties = {
	displayName: 'Amount',
	name: 'marketingCost',
	type: 'number',
	default: 0,
	required: true,
	displayOptions: showFor(['add', 'update']),
	description: 'Сумма расхода в валюте проекта',
};

const costId: INodeProperties = {
	displayName: 'Cost ID',
	name: 'costId',
	type: 'string',
	default: '',
	required: true,
	displayOptions: showFor(['update', 'delete']),
	description: 'ID расхода, каким его выдаёт операция Get Many',
};

export const description: INodeProperties[] = [
	operation,
	{ ...projectIdProperty, displayOptions: { show: { resource: ['cost'] } } },
	listNotice,
	...returnAllProperties('cost', ['getMany']),
	source,
	dateFrom,
	dateTo,
	timezone,
	costId,
	amount,
];
