import type { INodeProperties } from 'n8n-workflow';

import { periodProperties, projectIdProperty } from '../../descriptions/common';

const showFor = (operations: string[]): INodeProperties['displayOptions'] => ({
	show: { resource: ['statistic'], operation: operations },
});

/**
 * The daily summary — the cheapest report in the API, on the tightest budget.
 *
 * One call returns visits, leads, sales, revenue, profit, spend, conversions,
 * CPC, CPL, CPO and ROI for every day of a period, plus a total row and an
 * average row. The same numbers can be assembled from the Analytics report, and
 * this is the shortcut.
 *
 * The catch is the limit: **five requests an hour, per project**. That is not a
 * client-side politeness setting but Roistat's own, and it is why the node
 * refuses rather than queues when the budget is spent — a workflow parked for
 * twelve minutes looks broken.
 */
const operation: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	default: 'getDaily',
	displayOptions: { show: { resource: ['statistic'] } },
	options: [
		{
			name: 'Get Daily',
			value: 'getDaily',
			action: 'Get daily statistics',
			description:
				'Основные показатели по дням за период, плюс итог и среднее. Limited to 5 requests per hour per project, so fetch a whole period at once rather than looping over days.',
		},
	],
};

const limitNotice: INodeProperties = {
	displayName:
		'У этого метода лимит 5 запросов в час на проект — самый жёсткий в API Roistat. Ask for the whole period in one call; a loop over days runs out of budget on the sixth day and the node will say so instead of waiting.',
	name: 'statisticLimitNotice',
	type: 'notice',
	default: '',
	displayOptions: showFor(['getDaily']),
};

const timezone: INodeProperties = {
	displayName: 'Timezone',
	name: 'timezone',
	type: 'string',
	default: '',
	placeholder: 'Europe/Moscow',
	displayOptions: showFor(['getDaily']),
	description:
		'Часовой пояс, по которому нарезать дни. Leave empty for UTC — which is what makes a "day" here start at three in the morning for a Moscow project.',
};

const channel: INodeProperties = {
	displayName: 'Channel Name or ID',
	name: 'channel',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getChannels' },
	default: '',
	displayOptions: showFor(['getDaily']),
	description: 'Считать только по одному рекламному каналу. Leave empty for the whole project. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
};

export const description: INodeProperties[] = [
	operation,
	{ ...projectIdProperty, displayOptions: { show: { resource: ['statistic'] } } },
	limitNotice,
	...periodProperties('statistic', ['getDaily']),
	timezone,
	channel,
];
