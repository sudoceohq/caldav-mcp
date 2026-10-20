import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CalDAVClient, Event } from "ts-caldav";
import { describe, expect, test, vi } from "vitest";
import { icsFor, valarmBlock } from "./capture-event-ics.js";
import { registerUpdateEvent, updateEventDefinition } from "./update-event.js";

type ToolHandler = (params: {
	uid: string;
	calendarUrl: string;
	summary?: string;
	start?: string;
	end?: string;
	wholeDay?: boolean;
	description?: string;
	location?: string;
	alert?: number | null;
	recurrenceRule?: {
		freq?: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
		interval?: number;
		count?: number;
		until?: string;
		byday?: string[];
		bymonthday?: number[];
		bymonth?: number[];
	};
}) => Promise<{ content: { type: string; text: string }[] }>;

const existingEvent: Event = {
	uid: "event-123",
	href: "/f/test-calendar/event-123.ics",
	etag: '"abc123"',
	summary: "Original summary",
	start: new Date("2026-04-03T10:00:00Z"),
	end: new Date("2026-04-03T11:00:00Z"),
};

function makeServer() {
	let toolHandler: ToolHandler | null = null;
	const server = new McpServer({ name: "test-server", version: "0.1.0" });
	const originalRegisterTool = server.registerTool.bind(server);
	server.registerTool = vi.fn(
		(name: string, config: unknown, handler: ToolHandler) => {
			if (name === "update-event") toolHandler = handler;
			return originalRegisterTool(name, config, handler);
		},
	) as typeof server.registerTool;
	return { server, getHandler: () => toolHandler };
}

