import type { INodeProperties } from 'n8n-workflow';

import { periodProperties, projectIdProperty } from '../../descriptions/common';

const showFor = (operations: string[]): INodeProperties['displayOptions'] => ({
	show: { resource: ['proxyLead'], operation: operations },
});

/**
 * The proxy lead — a form submission on the way to the CRM.
 *
 * Roistat's own widgets (callback, the lead catcher, a form with its script on
 * it) record the submission before anything else happens to it, together with
 * the visit that produced it. That record is a proxy lead, and it survives even
 * when the CRM never got the deal — which is exactly when it is worth reading.
 *
 * It is a read-only corner of the API: there is no method to create one, because
 * creating one is what the tracking script does in the browser.
 */
const operation: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	default: 'getMany',
	displayOptions: { show: { resource: ['proxyLead'] } },
	options: [
		{
			name: 'Get',
			value: 'get',
			action: 'Get a site lead',
			description: 'Одна заявка с сайта по её ID в Roistat',
		},
		{
			name: 'Get Many',
			value: 'getMany',
			action: 'Get many site leads',
			description:
				'Заявки с сайта за период: имя, телефон, email, текст и номер визита. The order_id field says which CRM deal the lead became, and is empty when it never became one.',
		},
	],
};

const periodNotice: INodeProperties = {
	displayName:
		'Этот метод принимает период только по дням — время в полях ниже отбрасывается. There is no paging either: Roistat returns the whole period at once, so a long one is a large answer.',
	name: 'proxyLeadPeriodNotice',
	type: 'notice',
	default: '',
	displayOptions: showFor(['getMany']),
};

const proxyLeadId: INodeProperties = {
	displayName: 'Lead ID',
	name: 'proxyLeadId',
	type: 'string',
	default: '',
	required: true,
	displayOptions: showFor(['get']),
	description: 'ID заявки в Roistat, каким его выдаёт операция Get Many',
};

export const description: INodeProperties[] = [
	operation,
	{ ...projectIdProperty, displayOptions: { show: { resource: ['proxyLead'] } } },
	periodNotice,
	...periodProperties('proxyLead', ['getMany']),
	proxyLeadId,
];
