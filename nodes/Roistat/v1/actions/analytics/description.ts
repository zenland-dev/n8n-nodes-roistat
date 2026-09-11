import type { INodeProperties } from 'n8n-workflow';

import { filtersProperty, periodProperties, projectIdProperty } from '../../descriptions/common';

const showFor = (operations: string[]): INodeProperties['displayOptions'] => ({
	show: { resource: ['analytics'], operation: operations },
});

/**
 * The analytics report — the reason most people reach for the Roistat API.
 *
 * One endpoint answers every report the interface can draw: pick the groupings
 * (dimensions), pick the numbers (metrics), give it a period. The vocabulary is
 * per project — a project with no calltracking has no call metrics — so both
 * lists are read from the project rather than hard-coded, and the dictionary
 * operations below expose the same lists for a workflow that builds a request
 * dynamically.
 */
const operation: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	default: 'getReport',
	displayOptions: { show: { resource: ['analytics'] } },
	options: [
		{
			name: 'Get Attribution Models',
			value: 'getAttributionModels',
			action: 'Get many attribution models',
			description:
				'Список моделей атрибуции проекта: стандартная, первый клик, последний клик, U-образная и пользовательские. These are the values the Attribution Model field of a report takes.',
		},
		{
			name: 'Get Dimension Values',
			value: 'getDimensionValues',
			action: 'Get many values of one dimension',
			description:
				'Значения одной группировки — например все рекламные каналы первого уровня. Use it to build a filter without guessing how a channel is spelled internally.',
		},
		{
			name: 'Get Dimensions',
			value: 'getDimensions',
			action: 'Get many dimensions',
			description:
				'Справочник группировок проекта: канал, кампания, устройство, регион, день недели и остальные. A dimension is what a report is grouped by.',
		},
		{
			name: 'Get Funnel Report',
			value: 'getFunnel',
			action: 'Get the statuses funnel report',
			description:
				'Отчёт «Воронка статусов»: сколько сделок дошло до каждой ступени, во что обошлась ступень и сколько в ней держатся. The steps are yours to define — each one groups CRM statuses.',
		},
		{
			name: 'Get Metrics',
			value: 'getMetrics',
			action: 'Get many metrics',
			description:
				'Справочник метрик проекта с описаниями и формулами. Each entry says whether the metric can be recounted under a different attribution model.',
		},
		{
			name: 'Get Report',
			value: 'getReport',
			action: 'Get an analytics report',
			description:
				'Основной отчёт аналитики: любые метрики в разрезе любых группировок за период. This is the same data the Аналитика screen draws.',
		},
		{
			name: 'Set Custom Metric Value',
			value: 'setCustomMetricValue',
			action: 'Set a custom metric value',
			description:
				'Записать значение ручной пользовательской метрики за период по каналу. Only metrics created as «ручные» in Roistat accept a value here.',
		},
	],
};

const reportNotice: INodeProperties = {
	displayName:
		'Отчёт возвращается по одной строке на группировку, а метрика в строке — объект {value, formatted}. Simplify Output turns each row into a flat object of plain numbers, which is what a downstream Set or Filter node expects.',
	name: 'analyticsReportNotice',
	type: 'notice',
	default: '',
	displayOptions: showFor(['getReport']),
};

const dimensions: INodeProperties = {
	displayName: 'Dimension Names or IDs',
	name: 'dimensions',
	type: 'multiOptions',
	typeOptions: { loadOptionsMethod: 'getDimensions' },
	default: ['marker_level_1'],
	required: true,
	displayOptions: showFor(['getReport']),
	description: 'Группировки отчёта — то, что в интерфейсе стоит в левой колонке. Several dimensions nest: marker_level_1 with marker_level_2 gives channel and campaign underneath it. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
};

const metrics: INodeProperties = {
	displayName: 'Metric Names or IDs',
	name: 'metrics',
	type: 'multiOptions',
	typeOptions: { loadOptionsMethod: 'getMetrics' },
	default: ['visits', 'leads', 'sales', 'marketing_cost', 'roi'],
	required: true,
	displayOptions: showFor(['getReport']),
	description: 'Числа отчёта: визиты, заявки, продажи, расходы, ROI и остальные метрики проекта. The list comes from the project, so a project without calltracking has no call metrics in it. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
};

const attributionModel: INodeProperties = {
	displayName: 'Attribution Model Name or ID',
	name: 'attributionModel',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getAttributionModels' },
	default: '',
	displayOptions: showFor(['getReport']),
	description: 'Модель атрибуции, по которой считать метрики. It only changes metrics whose dictionary entry has is_has_attribution_model set — visits and costs are counted the same way whatever is picked here. Leave empty for the project default, which counts a deal against the period it was created in. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
};

const interval: INodeProperties = {
	displayName: 'Interval',
	name: 'interval',
	type: 'string',
	default: '',
	placeholder: '1w',
	displayOptions: showFor(['getReport']),
	description:
		'Разбить период на интервалы: 1d — по дням, 1w — по неделям, 1m — по месяцам, 2w3d — по 17 дней. Leave empty for one row per grouping over the whole period. Each interval comes back as its own object in the result.',
};