describe("registerUpdateEvent", () => {
	test("updates only the provided fields", async () => {
		const mockClient = {
			getEventsByHref: vi.fn().mockResolvedValue([existingEvent]),
			updateEvent: vi.fn().mockResolvedValue({
				uid: "event-123",
				href: existingEvent.href,
				etag: '"new-etag"',
				newCtag: "",
			}),
		};

		const { server, getHandler } = makeServer();
		registerUpdateEvent(mockClient as unknown as CalDAVClient, server);
		const handler = getHandler();
		if (!handler) throw new Error("handler not registered");

		const result = await handler({
			uid: "event-123",
			calendarUrl: "/f/test-calendar/",
			summary: "Updated summary",
		});

		expect(result.content[0].text).toBe("event-123");
		expect(mockClient.getEventsByHref).toHaveBeenCalledWith(
			"/f/test-calendar/",
			["/f/test-calendar/event-123.ics"],
		);
		expect(mockClient.updateEvent).toHaveBeenCalledWith(
			"/f/test-calendar/",
			expect.objectContaining({
				uid: "event-123",
				etag: '"abc123"',
				summary: "Updated summary",
				start: existingEvent.start,
				end: existingEvent.end,
			}),
		);
	});

	test("throws when event is not found", async () => {
		const mockClient = {
			getEventsByHref: vi.fn().mockResolvedValue([]),
			updateEvent: vi.fn(),
		};

		const { server, getHandler } = makeServer();
		registerUpdateEvent(mockClient as unknown as CalDAVClient, server);
		const handler = getHandler();
		if (!handler) throw new Error("handler not registered");

		await expect(
			handler({ uid: "missing", calendarUrl: "/f/test-calendar/" }),
		).rejects.toThrow("Event not found: missing");

		expect(mockClient.updateEvent).not.toHaveBeenCalled();
	});

	test("appends trailing slash to calendarUrl when building href", async () => {
		const mockClient = {
			getEventsByHref: vi.fn().mockResolvedValue([existingEvent]),
			updateEvent: vi.fn().mockResolvedValue({
				uid: "event-123",
				href: existingEvent.href,
				etag: '"new-etag"',
				newCtag: "",
			}),
		};

		const { server, getHandler } = makeServer();
		registerUpdateEvent(mockClient as unknown as CalDAVClient, server);
		const handler = getHandler();
		if (!handler) throw new Error("handler not registered");

		await handler({ uid: "event-123", calendarUrl: "/f/test-calendar" });

		expect(mockClient.getEventsByHref).toHaveBeenCalledWith(
			"/f/test-calendar",
			["/f/test-calendar/event-123.ics"],
		);
	});

	test("converts recurrenceRule.until from ISO string to Date", async () => {
		const mockClient = {
			getEventsByHref: vi.fn().mockResolvedValue([existingEvent]),
			updateEvent: vi.fn().mockResolvedValue({
				uid: "event-123",
				href: existingEvent.href,
				etag: '"new-etag"',
				newCtag: "",
			}),
		};

		const { server, getHandler } = makeServer();
		registerUpdateEvent(mockClient as unknown as CalDAVClient, server);
		const handler = getHandler();
		if (!handler) throw new Error("handler not registered");

		const untilIso = "2026-05-15T10:00:00.000Z";
		await handler({
			uid: "event-123",
			calendarUrl: "/f/test-calendar/",
			recurrenceRule: { freq: "DAILY", until: untilIso },
		});

		const passed = mockClient.updateEvent.mock.calls[0]?.[1];
		expect(passed?.recurrenceRule?.until).toBeInstanceOf(Date);
		expect(passed?.recurrenceRule?.until?.toISOString()).toBe(untilIso);
		expect(passed?.recurrenceRule?.freq).toBe("DAILY");
	});

	test("updates wholeDay flag when provided", async () => {
		const mockClient = {
			getEventsByHref: vi.fn().mockResolvedValue([existingEvent]),
			updateEvent: vi.fn().mockResolvedValue({
				uid: "event-123",
				href: existingEvent.href,
				etag: '"new-etag"',
				newCtag: "",
			}),
		};

		const { server, getHandler } = makeServer();
		registerUpdateEvent(mockClient as unknown as CalDAVClient, server);
		const handler = getHandler();
		if (!handler) throw new Error("handler not registered");

		await handler({
			uid: "event-123",
			calendarUrl: "/f/test-calendar/",
			wholeDay: true,
		});

		const passed = mockClient.updateEvent.mock.calls[0]?.[1];
		expect(passed?.wholeDay).toBe(true);
	});

	function updateClient(existing: Event) {
		return {
			getEventsByHref: vi.fn().mockResolvedValue([existing]),
			updateEvent: vi.fn().mockResolvedValue({
				uid: "event-123",
				href: existing.href,
				etag: '"new-etag"',
				newCtag: "",
			}),
		};
	}

	test("adds a display alarm 15 minutes before the start", async () => {
		const mockClient = updateClient(existingEvent);
		const { server, getHandler } = makeServer();
		registerUpdateEvent(mockClient as unknown as CalDAVClient, server);
		const handler = getHandler();
		if (!handler) throw new Error("handler not registered");

		await handler({
			uid: "event-123",
			calendarUrl: "/f/test-calendar/",
			alert: 15,
		});

		const passed = mockClient.updateEvent.mock.calls[0]?.[1];
		expect(passed?.alarms).toEqual([
			{
				action: "DISPLAY",
				trigger: "-PT15M",
				description: "Original summary",
			},
		]);
		const ics = await icsFor(passed);
		const alarm = valarmBlock(ics);
		expect(alarm).toContain("ACTION:DISPLAY");
		expect(alarm).toContain("TRIGGER:-PT15M");
		expect(alarm).toContain("DESCRIPTION:Original summary");
		expect(ics).toContain("BEGIN:VALARM");
		expect(ics).toContain("END:VALARM");
	});

	test("changes an existing alarm to the event start", async () => {
		const mockClient = updateClient({
			...existingEvent,
			alarms: [
				{
					action: "DISPLAY",
					trigger: "-PT15M",
					description: "Original summary",
				},
			],
		});
		const { server, getHandler } = makeServer();
		registerUpdateEvent(mockClient as unknown as CalDAVClient, server);
		const handler = getHandler();
		if (!handler) throw new Error("handler not registered");

		await handler({
			uid: "event-123",
			calendarUrl: "/f/test-calendar/",
			alert: 0,
		});

		const passed = mockClient.updateEvent.mock.calls[0]?.[1];
		const ics = await icsFor(passed);
		const alarm = valarmBlock(ics);
		expect(alarm).toContain("TRIGGER:-PT0S");
		expect(alarm).not.toContain("TRIGGER:-PT15M");
		expect(alarm).toContain("ACTION:DISPLAY");
		expect(alarm).toContain("DESCRIPTION:Original summary");
		expect(ics).toContain("BEGIN:VALARM");
		expect(ics).toContain("END:VALARM");
	});

	test("removes an existing alarm when alert is null", async () => {
		const mockClient = updateClient({
			...existingEvent,
			alarms: [
				{
					action: "DISPLAY",
					trigger: "-PT15M",
					description: "Original summary",
				},
			],
		});
		const { server, getHandler } = makeServer();
		registerUpdateEvent(mockClient as unknown as CalDAVClient, server);
		const handler = getHandler();
		if (!handler) throw new Error("handler not registered");

		await handler({
			uid: "event-123",
			calendarUrl: "/f/test-calendar/",
			alert: null,
		});

		const passed = mockClient.updateEvent.mock.calls[0]?.[1];
		expect(passed?.alarms).toEqual([]);
		const ics = await icsFor(passed);
		expect(ics).not.toContain("BEGIN:VALARM");
		expect(ics).not.toContain("END:VALARM");
	});

	test("leaves existing alarms unchanged when alert is omitted", async () => {
		const withAlarm = {
			...existingEvent,
			alarms: [
				{
					action: "DISPLAY" as const,
					trigger: "-PT15M",
					description: "Original summary",
				},
			],
		};
		const mockClient = updateClient(withAlarm);
		const { server, getHandler } = makeServer();
		registerUpdateEvent(mockClient as unknown as CalDAVClient, server);
		const handler = getHandler();
		if (!handler) throw new Error("handler not registered");

		await handler({
			uid: "event-123",
			calendarUrl: "/f/test-calendar/",
			summary: "Renamed",
		});

		const passed = mockClient.updateEvent.mock.calls[0]?.[1];
		expect(passed?.alarms).toEqual(withAlarm.alarms);
		expect(passed?.summary).toBe("Renamed");
		const ics = await icsFor(passed);
		expect(valarmBlock(ics)).toContain("TRIGGER:-PT15M");
	});

	test("rejects an alert that is not a whole number of minutes or null", async () => {
		const alert = updateEventDefinition.inputSchema.alert;
		expect(alert.unwrap().description).toBe(
			"Minutes before the event starts to show a display alert. 0 means at the time of the event. Replaces existing alerts. Pass null to remove them. Omit to leave existing alerts unchanged.",
		);
		expect(alert.safeParse(0).success).toBe(true);
		expect(alert.safeParse(15).success).toBe(true);
		expect(alert.safeParse(null).success).toBe(true);
		expect(alert.safeParse(undefined).success).toBe(true);
		expect(alert.safeParse(-15).success).toBe(false);
		expect(alert.safeParse(15.5).success).toBe(false);
		expect(alert.safeParse("PT0S").success).toBe(false);

		const mockClient = updateClient(existingEvent);
		const [clientTransport, serverTransport] =
			InMemoryTransport.createLinkedPair();
		const mcp = new McpServer({ name: "test-server", version: "0.1.0" });
		registerUpdateEvent(mockClient as unknown as CalDAVClient, mcp);
		await mcp.connect(serverTransport);
		const client = new Client({ name: "test-client", version: "0.0.0" });
		await client.connect(clientTransport);

		const rejected = await client.callTool({
			name: "update-event",
			arguments: {
				uid: "event-123",
				calendarUrl: "/f/test-calendar/",
				alert: -15,
			},
		});
		expect(rejected.isError).toBe(true);
		expect(rejected.content).toEqual([
			expect.objectContaining({
				type: "text",
				text: expect.stringContaining(
					"Invalid arguments for tool update-event",
				),
			}),
		]);
		expect(mockClient.updateEvent).not.toHaveBeenCalled();

		await client.close();
		await mcp.close();
	});
});
