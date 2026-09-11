import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

/** The project this item works on, or '' to fall back to the credential. */
export function projectFor(this: IExecuteFunctions, itemIndex: number): string {
	return String(this.getNodeParameter('projectId', itemIndex, '') ?? '').trim();
}

/**
 * Turns whatever the date field holds into the instant Roistat reads.
 *
 * n8n hands a date picker over as an ISO string with an offset, which is exactly
 * what the API wants, so the common case is a pass-through. A value typed by
 * hand is parsed and re-serialised; one that cannot be parsed is passed through
 * unchanged rather than dropped, because a request Roistat rejects by name is
 * far better than a period filter that silently disappears and a report that
 * quietly covers all of time.
 */
export function toRoistatInstant(value: unknown): string {
	const text = String(value ?? '').trim();
	if (text === '') return '';

	// Already an ISO instant with an offset or a Z — nothing to do.
	if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(text)) return text;

	const parsed = new Date(text);
	if (Number.isNaN(parsed.getTime())) return text;

	return parsed.toISOString();
}

/** `YYYY-MM-DD`, the shape the day-based endpoints take. */
export function toRoistatDate(value: unknown): string {
	const text = String(value ?? '').trim();
	if (text === '') return '';

	if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

	const parsed = new Date(text);
	if (Number.isNaN(parsed.getTime())) return text;

	return parsed.toISOString().slice(0, 10);
}

/**
 * `YYYY-MM-DD HH:MM` in UTC — what the upload endpoints take.
 *
 * These methods predate the ISO-with-offset style the analytics half uses, and
 * they read a bare wall-clock string as UTC. Converting here rather than passing
 * the instant through is what keeps a deal created at 00:30 Moscow time on the
 * first from being counted on the last day of the previous month.
 *
 * Minutes, not seconds: `/project/add-orders` documents `date_create` as
 * "UNIX-time or YYYY-MM-DD HH:MM", and a documented format is the one to send
 * when the endpoint's tolerance for anything else is unknown. A value that
 * already carries seconds is passed through — someone who typed them meant them.
 */
export function toRoistatDateTime(value: unknown): string {
	const text = String(value ?? '').trim();
	if (text === '') return '';

	if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(text)) return text;

	const parsed = new Date(text);
	if (Number.isNaN(parsed.getTime())) return text;

	return parsed.toISOString().slice(0, 16).replace('T', ' ');
}

/** The period fields as Roistat's `{from, to}` object. */
export function periodFor(
	this: IExecuteFunctions,
	itemIndex: number,
	required = true,
): { from: string; to: string } | undefined {
	const from = toRoistatInstant(this.getNodeParameter('periodFrom', itemIndex, ''));
	const to = toRoistatInstant(this.getNodeParameter('periodTo', itemIndex, ''));

	if (from === '' && to === '') {
		if (!required) return undefined;

		throw new NodeOperationError(this.getNode(), 'This operation needs a period', {
			description: 'Fill in Start and End. Roistat has no default period and refuses the call without one.',
			itemIndex,
		});
	}

	if (from === '' || to === '') {
		throw new NodeOperationError(this.getNode(), 'A period needs both ends', {
			description: 'Roistat takes a closed period: fill in Start and End, not just one of them.',
			itemIndex,
		});
	}

	return { from, to };
}

/**
 * `YYYY-MM-DD-YYYY-MM-DD` — the one date format the proxy-lead endpoint takes.
 *
 * It is a single string with four dashes in it rather than two parameters, and
 * the API rejects anything else, so the two date fields are joined here rather
 * than asking the user to write it out.
 */
export function periodStringFor(this: IExecuteFunctions, itemIndex: number): string {
	const from = toRoistatDate(this.getNodeParameter('periodFrom', itemIndex, ''));
	const to = toRoistatDate(this.getNodeParameter('periodTo', itemIndex, ''));

	if (from === '' || to === '') {
		throw new NodeOperationError(this.getNode(), 'This operation needs a period', {
			description:
				'Fill in Start and End. Roistat asks for the period as YYYY-MM-DD-YYYY-MM-DD and has no default.',
			itemIndex,
		});
	}

	return `${from}-${to}`;
}

