import type { INodeProperties } from 'n8n-workflow';

import { projectIdProperty } from '../../descriptions/common';

const showFor = (operations: string[]): INodeProperties['displayOptions'] => ({
	show: { resource: ['event'], operation: operations },
});

/**
 * Events — anything worth counting that is not a deal.
 *
 * A chat opened, a price list downloaded, a phone number revealed. Roistat
 * counts them per visit and per channel, which is what makes them useful: a
 * channel that produces no deals but plenty of downloads is a different problem
 * from one that produces nothing.
 *
 * An event has to exist before it can be sent — Create registers the name, Send
 * records an occurrence of it against a visit.
 */
const operation: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	default: 'send',
	displayOptions: { show: { resource: ['event'] } },
	options: [
		{
			name: 'Create',
			value: 'create',
			action: 'Create an event',
			description:
				'Зарегистрировать событие в проекте — задать его имя и условие срабатывания. Sending an event that was never created does nothing.',
		},
		{
			name: 'Send',
			value: 'send',
			action: 'Send an event',
			description:
				'Отправить одно событие по визиту. The visit number is what attributes it to a channel.',
		},
		{
			name: 'Send Many',
			value: 'sendMany',
			action: 'Send many events',
			description:
				'Отправить пачку событий одним запросом. Worth using over a loop of Send: a hundred events cost one request against the project budget instead of a hundred.',
		},
	],
};

const eventName: INodeProperties = {
	displayName: 'Event Name',
	name: 'eventName',
	type: 'string',
	default: '',
	required: true,
	displayOptions: showFor(['send']),
	description:
		'Имя события, как оно заведено в Roistat. An unknown name is accepted by the API and counted nowhere, so it has to match exactly.',
};

const visitId: INodeProperties = {
	displayName: 'Visit ID',
	name: 'visitId',
	type: 'string',
	default: '',
	displayOptions: showFor(['send']),
	description:
		'Номер визита из куки roistat_visit. Without it the event is recorded with no source and cannot be attributed to a channel.',
};

const eventData: INodeProperties = {
	displayName: 'Additional Data',
	name: 'eventData',
	type: 'fixedCollection',
	typeOptions: { multipleValues: true },
	default: {},
	placeholder: 'Add Field',
	displayOptions: showFor(['send']),
	description: 'Дополнительные поля события — they show up in the Events history under «Доп. поля».',
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
};

const eventsJson: INodeProperties = {
	displayName: 'Events (JSON)',
	name: 'eventsJson',
	type: 'json',
	default: '[{"name": "Click on a form", "visit": "100001", "data": {"region": "London"}}]',
	typeOptions: { rows: 5 },
	required: true,
	displayOptions: showFor(['sendMany']),
	description:
		'Массив событий: у каждого name, visit и необязательный объект data. The names have to be ones already registered in the project.',
};

const createFields: INodeProperties[] = [
	{
		displayName: 'Display Name',
		name: 'displayName',
		type: 'string',
		default: '',
		required: true,
		displayOptions: showFor(['create']),
		description: 'Название события, под которым оно будет видно в отчётах',
	},
	{
		displayName: 'Trigger Type',
		name: 'eventType',
		type: 'options',
		default: 'js',
		displayOptions: showFor(['create']),
		options: [
			{
				name: 'JavaScript',
				value: 'js',
				description: 'Событие вызывается из кода страницы по своему идентификатору',
			},
			{ name: 'URL', value: 'url', description: 'Событие засчитывается при посещении адреса' },
		],
		description: 'Как событие срабатывает',
	},
	{
		displayName: 'Parameter',
		name: 'parameter',
		type: 'string',
		default: '',
		required: true,
		displayOptions: showFor(['create']),
		description:
			'Идентификатор события для типа JavaScript или адрес страницы для типа URL — например js-12 или http://example.com/thanks',
	},
];

export const description: INodeProperties[] = [
	operation,
	{ ...projectIdProperty, displayOptions: { show: { resource: ['event'] } } },
	eventName,
	visitId,
	eventData,
	eventsJson,
	...createFields,
];
