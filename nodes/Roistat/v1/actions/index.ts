import type { INodeProperties } from 'n8n-workflow';

import type { ResourceModule } from '../../../../utils/router';
import * as analytics from './analytics';
import * as call from './call';
import * as client from './client';
import * as cost from './cost';
import * as event from './event';
import * as lead from './lead';
import * as order from './order';
import * as project from './project';
import * as proxyLead from './proxyLead';
import * as statistic from './statistic';
import * as visit from './visit';

/** Keyed by the `resource` value, which is part of every saved workflow. */
export const resources: Record<string, ResourceModule> = {
	analytics,
	call,
	client,
	cost,
	event,
	lead,
	order,
	project,
	proxyLead,
	statistic,
	visit,
};

/**
 * Kept alphabetical: the linter enforces it, and so does finding things.
 *
 * The split between Deal and Lead is Roistat's, not this node's. A project either
 * has a CRM integrated — its deals are the Deal resource — or uses Управление
 * заявками instead, and those are the Lead resource. Site Lead is a third thing
 * again: the raw form submission Roistat's own widgets record, which exists
 * whether or not it ever became either of the other two.
 */
export const resourceProperty: INodeProperties = {
	displayName: 'Resource',
	name: 'resource',
	type: 'options',
	noDataExpression: true,
	default: 'analytics',
	options: [
		{
			name: 'Advertising Cost',
			value: 'cost',
			description:
				'Расходы по рекламным каналам и справочник самих каналов. The half of ROI that has to be fed by hand when a channel has no integration.',
		},
		{
			name: 'Analytics',
			value: 'analytics',
			description:
				'Отчёты аналитики: любые метрики в разрезе любых группировок, воронка статусов, справочники метрик и измерений',
		},
		{
			name: 'Call',
			value: 'call',
			description:
				'Коллтрекинг: история звонков, запись разговора, сводка по звонкам, подключённые номера',
		},
		{
			name: 'Client',
			value: 'client',
			description: 'Управление клиентами: импорт, список и полная история одного клиента',
		},
		{
			name: 'Deal',
			value: 'order',
			description:
				'Сделки проекта: список, карточка с визитами и товарами, загрузка, смена статуса, справочник статусов',
		},
		{
			name: 'Event',
			value: 'event',
			description: 'События: отправить по визиту, отправить пачкой, завести новое событие в проекте',
		},
		{
			name: 'Lead',
			value: 'lead',
			description:
				'Заявки в «Управлении заявками» — встроенной замене CRM. Not the same thing as a deal from an integrated CRM.',
		},
		{
			name: 'Project',
			value: 'project',
			description: 'Проекты аккаунта, счётчик и права доступа',
		},
		{
			name: 'Site Lead',
			value: 'proxyLead',
			description:
				'Заявки, записанные виджетами Roistat на сайте, вместе с визитом. They survive even when the CRM never received the deal.',
		},
		{
			name: 'Statistic',
			value: 'statistic',
			description:
				'Готовая сводка показателей по дням. Cheapest report in the API and the most tightly limited: 5 requests an hour.',
		},
		{
			name: 'Visit',
			value: 'visit',
			description: 'Визиты с источником, метками и устройством, плюс запись roistat_param1…5',
		},
	],
};

export const resourceProperties: INodeProperties[] = Object.values(resources).flatMap(
	(module) => module.description,
);