/** Parses a `json`-typed parameter, naming the field when it will not parse. */
export function jsonParameter(
	this: IExecuteFunctions,
	name: string,
	label: string,
	itemIndex: number,
): unknown {
	const raw = this.getNodeParameter(name, itemIndex, '');

	if (raw === '' || raw === undefined || raw === null) return undefined;
	if (typeof raw === 'object') return raw;

	try {
		return JSON.parse(String(raw));
	} catch {
		throw new NodeOperationError(this.getNode(), `${label} is not valid JSON`, {
			description: `Roistat takes this field as JSON. Check the quotes and brackets in ${label}.`,
			itemIndex,
		});
	}
}

/**
 * Merges the filters a user wrote by hand with the ones the node built.
 *
 * Roistat accepts either a flat array of triples or an `{and: […]}` / `{or: […]}`
 * tree, and the two cannot simply be concatenated. Both sides are normalised into
 * one `and` so that a hand-written filter narrows the result rather than
 * replacing the period the operation already asked for — the alternative is a
 * report that silently covers all of time because one extra filter was added.
 */
/**
 * Builds the `filters` value a list method takes, working around a server bug.
 *
 * **Roistat answers HTTP 500 `internal_error` to an `and` holding exactly one
 * condition.** Verified on a live project on 11.09.2026: the same condition sent
 * as a bare list of triples — `[["date", ">=", …]]` — answers 200, and two
 * conditions inside `and` answer 200. Only the one-element `and` breaks, on the
 * visit list and the deal list alike.
 *
 * That is a bug on their side, but it is this node's problem: a user filtering
 * deals by status alone, with no period, builds exactly one condition. So a
 * single condition goes out as a flat list and everything else as the tree.
 */
export function filtersPayload(
	built: unknown[],
	written: unknown,
): IDataObject | unknown[] | undefined {
	const merged = mergeFilters(built, written);

	if (merged === undefined) return undefined;

	// A hand-written `{or: …}` or `{and: …}` is passed through as the user meant
	// it; only the list this node assembles is reshaped.
	if (!Array.isArray(merged)) return merged;

	return merged.length === 1 ? merged : { and: merged };
}

export function mergeFilters(built: unknown[], written: unknown): IDataObject | unknown[] | undefined {
	const hasBuilt = built.length > 0;

	if (written === undefined) return hasBuilt ? built : undefined;

	if (Array.isArray(written)) {
		const combined = [...built, ...written];
		return combined.length > 0 ? combined : undefined;
	}

	if (written !== null && typeof written === 'object') {
		return hasBuilt ? { and: [...built, written] } : (written as IDataObject);
	}

	return hasBuilt ? built : undefined;
}

/**
 * What a write's answer becomes when Roistat answers with nothing but a status.
 *
 * Several endpoints reply `{"status": "success"}` and no more. Returning that as
 * an empty item makes a workflow look like it did nothing, so the caller passes
 * what it knows — the ID it just wrote, for instance — and that becomes the item.
 */
export function toItems(data: unknown, fallback: IDataObject): IDataObject[] {
	if (Array.isArray(data)) {
		return data.length === 0 ? [fallback] : (data as IDataObject[]);
	}

	if (data !== null && typeof data === 'object') {
		const object = data as IDataObject;
		return Object.keys(object).length === 0 ? [fallback] : [object];
	}

	return [fallback];
}

/** Drops keys the user left blank, so an untouched field is not sent as ''. */
export function omitEmpty(input: IDataObject): IDataObject {
	const output: IDataObject = {};

	for (const [key, value] of Object.entries(input)) {
		if (value === undefined || value === null || value === '') continue;
		output[key] = value;
	}

	return output;
}

/** Splits a comma-separated list the way every "names" field in this node does. */
export function splitList(value: unknown): string[] {
	return String(value ?? '')
		.split(',')
		.map((entry) => entry.trim())
		.filter((entry) => entry !== '');
}

/**
 * Turns an n8n fixedCollection of name/value rows into Roistat's `fields` object.
 *
 * Custom fields are addressed by their human-readable name in Roistat — the same
 * name the CRM shows — rather than by an ID, so this is a plain map.
 */
export function fieldsFromCollection(rows: unknown): IDataObject {
	const output: IDataObject = {};

	const list = ((rows as IDataObject)?.field ?? []) as IDataObject[];

	for (const row of Array.isArray(list) ? list : []) {
		const name = String(row.name ?? '').trim();
		if (name === '') continue;
		output[name] = row.value ?? '';
	}

	return output;
}
