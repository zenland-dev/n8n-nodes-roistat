import type { INodeProperties } from 'n8n-workflow';

import {
	filtersProperty,
	periodProperties,
	projectIdProperty,
	returnAllProperties,
	sortProperties,
} from '../../descriptions/common';

const showFor = (operations: string[]): INodeProperties['displayOptions'] => ({
	show: { resource: ['visit'], operation: operations },
});

/**
 * The visit — the atom everything else in Roistat is attributed through.
 *
 * A visit number lives in the `roistat_visit` cookie, travels into the CRM on a
 * form field, and comes back here to say which advertising channel a deal was
 * worth. The five `roistat_param` slots are the one part of it a workflow can
 * change afterwards, which is what Update Params is for.
 */
const operation: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	default: 'getMany',
	displayOptions: { show: { resource: ['visit'] } },
	options: [
		{
			name: 'Get Many',
			value: 'getMany',
			action: 'Get many visits',
			description:
				'Визиты с источником, UTM-метками, устройством, гео и списком сделок. A single answer holds at most 10 000 visits, so a busy site needs the period narrowed rather than the limit raised.',
		},
		{
			name: 'Update Params',
			value: 'updateParams',
			action: 'Update the roistat params of a visit',
			description:
				'Изменить значения roistat_param1…5 у визита. These five slots are yours to use for anything — a segment, a landing variant, a partner ID — and reports can group by them.',
		},
	],
};

const filterNotice: INodeProperties = {
	displayName:
		'По вложенным полям фильтруют через точку: ["source.system_name", "like", "yandex"]. Roistat refuses to filter by google_client_id, device, order_ids, geo and cost, whatever is written here.',
	name: 'visitFilterNotice',
	type: 'notice',
	default: '',
	displayOptions: showFor(['getMany']),
};

const visitId: INodeProperties = {
	displayName: 'Visit ID',
	name: 'visitId',
	type: 'string',
	default: '',
	required: true,
	displayOptions: showFor(['updateParams']),
	description: 'Номер визита — значение куки roistat_visit, оно же поле ID в списке визитов',
};

const params: INodeProperties = {
	displayName: 'Params',
	name: 'params',
	type: 'collection',
	placeholder: 'Add Param',
	default: {},
	displayOptions: showFor(['updateParams']),
	description: 'Значения roistat_param1…5. Only the ones filled in here are sent.',
	options: [
		{ displayName: 'Param 1', name: 'roistat_param1', type: 'string', default: '', description: 'Значение roistat_param1' },
		{ displayName: 'Param 2', name: 'roistat_param2', type: 'string', default: '', description: 'Значение roistat_param2' },
		{ displayName: 'Param 3', name: 'roistat_param3', type: 'string', default: '', description: 'Значение roistat_param3' },
		{ displayName: 'Param 4', name: 'roistat_param4', type: 'string', default: '', description: 'Значение roistat_param4' },
		{ displayName: 'Param 5', name: 'roistat_param5', type: 'string', default: '', description: 'Значение roistat_param5' },
	],
};

export const description: INodeProperties[] = [
	operation,
	{ ...projectIdProperty, displayOptions: { show: { resource: ['visit'] } } },
	...periodProperties('visit', ['getMany'], false),
	filterNotice,
	filtersProperty('visit', ['getMany']),
	...sortProperties('visit', ['getMany']),
	...returnAllProperties('visit', ['getMany']),
	visitId,
	params,
];
