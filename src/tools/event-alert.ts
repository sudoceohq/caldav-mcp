import type { Alarm } from "ts-caldav";
import { z } from "zod";

export const alertFieldSchema = z
	.number()
	.int()
	.nonnegative()
	.describe(
		"Minutes before the event starts to show a display alert. 0 means at the time of the event. Omit to create the event with no alert.",
	);

export const alertUpdateFieldSchema = z
	.number()
	.int()
	.nonnegative()
	.nullable()
	.describe(
		"Minutes before the event starts to show a display alert. 0 means at the time of the event. Replaces existing alerts. Pass null to remove them. Omit to leave existing alerts unchanged.",
	);

export function displayAlarm(minutes: number, text: string): Alarm {
	// iCloud writes an alert at the event start as TRIGGER:-PT0S.
	const trigger = minutes === 0 ? "-PT0S" : `-PT${minutes}M`;
	return {
		action: "DISPLAY",
		trigger,
		description: text.length > 0 ? text : "Reminder",
	};
}