const nextDimensions: INodeProperties = {
	displayName: 'Next Dimension Names or IDs',
	name: 'nextDimensions',
	type: 'multiOptions',
	typeOptions: { loadOptionsMethod: 'getDimensions' },
	default: [],
	displayOptions: showFor(['getReport', 'getFunnel']),
	description: 'Группировки следующего уровня — то, что раскроется под строкой. Roistat uses this to decide the isHasChild flag on each row; it does not add columns to the answer. The funnel report refuses a request without this field, so the node always sends it there — empty if nothing is picked. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
};

const simplify: INodeProperties = {
	displayName: 'Simplify Output',
	name: 'simplify',
	type: 'boolean',
	default: true,
	displayOptions: showFor(['getReport']),
	description:
		'Whether to flatten each row into plain values. On, a row becomes {marker_level_1: "Yandex.Direct", visits: 7556, roi: 27} plus the raw объекты under _dimensions and _metrics. Off, the row arrives exactly as Roistat sent it, with every metric wrapped in {value, formatted, metric_name, attribution_model_id}.',
};

const dimension: INodeProperties = {
	displayName: 'Dimension Name or ID',
	name: 'dimension',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getDimensions' },
	default: 'marker_level_1',
	required: true,
	displayOptions: showFor(['getDimensionValues']),
	description: 'Группировка, значения которой нужно получить. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
};

const funnelSteps: INodeProperties = {
	displayName: 'Funnel Steps (JSON)',
	name: 'funnelJson',
	type: 'json',
	default:
		'[{"title": "In progress", "statuses": ["0"], "order": "1"}, {"title": "Paid", "statuses": ["1"], "order": "2"}]',
	typeOptions: { rows: 5 },
	required: true,
	displayOptions: showFor(['getFunnel']),
	description:
		'Ступени воронки: массив объектов с title, statuses и order. Each step groups one or more Roistat status IDs — the ones the Order resource lists with Get Statuses. Steps are yours to define because a funnel is a question about your sales process, not a property of the project.',
};

const funnelDimensions: INodeProperties = {
	displayName: 'Dimension Names or IDs',
	name: 'dimensions',
	type: 'multiOptions',
	typeOptions: { loadOptionsMethod: 'getDimensions' },
	default: ['marker_level_1'],
	displayOptions: showFor(['getFunnel']),
	description: 'Группировки, в разрезе которых считать воронку. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
};

/**
 * The funnel's own filter field, and why it is not the shared one.
 *
 * Both endpoints take a list of filters and both call the parts field, value and
 * an operator — but the report spells that key `operation` and the funnel spells
 * it `operator`. One field for the two would be a field whose documented example
 * is wrong half the time, so they stay separate.
 */
const funnelFilters: INodeProperties = {
	displayName: 'Filters (JSON)',
	name: 'funnelFiltersJson',
	type: 'json',
	default: '',
	typeOptions: { rows: 4 },
	displayOptions: showFor(['getFunnel']),
	placeholder: '[{"field": "marker_level_1", "operator": "=", "value": "google1"}]',
	description:
		'Фильтры воронки: массив объектов с field, operator и value. Note the key is operator here, while the analytics report calls the same thing operation — that is Roistat\'s inconsistency, not a typo.',
};

const customMetricId: INodeProperties = {
	displayName: 'Custom Metric Name or ID',
	name: 'customMetricId',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getCustomMetrics' },
	default: '',
	required: true,
	displayOptions: showFor(['setCustomMetricValue']),
	description: 'Пользовательская метрика, значение которой записываем. Only the manual kind can be written; a metric computed from a formula is read-only. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
};

const customMetricSource: INodeProperties = {
	displayName: 'Channel Name or ID',
	name: 'source',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getChannels' },
	default: '',
	displayOptions: showFor(['setCustomMetricValue']),
	description: 'Рекламный канал, к которому относится значение. Leave empty to write the value against the project as a whole. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
};

const customMetricValue: INodeProperties = {
	displayName: 'Value',
	name: 'value',
	type: 'number',
	default: 0,
	required: true,
	displayOptions: showFor(['setCustomMetricValue']),
	description: 'Значение метрики за период',
};

export const description: INodeProperties[] = [
	operation,
	{ ...projectIdProperty, displayOptions: { show: { resource: ['analytics'] } } },
	reportNotice,
	dimensions,
	metrics,
	...periodProperties('analytics', ['getReport', 'getFunnel', 'setCustomMetricValue']),
	attributionModel,
	interval,
	nextDimensions,
	filtersProperty('analytics', ['getReport']),
	simplify,
	dimension,
	funnelSteps,
	funnelDimensions,
	funnelFilters,
	customMetricId,
	customMetricSource,
	customMetricValue,
];
