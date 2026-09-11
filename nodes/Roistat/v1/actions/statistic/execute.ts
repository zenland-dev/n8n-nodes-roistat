import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { unknownOperation } from '../../../../../utils/router';
import { omitEmpty, periodStringFor, projectFor } from '../../helpers/request';
import { BUDGETS, listFrom, roistatApiRequest } from '../../transport';

/**
 * `POST /project/statistics/get-daily`.
 *
 * The answer has three parts: a row per day, a total for the period, and an
 * average. All three are emitted, tagged with `_row`, because dropping the last
 * two would mean recomputing them downstream — and an average of ROI is not the
 * ROI of the total, so recomputing it would quietly give a different number.
 */
async function getDaily(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
	const project = projectFor.call(this, itemIndex);

	const body: IDataObject = omitEmpty({
		// This endpoint takes the dotted-together day range rather than the
		// `{from, to}` object the analytics half uses.
		period: periodStringFor.call(this, itemIndex),
		time_zone: this.getNodeParameter('timezone', itemIndex, ''),
		channel: this.getNodeParameter('channel', itemIndex, ''),
	});

	const payload = (await roistatApiRequest.call(
		this,
		'POST',
		'/project/statistics/get-daily',
		body,
		undefined,
		{ project, budget: BUDGETS.dailyStatistics },
	)) as IDataObject;

	const output: INodeExecutionData[] = listFrom(payload, 'StatisticsItems').map((row) => ({
		json: { ...row, _row: 'day' },
	}));

	const summary = payload.SummaryItem as IDataObject | undefined;
	if (summary !== undefined && summary !== null) {
		output.push({ json: { ...summary, _row: 'total' } });
	}

	const average = payload.AverageItem as IDataObject | undefined;
	if (average !== undefined && average !== null) {
		output.push({ json: { ...average, _row: 'average' } });
	}

	return output;
}

export async function execute(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	if (operation === 'getDaily') return await getDaily.call(this, itemIndex);

	throw unknownOperation.call(this, 'Statistics', operation, itemIndex);
}
