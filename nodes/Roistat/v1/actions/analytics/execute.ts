import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { unknownOperation } from '../../../../../utils/router';
import { jsonParameter, periodFor, projectFor, toItems } from '../../helpers/request';
import { listFrom, roistatApiRequest, roistatCachedRequest } from '../../transport';

/** The dictionary reads, which differ in nothing but their path and payload key. */
const DICTIONARIES: Record<string, { endpoint: string; key: string }> = {
	getMetrics: { endpoint: '/project/analytics/metrics-new', key: 'metrics' },
	getDimensions: { endpoint: '/project/analytics/dimensions', key: 'dimensions' },
	getAttributionModels: { endpoint: '/project/analytics/attribution-models', key: 'models' },
};

/**
 * Which metrics an attribution model actually applies to.
 *
 * Roistat marks each metric in its dictionary with `is_has_attribution_model`,
 * and sending `{metric, attribution}` for one that is not marked is asking the
 * API to count visits by first click — a thing it has no notion of. So the
 * dictionary is read (from the same short-lived memo the dropdowns use) and the
 * model is attached only where it means something. The alternative — attaching it
 * everywhere — was tempting and is exactly how a report comes back rejected with
 * a validation error naming a metric the user never thought about.
 */
async function metricsWithAttribution(
	this: IExecuteFunctions,
	names: string[],
	model: string,
	project: string,
): Promise<Array<string | IDataObject>> {
	if (model === '') return names;

	const payload = await roistatCachedRequest.call(this, '/project/analytics/metrics-new', undefined, {
		project,
	});

	const attributable = new Set(
		listFrom(payload, 'metrics')
			.filter((metric) => metric.is_has_attribution_model === true)
			.map((metric) => String(metric.name ?? '')),
	);

	return names.map((name) =>
		attributable.has(name) ? { metric: name, attribution: model } : name,
	);
}

/**
 * Flattens one report row into plain values.
 *
 * A row arrives as two objects of objects: every dimension is
 * `{value, title, icon}` and every metric is `{value, formatted, metric_name,
 * attribution_model_id}`. That is faithful and unusable — an IF node comparing
 * `roi > 0` has to reach through two levels to find a number that is sometimes a
 * string. So the readable value goes on top, and both originals are kept under
 * `_dimensions` and `_metrics` for whoever needs the formatted text or the icon.
 */
function flattenRow(row: IDataObject): IDataObject {
	const output: IDataObject = {};

	const dimensions = (row.dimensions ?? {}) as IDataObject;
	if (!Array.isArray(dimensions)) {
		for (const [name, value] of Object.entries(dimensions)) {
			const entry = (value ?? {}) as IDataObject;
			// `title` is what the interface shows and `value` the system name. An
			// empty title is a real answer — "Direct visits" is stored as `''` — so
			// the fallback has to be `||`, not `??`.
			output[name] = String(entry.title || entry.value || '');
		}
	}

	// Metrics arrive in one of two shapes, and only one of them is documented.
	//
	// The documentation shows an object keyed by metric name. A live project sends
	// an **array** of `{value, formatted, metric_name, attribution_model_id}`
	// instead (checked 11.09.2026), and reading that as an object produced a row
	// keyed `0, 1, 2, 3` — numbers with no idea what they counted. So the array
	// form is read by `metric_name`, and the object form still works.
	const metrics = row.metrics;
	const entries: Array<[string, IDataObject]> = Array.isArray(metrics)
		? (metrics as IDataObject[]).map((entry, index) => [
				String(entry?.metric_name ?? index),
				(entry ?? {}) as IDataObject,
			])
		: Object.entries((metrics ?? {}) as IDataObject).map(([name, value]) => [
				name,
				(value ?? {}) as IDataObject,
			]);

	for (const [name, entry] of entries) {
		// One metric can appear twice under different attribution models, and the
		// second would otherwise overwrite the first. The model is part of the key
		// whenever it is not the project's default.
		const model = String(entry.attribution_model_id ?? '');
		const key = model === '' || model === 'default' ? name : `${name}_${model}`;

		const raw = entry.value;
		const numeric = Number(raw);
		// Counts arrive as strings and rates as numbers, in the same answer. Anything
		// that reads as a number becomes one; anything else is left alone.
		output[key] = Number.isFinite(numeric) && raw !== '' && raw !== null ? numeric : raw;
	}

	output._dimensions = dimensions;
	output._metrics = metrics;
	if (row.isHasChild !== undefined) output.hasChildren = Number(row.isHasChild) === 1;

	return output;
}

