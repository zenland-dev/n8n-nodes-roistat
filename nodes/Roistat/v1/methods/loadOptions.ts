import type { IDataObject, ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import { listFrom, roistatCachedRequest } from '../transport';

/**
 * The dropdown sources.
 *
 * Every one of these is a real request against the project's hourly budget, so
 * they go through `roistatCachedRequest` — the editor re-runs a picker whenever a
 * dependent field changes, and a project has 5000 requests an hour to share with
 * the workflows actually doing work.
 *
 * None of them reads the node's Project ID override: a load-options context can
 * see node parameters, but a picker that changes what it lists depending on a
 * field the user has not filled in yet reads as a bug. They list the credential's
 * project, and the override applies at run time.
 */

/** Sorts by the label people read, not by the system name they do not. */
function byName(options: INodePropertyOptions[]): INodePropertyOptions[] {
	return options.sort((a, b) => a.name.localeCompare(b.name));
}

/** Every metric the project can report on, with its own description attached. */
export async function getMetrics(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const payload = await roistatCachedRequest.call(this, '/project/analytics/metrics-new');

	return byName(
		listFrom(payload, 'metrics').map((metric: IDataObject) => ({
			name: String(metric.title ?? metric.name ?? ''),
			value: String(metric.name ?? ''),
			description: String(metric.info ?? ''),
		})),
	);
}

/** Every grouping the project can report by. */
export async function getDimensions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const payload = await roistatCachedRequest.call(this, '/project/analytics/dimensions');

	return byName(
		listFrom(payload, 'dimensions').map((dimension: IDataObject) => ({
			name: String(dimension.title ?? dimension.name ?? ''),
			value: String(dimension.name ?? ''),
		})),
	);
}

/**
 * The attribution models, system and custom.
 *
 * Only metrics whose `is_has_attribution_model` is true are affected by the
 * choice; the rest are counted the same way whatever is picked, which is why the
 * field that uses this list says so rather than implying it changes everything.
 */
export async function getAttributionModels(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const payload = await roistatCachedRequest.call(this, '/project/analytics/attribution-models');

	return listFrom(payload, 'models').map((model: IDataObject) => ({
		name: String(model.name ?? model.id ?? ''),
		value: String(model.id ?? ''),
		description: model.is_system === true ? 'Built into Roistat' : 'Configured in this project',
	}));
}

/**
 * The advertising channels, top level only.
 *
 * Two things about this endpoint are worth knowing, and neither is in the
 * documentation. It answers with `{source, title, type, level, icon}` rather
 * than the documented `{name, system_name, icon}` — reading the documented names
 * yields a dropdown of empty strings, which is what this used to do. And it
 * returns **every** channel at every nesting level: 18 121 of them on the
 * project this was checked against, 2.3 MB in one answer.
 *
 * So the list is cut to `level === 1`, the channels a cost is normally booked
 * against — 955 of those on the same project, which a dropdown can hold. A
 * deeper channel is still reachable: the field takes an expression, and the
 * Advertising Cost resource's own Get Channels operation returns the whole tree.
 */
export async function getChannels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const payload = await roistatCachedRequest.call(this, '/project/analytics/source/list');

	return byName(
		listFrom(payload, 'data')
			.filter((channel: IDataObject) => Number(channel.level ?? 1) === 1)
			.map((channel: IDataObject) => ({
				name: String(channel.title ?? channel.source ?? ''),
				value: String(channel.source ?? ''),
			}))
			.filter((option) => option.value !== ''),
	);
}

/**
 * Deal statuses as Roistat knows them, which is not the same as the CRM's own.
 *
 * The IDs here are the ones a status update takes. They come from the CRM
 * through the integration, so a project with no CRM connected — one working
 * through Управление заявками instead — gets an empty list, and that is the
 * honest answer rather than a failure.
 */
export async function getOrderStatuses(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const payload = await roistatCachedRequest.call(this, '/project/integration/status/list');

	return listFrom(payload, 'data').map((status: IDataObject) => ({
		name: String(status.name ?? status.id ?? ''),
		value: String(status.id ?? ''),
		description: `Roistat group: ${String(status.type ?? 'unknown')}`,
	}));
}

/** The statuses of Управление заявками, the CRM-less lead board. */
export async function getLeadStatuses(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const payload = await roistatCachedRequest.call(this, '/project/leads/status/list');

	return listFrom(payload, 'data').map((status: IDataObject) => ({
		name: String(status.name ?? status.id ?? ''),
		value: String(status.id ?? ''),
		description: `Roistat group: ${String(status.type ?? 'unknown')}`,
	}));
}

/** The custom metrics a person fills in by hand, for the value setter. */
export async function getCustomMetrics(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	// The one dictionary here that is a GET rather than a POST, and the only one
	// whose payload key is `data` rather than a name of its own.
	const payload = await roistatCachedRequest.call(
		this,
		'/project/analytics/metrics/custom/list',
		undefined,
		{ method: 'GET' },
	);

	return byName(
		listFrom(payload, 'data').map((metric: IDataObject) => ({
			name: String(metric.title ?? metric.id ?? ''),
			value: String(metric.id ?? ''),
		})),
	);
}
