import type { INodeProperties } from 'n8n-workflow';

import {
	filtersProperty,
	periodProperties,
	projectIdProperty,
	returnAllProperties,
	sortProperties,
} from '../../descriptions/common';

const showFor = (operations: string[]): INodeProperties['displayOptions'] => ({
	show: { resource: ['call'], operation: operations },
});

/**
 * Calls — the calltracking half of Roistat.
 *
 * Everything here needs the Коллтрекинг option switched on for the project;
 * without it the methods answer `option_not_available`, which the node reports
 * as such rather than as an empty list.
 *
 * Create is the odd one out: it writes a call that happened somewhere else — a
 * PBX Roistat does not integrate with — into the project's history, so that the
 * call is attributed like any other.
 */
const operation: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	default: 'getMany',
	displayOptions: { show: { resource: ['call'] } },
	options: [
		{
			name: 'Create',
			value: 'create',
			action: 'Create a call record',
			description:
				'Записать звонок в историю проекта — для АТС, которую Roistat не интегрирует сам. The visit number or the channel marker is what gives the call a source.',
		},
		{
			name: 'Get Dashboard',
			value: 'getDashboard',
			action: 'Get the calltracking dashboard',
			description:
				'Сводка по звонкам за период: по часам и дням недели, по каналам, по регионам, стоимость звонка. This is the data the Коллтрекинг dashboard draws, in one object.',
		},
		{
			name: 'Get Many',
			value: 'getMany',
			action: 'Get many calls',
			description:
				'История звонков: номера, длительность, статус, ссылка на запись и визит. Include Visit and Include Deal add the whole visit and deal to each row.',
		},
		{
			name: 'Get Phones',
			value: 'getPhones',
			action: 'Get many calltracking numbers',
			description:
				'Номера, подключённые к проекту. Only the project owner or a user with read/write rights can read them.',
		},
		{
			name: 'Get Recording',
			value: 'getRecording',
			action: 'Download a call recording',
			description:
				'Скачать запись разговора в MP3 и положить её в binary-поле. A call with no recording answers with an empty body rather than an error.',
		},
	],
};

const callId: INodeProperties = {
	displayName: 'Call ID',
	name: 'callId',
	type: 'string',
	default: '',
	required: true,
	displayOptions: showFor(['getRecording']),
	description: 'ID звонка в Roistat, каким его выдаёт операция Get Many',
};

const binaryProperty: INodeProperties = {
	displayName: 'Put Output in Field',
	name: 'binaryProperty',
	type: 'string',
	default: 'data',
	required: true,
	displayOptions: showFor(['getRecording']),
	description: 'Имя binary-поля, в которое положить MP3',
};

const includeVisit: INodeProperties = {
	displayName: 'Include Visit',
	name: 'includeVisit',
	type: 'boolean',
	default: false,
	displayOptions: showFor(['getMany']),
	description: 'Whether to include the whole visit the call came from in each row',
};

const includeOrder: INodeProperties = {
	displayName: 'Include Deal',
	name: 'includeOrder',
	type: 'boolean',
	default: false,
	displayOptions: showFor(['getMany']),
	description: 'Whether to include the deal the call produced in each row',
};

const createFields: INodeProperties[] = [
	{
		displayName: 'Caller',
		name: 'caller',
		type: 'string',
		default: '',
		required: true,
		displayOptions: showFor(['create']),
		description: 'Номер клиента, откуда звонили',
	},
	{
		displayName: 'Callee',
		name: 'callee',
		type: 'string',
		default: '',
		required: true,
		displayOptions: showFor(['create']),
		description: 'Набранный номер — тот, на который позвонили',
	},
	{
		displayName: 'Date',
		name: 'date',
		type: 'dateTime',
		default: '',
		required: true,
		displayOptions: showFor(['create']),
		description: 'Дата и время звонка. Sent as an ISO instant; Roistat reads one without an offset as UTC.',
	},
	{
		displayName: 'Status',
		name: 'status',
		type: 'options',
		default: 'ANSWER',
		displayOptions: showFor(['create']),
		options: [
			{ name: 'Answered', value: 'ANSWER', description: 'Звонок принят и обработан сотрудником' },
			{ name: 'Busy', value: 'BUSY', description: 'Линия была занята' },
			{ name: 'Cancelled', value: 'CANCEL', description: 'Клиент положил трубку до ответа' },
			{ name: 'In Progress', value: 'ACTIVE', description: 'Звонок ещё идёт' },
			{ name: 'No Answer', value: 'NOANSWER', description: 'Никто не ответил за время ожидания' },
			{ name: 'Not Called', value: 'DONTCALL', description: 'Входящий вызов был отменён' },
			{ name: 'Technical Failure', value: 'CONGESTION', description: 'Вызов не состоялся по технической причине' },
			{ name: 'To Answering Machine', value: 'TORTURE', description: 'Вызов ушёл на автоответчик' },
			{ name: 'Unavailable', value: 'CHANUNAVAIL', description: 'Вызываемый номер был недоступен' },
		],
		description: 'Чем закончился звонок. Roistat counts anything but ANSWER as a missed call in its reports.',
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: showFor(['create']),
		description: 'Остальные поля звонка',
		options: [
			{
				displayName: 'Answer Duration',
				name: 'answer_duration',
				type: 'number',
				default: 0,
				description: 'Время разговора в секундах, без ожидания ответа',
			},
			{
				displayName: 'Channel Marker',
				name: 'marker',
				type: 'string',
				default: '',
				description:
					'Маркер рекламного канала, если номер визита неизвестен. One of the two is needed for the call to have a source at all.',
			},
			{
				displayName: 'Comment',
				name: 'comment',
				type: 'string',
				default: '',
				description: 'Комментарий к звонку',
			},
			{
				displayName: 'Deal ID',
				name: 'order_id',
				type: 'string',
				default: '',
				description: 'ID сделки в CRM, к которой относится звонок',
			},
			{
				displayName: 'Duration',
				name: 'duration',
				type: 'number',
				default: 0,
				description: 'Длительность вызова в секундах, включая ожидание ответа',
			},
			{
				displayName: 'Save to CRM',
				name: 'save_to_crm',
				type: 'boolean',
				default: false,
				description: 'Whether Roistat should create a lead in the connected CRM for this call',
			},
			{
				displayName: 'Visit ID',
				name: 'visit_id',
				type: 'string',
				default: '',
				description:
					'Номер визита, к которому привязать звонок. This is what ties the call to the advertising channel that produced it.',
			},
		],
	},
];

export const description: INodeProperties[] = [
	operation,
	{ ...projectIdProperty, displayOptions: { show: { resource: ['call'] } } },
	callId,
	binaryProperty,
	// One pair of period fields for both reads, marked optional in the editor:
	// the call list works without a period and the dashboard does not, and the
	// execute half insists on it there rather than showing two nearly identical
	// pairs of fields whose names would collide.
	...periodProperties('call', ['getMany', 'getDashboard'], false),
	includeVisit,
	includeOrder,
	filtersProperty('call', ['getMany']),
	...sortProperties('call', ['getMany']),
	...returnAllProperties('call', ['getMany', 'getPhones']),
	...createFields,
];