/** `POST /project/analytics/data` — the report itself. */
async function getReport(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const project = projectFor.call(this, itemIndex);
	const dimensions = this.getNodeParameter('dimensions', itemIndex, []) as string[];
	const metricNames = this.getNodeParameter('metrics', itemIndex, []) as string[];
	const model = String(this.getNodeParameter('attributionModel', itemIndex, '') ?? '');
	const interval = String(this.getNodeParameter('interval', itemIndex, '') ?? '').trim();
	const nextDimensions = this.getNodeParameter('nextDimensions', itemIndex, []) as string[];
	const simplify = this.getNodeParameter('simplify', itemIndex, true) as boolean;
	const filters = jsonParameter.call(this, 'filtersJson', 'Filters', itemIndex);

	const body: IDataObject = {
		dimensions,
		metrics: await metricsWithAttribution.call(this, metricNames, model, project),
		period: periodFor.call(this, itemIndex),
	};

	if (filters !== undefined) body.filters = filters;
	if (interval !== '') body.interval = interval;
	if (nextDimensions.length > 0) body.next_dimensions = nextDimensions;

	const payload = await roistatApiRequest.call(
		this,
		'POST',
		'/project/analytics/data',
		body,
		undefined,
		{ project, readOnly: true },
	);

	const intervals = listFrom(payload, 'data');
	const output: INodeExecutionData[] = [];

	for (const slice of intervals) {
		// Roistat answers with one object per interval, each carrying its own rows
		// and its own totals row. Both are emitted, tagged with the interval they
		// belong to, so a report split by week still says which week each row is.
		const period = { from: slice.dateFrom ?? null, to: slice.dateTo ?? null };

		for (const row of (slice.items ?? []) as IDataObject[]) {
			const json = simplify ? flattenRow(row) : { ...row };
			output.push({ json: { ...json, _period: period, _row: 'item' } });
		}

		const mean = slice.mean as IDataObject | undefined;
		if (mean !== undefined && mean !== null) {
			const json = simplify ? flattenRow(mean) : { ...mean };
			output.push({ json: { ...json, _period: period, _row: 'total' } });
		}
	}

	return output;
}

/** `POST /project/reports/funnel/data` — the statuses funnel. */
async function getFunnel(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const project = projectFor.call(this, itemIndex);
	const dimensions = this.getNodeParameter('dimensions', itemIndex, []) as string[];
	const funnel = jsonParameter.call(this, 'funnelJson', 'Funnel Steps', itemIndex);
	const filters = jsonParameter.call(this, 'funnelFiltersJson', 'Filters', itemIndex);

	const body: IDataObject = {
		period: periodFor.call(this, itemIndex),
		funnel: funnel ?? [],
		// Documented as optional, refused when absent: a live project answers
		// `400 incorrect_request — Required argument next_dimensions is missing`
		// (checked 11.09.2026). An empty list satisfies it, and the node sends the
		// user's next dimensions here when they picked any.
		next_dimensions: this.getNodeParameter('nextDimensions', itemIndex, []) as string[],
	};

	if (dimensions.length > 0) body.dimensions = dimensions;
	if (filters !== undefined) body.filters = filters;

	const payload = await roistatApiRequest.call(
		this,
		'POST',
		'/project/reports/funnel/data',
		body,
		undefined,
		{ project, readOnly: true },
	);

	// Unlike the analytics report, `data` here is one object rather than a list of
	// intervals, and the rows sit under `items` inside it.
	const data = (payload as IDataObject)?.data as IDataObject | undefined;
	const rows = (data?.items ?? []) as IDataObject[];

	if (rows.length === 0) return toItems(data ?? {}, {}).map((row) => ({ json: row }));

	return rows.map((row) => ({
		json: { ...row, _period: { from: data?.date_from ?? null, to: data?.date_to ?? null } },
	}));
}

/** `POST /project/analytics/dimension-values` — what one grouping can contain. */
async function getDimensionValues(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const project = projectFor.call(this, itemIndex);
	const dimension = String(this.getNodeParameter('dimension', itemIndex, '') ?? '');

	const payload = await roistatApiRequest.call(
		this,
		'POST',
		'/project/analytics/dimension-values',
		undefined,
		{ dimension },
		{ project, readOnly: true },
	);

	return listFrom(payload, 'values').map((row) => ({ json: row }));
}

/** `POST /project/analytics/metrics/custom/manual/value/add`. */
async function setCustomMetricValue(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const project = projectFor.call(this, itemIndex);
	const metricId = String(this.getNodeParameter('customMetricId', itemIndex, '') ?? '');
	const source = String(this.getNodeParameter('source', itemIndex, '') ?? '');
	const value = this.getNodeParameter('value', itemIndex, 0) as number;

	const body: IDataObject = {
		manual_custom_metric_id: Number(metricId),
		value,
		period: periodFor.call(this, itemIndex),
	};

	if (source !== '') body.source = source;

	const payload = await roistatApiRequest.call(
		this,
		'POST',
		'/project/analytics/metrics/custom/manual/value/add',
		body,
		undefined,
		{ project },
	);

	// This endpoint documents no response body at all, so the item is built from
	// what was sent rather than from what came back.
	return toItems(payload, { manual_custom_metric_id: metricId, value, success: true }).map(
		(row) => ({ json: row }),
	);
}

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	if (operation === 'getReport') return await getReport.call(this, itemIndex);
	if (operation === 'getFunnel') return await getFunnel.call(this, itemIndex);
	if (operation === 'getDimensionValues') return await getDimensionValues.call(this, itemIndex);
	if (operation === 'setCustomMetricValue') {
		return await setCustomMetricValue.call(this, itemIndex);
	}

	const dictionary = DICTIONARIES[operation];
	if (dictionary !== undefined) {
		const payload = await roistatApiRequest.call(
			this,
			'POST',
			dictionary.endpoint,
			undefined,
			undefined,
			{ project: projectFor.call(this, itemIndex), readOnly: true },
		);

		return listFrom(payload, dictionary.key).map((row) => ({ json: row }));
	}

	throw unknownOperation.call(this, 'Analytics', operation, itemIndex);
}
