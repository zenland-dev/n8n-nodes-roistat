import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { routeItems } from '../../utils/router';
import { resourceProperties, resourceProperty, resources } from './v1/actions';
import { loadOptions } from './v1/methods';

export class Roistat implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Roistat',
		name: 'roistat',
		icon: {
			light: 'file:../../icons/roistat.svg',
			dark: 'file:../../icons/roistat.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description:
			'Read analytics reports and work with deals, clients, calls, visits and advertising costs in a Roistat project',
		defaults: { name: 'Roistat' },
		usableAsTool: true,
		// Read by n8n's node catalog (@n8n/ai-utilities): searchHint is printed
		// verbatim to a model choosing a node, and it is the only place to say what
		// no single operation description can.
		builderHint: {
			searchHint:
				"Roistat is end-to-end marketing analytics: it ties a website visit to the advertising channel that produced it, follows that visit into a CRM deal, and reports what each channel earned. This node reads and writes a Roistat PROJECT — every call names one, and the API key belongs to a profile that may see several, so the project number sits on the credential and every operation can override it. The centre of the node is the Analytics resource: pick dimensions (what to group by) and metrics (what to count) from the project's own dictionaries and get the report the Аналитика screen draws. Deals and Leads are NOT the same thing here — a project integrated with a CRM has deals under the Deal resource, while a project using Roistat's built-in Управление заявками has leads under the Lead resource, and Site Lead is a third thing again: the raw form submission Roistat's own widget recorded, which exists even when the CRM never got it. Writing is mostly one-way feeding: upload deals and clients from a CRM, book advertising spend a channel has no integration for, send events, record a call from a PBX Roistat does not know. The visit number, the roistat cookie value, is what gives any of it a source — a deal or call uploaded without one is attributed to Прямые заходы and the report is quietly wrong. Rate limits matter more than in most APIs: 10 requests a second and 5000 an hour per project shared with every other integration, the deal list allows 20 a minute and as few as 1 when visits are included, and the daily Statistics report allows 5 an hour. This node paces itself against all of those and refuses rather than queues when a tight budget is spent.",
			relatedNodes: [
				{
					nodeType: 'n8n-nodes-roistat.roistatTrigger',
					relationHint:
						'Starts the workflow when Roistat calls a webhook — an incoming call, or a scenario in Автоматизация маркетинга',
				},
			],
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'roistatApi', required: true }],
		properties: [resourceProperty, ...resourceProperties],
	};

	methods = { loadOptions };

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return await routeItems.call(this, resources);
	}
}
