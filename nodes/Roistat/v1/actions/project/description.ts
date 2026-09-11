import type { INodeProperties } from 'n8n-workflow';

import { projectIdProperty } from '../../descriptions/common';

const showFor = (operations: string[]): INodeProperties['displayOptions'] => ({
	show: { resource: ['project'], operation: operations },
});

/**
 * The project itself, and who may see it.
 *
 * Two of these are account-wide rather than project-wide: listing the projects a
 * key can reach, and creating a new one. They are the only calls in the API that
 * work with no project number at all, which makes Get Many the right first call
 * when setting a credential up — it answers with the numbers the other fields
 * ask for.
 */
const operation: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	default: 'getMany',
	displayOptions: { show: { resource: ['project'] } },
	options: [
		{
			name: 'Create',
			value: 'create',
			action: 'Create a project',
			description:
				'Создать новый проект в аккаунте и получить его счётчик. This is a billable object in Roistat, not a scratch space — a project created here is one the account owns.',
		},
		{
			name: 'Get Access',
			value: 'getAccess',
			action: 'Get many authorized users',
			description: 'Кто имеет доступ к проекту и с какими правами: владелец, чтение, чтение и запись. On the project this node was checked against, both GET and POST answered 404 resource_not_found — the method may be limited to the account owner.',
		},
		{
			name: 'Get Counter',
			value: 'getCounter',
			action: 'Get the tracking code of a project',
			description:
				'Счётчик проекта: его ID и готовый JS-код для установки на сайт. Without the counter on the site there are no visits, and therefore no attribution. On the project this node was checked against, this method answered 404 resource_not_found for both POST and GET.',
		},
		{
			name: 'Get Many',
			value: 'getMany',
			action: 'Get many projects',
			description:
				'Проекты, доступные ключу, с валютой и признаком владельца. The only call that needs no project number — use it to find the number for the credential.',
		},
		{
			name: 'Set Access',
			value: 'setAccess',
			action: 'Set the access of a user',
			description:
				'Выдать или отобрать доступ к проекту по email. Access none removes the user from the project.',
		},
	],
};

const projectName: INodeProperties = {
	displayName: 'Name',
	name: 'name',
	type: 'string',
	default: '',
	required: true,
	displayOptions: showFor(['create']),
	description: 'Название нового проекта',
};

const currency: INodeProperties = {
	displayName: 'Currency',
	name: 'currency',
	type: 'options',
	default: 'RUB',
	required: true,
	displayOptions: showFor(['create']),
	options: [
		{ name: 'AED — UAE Dirham', value: 'AED' },
		{ name: 'BYN — Belarusian Ruble', value: 'BYN' },
		{ name: 'CHF — Swiss Franc', value: 'CHF' },
		{ name: 'CZK — Czech Koruna', value: 'CZK' },
		{ name: 'EUR — Euro', value: 'EUR' },
		{ name: 'GBP — British Pound', value: 'GBP' },
		{ name: 'KZT — Kazakhstani Tenge', value: 'KZT' },
		{ name: 'RUB — Russian Ruble', value: 'RUB' },
		{ name: 'UAH — Ukrainian Hryvnia', value: 'UAH' },
		{ name: 'USD — US Dollar', value: 'USD' },
	],
	description:
		'Валюта проекта. It decides how every amount in the project is read, and Roistat does not offer a way to change it afterwards — so pick the one the CRM sends.',
};

const email: INodeProperties = {
	displayName: 'Email',
	name: 'email',
	type: 'string',
	placeholder: 'name@email.com',
	default: '',
	required: true,
	displayOptions: showFor(['setAccess']),
	description: 'Email пользователя Roistat, которому меняем доступ',
};

const access: INodeProperties = {
	displayName: 'Access',
	name: 'access',
	type: 'options',
	default: 'read',
	required: true,
	displayOptions: showFor(['setAccess']),
	options: [
		{ name: 'Read', value: 'read', description: 'Только чтение' },
		{ name: 'Read and Write', value: 'write', description: 'Чтение и изменение' },
		{ name: 'None', value: 'none', description: 'Убрать доступ к проекту' },
	],
	description: 'Новые права пользователя на проект',
};

export const description: INodeProperties[] = [
	operation,
	{
		...projectIdProperty,
		displayOptions: { show: { resource: ['project'], operation: ['getCounter', 'getAccess', 'setAccess'] } },
	},
	projectName,
	currency,
	email,
	access,
];
