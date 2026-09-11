import type { INodeProperties } from 'n8n-workflow';

/**
 * The project override, offered on every resource.
 *
 * A Roistat API key belongs to a profile and opens every project that profile
 * can see, so the project is a per-request choice rather than a property of the
 * credential. The credential still carries a default, because almost every
 * workflow works on one project; this field is for the ones that fan out over
 * several, and for an agency that keeps one credential and many clients.
 */
export const projectIdProperty: INodeProperties = {
	displayName: 'Project ID',
	name: 'projectId',
	type: 'string',
	default: '',
	placeholder: '12345',
	description:
		'Номер проекта для этого элемента. Leave empty to use the project on the credential. It is the digits in the project URL — 12345 in cloud.roistat.com/project/12345.',
};

/** Return All and its companion Limit, for the endpoints that page. */
export const returnAllProperties = (
	resource: string,
	operations: string[],
): INodeProperties[] => [
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: { show: { resource: [resource], operation: operations } },
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		displayOptions: { show: { resource: [resource], operation: operations, returnAll: [false] } },
		description: 'Max number of results to return',
	},
];

/**
 * The period fields.
 *
 * Roistat wants ISO instants with an offset (`2016-07-01T00:00:00+0300`) and
 * reads a value with no offset as UTC. n8n hands date pickers over as ISO
 * instants already, so nothing needs converting — but a value typed by hand does,
 * which is why the description says what the field is turned into.
 */
export const periodProperties = (
	resource: string,
	operations: string[],
	required = true,
): INodeProperties[] => [
	{
		displayName: 'Start',
		name: 'periodFrom',
		type: 'dateTime',
		default: '',
		required,
		displayOptions: { show: { resource: [resource], operation: operations } },
		description:
			'Начало периода. Sent as an ISO instant with its offset. A value written without one — 2026-07-01 00:00:00 — is read by Roistat as UTC, not as your own timezone.',
	},
	{
		displayName: 'End',
		name: 'periodTo',
		type: 'dateTime',
		default: '',
		required,
		displayOptions: { show: { resource: [resource], operation: operations } },
		description:
			'Конец периода, включительно. To cover a whole day, end it at 23:59:59 rather than at midnight of the next one.',
	},
];

/**
 * The escape hatch for Roistat's own filter syntax.
 *
 * The platform's filters are a small language — a triple, or an `and`/`or` tree
 * of triples — and reproducing it as n8n fields would be a worse version of it.
 * The fields that matter in practice (a period, a status) are offered directly
 * on each operation; this takes anything the API accepts, for the rest.
 */
export const filtersProperty = (resource: string, operations: string[]): INodeProperties => ({
	displayName: 'Filters (JSON)',
	name: 'filtersJson',
	type: 'json',
	default: '',
	typeOptions: { rows: 4 },
	displayOptions: { show: { resource: [resource], operation: operations } },
	placeholder: '[["status", "in", ["ANSWER", "CANCEL"]]]',
	description: 'Фильтры в формате Roistat: массив троек [поле, оператор, значение], либо объект {"and": [...]} / {"or": [...]}. Operators are &lt;, &lt;=, =, !=, &gt;, &gt;=, in, null and like. Anything set here is merged with the fields above rather than replacing them.',
});

/** Sorting, in the shape Roistat's list methods take. */
export const sortProperties = (resource: string, operations: string[]): INodeProperties[] => [
	{
		displayName: 'Sort Field',
		name: 'sortField',
		type: 'string',
		default: '',
		displayOptions: { show: { resource: [resource], operation: operations } },
		placeholder: 'creation_date',
		description: 'Поле, по которому сортировать. Leave empty to take the order Roistat gives.',
	},
	{
		displayName: 'Sort Order',
		name: 'sortOrder',
		type: 'options',
		default: 'desc',
		options: [
			{ name: 'Ascending', value: 'asc' },
			{ name: 'Descending', value: 'desc' },
		],
		displayOptions: {
			show: { resource: [resource], operation: operations },
			hide: { sortField: [''] },
		},
		description: 'Порядок сортировки',
	},
];
