import type { IDataObject, INode, JsonObject } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

import { extractResponseBody, extractStatusCode } from '../../../../utils/httpError';

/**
 * The envelope Roistat answers with.
 *
 * `status` is a string — `"success"` on a good answer — and not the boolean a
 * reader coming from another API expects. The payload sits under a key named
 * after the resource (`data`, `clients`, `ProxyLeads`, `metrics`…), which is why
 * nothing here tries to name it: the caller knows which key it asked for.
 *
 * A failure carries the machine-readable code in `error`. The list is in the
 * platform's own documentation, and the ones worth translating are mapped below.
 */
export interface RoistatEnvelope extends IDataObject {
	status?: string;
	error?: string;
	/**
	 * The human-readable half of a refusal.
	 *
	 * `description` is the field Roistat actually fills in — verified against a
	 * live project on 11.09.2026, where a rejected call answered
	 * `{status: "error", error: "resource_not_found", description: "…"}` and no
	 * `message` at all. `message` is read too, because the documentation names it.
	 */
	description?: string;
	message?: string;
	/** Extra context on some refusals, e.g. `{option: "multi_channel"}` on a 402. */
	details?: IDataObject;
	total?: number;
}

/**
 * What each documented error code means in the user's terms.
 *
 * Roistat sends these instead of, not alongside, an explanation: the body of a
 * refused request is the code and little else. Spelling them out here is the
 * difference between "authorization_failed" and a sentence naming which of the
 * two authorizations failed — the credential's, or Roistat's own connection to
 * the CRM behind it.
 */
const ERROR_CODES: Record<string, string> = {
	authentication_failed:
		'The API key or the project number was refused. The key lives in Профиль → Настройки → API key and belongs to a profile, not to a project — check that the project number is one that profile can see.',
	authorization_failed:
		'Roistat could not reach the data service behind this call — usually the CRM it integrates with. This is not about the credential in n8n: the connection to reauthorise is the one inside the Roistat project.',
	access_denied:
		'The profile that owns this API key has no access to the project. Open Права доступа in Roistat and grant it.',
	insufficient_funds: 'The Roistat project has run out of funds.',
	option_not_available:
		'The feature this call belongs to is not switched on for the project, or not included in its plan. Calltracking, Речевая аналитика and Управление заявками are separate options.',
	option_not_enabled:
		'The feature this call belongs to is not switched on for the project. Управление клиентами, Коллтрекинг and Речевая аналитика are each enabled separately in Roistat.',
	integration_error:
		'The project is not set up for this call. The lead board methods answer this way on a project that has a CRM integrated instead — those deals live under the Deal resource.',
	option_not_paid: 'The feature this call belongs to has not been paid for.',
	project_frozen: 'The project is frozen. Nothing can be read or written until it is unfrozen.',
	resource_not_found:
		'Roistat has no such method or no such object. Check the ID, and that the feature is enabled for the project.',
	resource_already_exists: 'An object with that identifier already exists in the project.',
	request_data_validation_error:
		'A field was sent with the wrong type. Numbers have to be numbers and dates have to match the format the operation asks for.',
	request_limit_error:
		'The project went over its request budget: 10 per second and 5000 per hour, counted across every integration using it. Some methods are stricter still — the daily statistics report allows 5 calls per hour.',
	incorrect_request: 'Roistat could not read the request body.',
	unknown_error: 'Roistat failed while processing the request. Sending it again usually works.',
	internal_error: 'Roistat failed while processing the request. Sending it again usually works.',
};

/** The human-readable half of a Roistat failure, whichever field it arrived in. */
function describe(body: RoistatEnvelope): { code: string; text: string } {
	const code = String(body.error ?? '').trim();
	// `description` first: that is the field a live project fills in. `message` is
	// the documented name and is read as a fallback.
	const reported = String(body.description ?? body.message ?? '').trim();
	const explained = ERROR_CODES[code] ?? '';

	// A 402 names the missing option under `details.option` and nowhere else, and
	// that one word is what turns "not paid for" into something actionable.
	const option = String((body.details as IDataObject | undefined)?.option ?? '').trim();
	const detail = option === '' ? '' : `Roistat calls the missing option "${option}".`;

	const text = [explained, reported, detail].filter((part) => part !== '').join('\n');

	return { code, text };
}

/**
 * Turns a Roistat failure into a NodeApiError a user can act on.
 *
 * The status line alone is not enough to do this. Roistat answers **200 for
 * every error** unless the request asked for real codes with `Use-Http-Code: 1`,
 * which the transport always does — but the body still carries the specific
 * code, and `403 access_denied` and `403 option_not_available` need different
 * things done about them.
 */
export function toRoistatError(node: INode, error: unknown, status?: number): NodeApiError {
	if (error instanceof NodeApiError && status === undefined) return error;

	const httpCode = status ?? extractStatusCode(error);
	const body = (extractResponseBody(error) ?? {}) as RoistatEnvelope;
	const { code, text } = describe(body);

	let message = code === '' ? 'Roistat request failed' : `Roistat: ${code}`;
	let description = text;

	switch (httpCode) {
		case 401:
			message = 'Roistat refused the credential';
			description =
				description === '' ? (ERROR_CODES.authentication_failed as string) : description;
			break;
		case 403:
			message = 'Roistat refused access to the project';
			description = description === '' ? (ERROR_CODES.access_denied as string) : description;
			break;
		case 429:
			message = 'Roistat rate limit exceeded';
			description =
				description === ''
					? (ERROR_CODES.request_limit_error as string)
					: `${description}\nLower "Requests per Second" on the credential, or reduce how many workflows use this project at once.`;
			break;
		default:
			if (httpCode !== undefined && httpCode >= 500) {
				message = 'Roistat returned a server error';
			}
	}

	return new NodeApiError(node, asPlainError(error), {
		message,
		description: description.trim() === '' ? undefined : description.trim(),
		httpCode: httpCode === undefined ? undefined : String(httpCode),
	});
}

/**
 * Flattens an error into something the NodeApiError constructor will re-shape.
 *
 * Handed a NodeApiError, that constructor returns the original untouched, so the
 * mapping above would be computed and then discarded — leaving the bare error
 * code in place of the explanation.
 */
function asPlainError(error: unknown): JsonObject {
	if (!(error instanceof NodeApiError)) return error as JsonObject;

	return {
		message: error.message,
		description: (error as unknown as { description?: string }).description ?? null,
		httpCode: error.httpCode,
	} as unknown as JsonObject;
}

/**
 * A response that arrived 200 and still says it failed.
 *
 * This is Roistat's default shape — the platform treats HTTP as transport and
 * puts the verdict in the body — so it is the normal path, not an edge case.
 */
export function envelopeError(node: INode, envelope: RoistatEnvelope): NodeApiError {
	const { code, text } = describe(envelope);

	return new NodeApiError(node, envelope as JsonObject, {
		message: code === '' ? 'Roistat reported a failure' : `Roistat: ${code}`,
		description: text === '' ? undefined : text,
	});
}
