import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CalDAVClient } from "ts-caldav";
import { describe, expect, test, vi } from "vitest";
import { icsFor, valarmBlock } from "./capture-event-ics.js";
import { createEventDefinition, registerCreateEvent } from "./create-event.js";

type ToolHandler = (params: {
	summary: string;
	start: string;
	end: string;
	calendarUrl: string;
	wholeDay?: boolean;
	description?: string;
	location?: string;
	alert?: number;
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

function makeServer() {
	let toolHandler: ToolHandler | null = null;
	const server = new McpServer({ name: "test-server", version: "0.1.0" });
	const originalRegisterTool = server.registerTool.bind(server);
	server.registerTool = vi.fn(
		(name: string, config: unknown, handler: ToolHandler) => {
			if (name === "create-event") toolHandler = handler;
			return originalRegisterTool(name, config, handler);
		},
	) as typeof server.registerTool;
	return { server, getHandler: () => toolHandler };
}

describe("registerCreateEvent", () => {
	test("converts recurrenceRule.until from ISO string to Date", async () => {
		const mockClient = {
			createEvent: vi.fn().mockResolvedValue({ uid: "event-123" }),
		};

		const { server, getHandler } = makeServer();
		registerCreateEvent(mockClient as unknown as CalDAVClient, server);
		const handler = getHandler();
		if (!handler) throw new Error("handler not registered");

		const untilIso = "2026-05-15T10:00:00.000Z";
		await handler({
			summary: "Recurring",
			start: "2026-05-12T10:00:00.000Z",
			end: "2026-05-12T10:30:00.000Z",
			calendarUrl: "/f/test-calendar/",
			recurrenceRule: { freq: "DAILY", until: untilIso },
		});

		const passed = mockClient.createEvent.mock.calls[0]?.[1];
		expect(passed?.recurrenceRule?.until).toBeInstanceOf(Date);
		expect(passed?.recurrenceRule?.until?.toISOString()).toBe(untilIso);
		expect(passed?.recurrenceRule?.freq).toBe("DAILY");
	});

	test("omits recurrenceRule when not provided", async () => {
		const mockClient = {
			createEvent: vi.fn().mockResolvedValue({ uid: "event-123" }),
		};

		const { server, getHandler } = makeServer();
		registerCreateEvent(mockClient as unknown as CalDAVClient, server);
		const handler = getHandler();
		if (!handler) throw new Error("handler not registered");

		await handler({
			summary: "One-off",
			start: "2026-05-12T10:00:00.000Z",
			end: "2026-05-12T10:30:00.000Z",
			calendarUrl: "/f/test-calendar/",
		});

		const passed = mockClient.createEvent.mock.calls[0]?.[1];
		expect(passed?.recurrenceRule).toBeUndefined();
	});

	test("passes wholeDay flag when true", async () => {
		const mockClient = {
			createEvent: vi.fn().mockResolvedValue({ uid: "event-123" }),
		};

		const { server, getHandler } = makeServer();
		registerCreateEvent(mockClient as unknown as CalDAVClient, server);
		const handler = getHandler();
		if (!handler) throw new Error("handler not registered");

		await handler({
			summary: "Whole day",
			start: "2026-05-12T00:00:00.000Z",
			end: "2026-05-13T00:00:00.000Z",
			calendarUrl: "/f/test-calendar/",
			wholeDay: true,
		});

		const passed = mockClient.createEvent.mock.calls[0]?.[1];
		expect(passed?.wholeDay).toBe(true);
	});

	test("passes wholeDay flag when false", async () => {
		const mockClient = {
			createEvent: vi.fn().mockResolvedValue({ uid: "event-123" }),
		};

		const { server, getHandler } = makeServer();
		registerCreateEvent(mockClient as unknown as CalDAVClient, server);
		const handler = getHandler();
		if (!handler) throw new Error("handler not registered");

		await handler({
			summary: "Timed event",
			start: "2026-05-12T10:00:00.000Z",
			end: "2026-05-12T10:30:00.000Z",
			calendarUrl: "/f/test-calendar/",
			wholeDay: false,
		});

		const passed = mockClient.createEvent.mock.calls[0]?.[1];
		expect(passed?.wholeDay).toBe(false);
	});

	test("omits wholeDay when not provided", async () => {
		const mockClient = {
			createEvent: vi.fn().mockResolvedValue({ uid: "event-123" }),
		};

		const { server, getHandler } = makeServer();
		registerCreateEvent(mockClient as unknown as CalDAVClient, server);
		const handler = getHandler();
		if (!handler) throw new Error("handler not registered");

		await handler({
			summary: "Timed event",
			start: "2026-05-12T10:00:00.000Z",
			end: "2026-05-12T10:30:00.000Z",
			calendarUrl: "/f/test-calendar/",
		});

		const passed = mockClient.createEvent.mock.calls[0]?.[1];
		expect(passed).not.toHaveProperty("wholeDay");
	});

	test("writes a display alarm at the event start when alert is 0", async () => {
		const mockClient = {
			createEvent: vi.fn().mockResolvedValue({ uid: "event-123" }),
		};

		const { server, getHandler } = makeServer();
		registerCreateEvent(mockClient as unknown as CalDAVClient, server);
		const handler = getHandler();
		if (!handler) throw new Error("handler not registered");

		await handler({
			summary: "Dentist",
			start: "2026-05-12T10:00:00.000Z",
			end: "2026-05-12T10:30:00.000Z",
			calendarUrl: "/f/test-calendar/",
			alert: 0,
		});

		const passed = mockClient.createEvent.mock.calls[0]?.[1];
		const ics = await icsFor(passed);
		const alarm = valarmBlock(ics);
		expect(alarm).toBeDefined();
		expect(alarm).toContain("ACTION:DISPLAY");
		expect(alarm).toContain("TRIGGER:-PT0S");
		expect(alarm).toContain("DESCRIPTION:Dentist");
		expect(alarm).not.toContain("X-WR-ALARMUID");
		expect(alarm).not.toContain("UID");
		expect(ics).toContain("BEGIN:VALARM");
		expect(ics).toContain("END:VALARM");
	});

	test("writes a display alarm 15 minutes before the start", async () => {
		const mockClient = {
			createEvent: vi.fn().mockResolvedValue({ uid: "event-123" }),
		};

		const { server, getHandler } = makeServer();
		registerCreateEvent(mockClient as unknown as CalDAVClient, server);
		const handler = getHandler();
		if (!handler) throw new Error("handler not registered");

		await handler({
			summary: "Dentist",
			start: "2026-05-12T10:00:00.000Z",
			end: "2026-05-12T10:30:00.000Z",
			calendarUrl: "/f/test-calendar/",
			alert: 15,
		});

		const passed = mockClient.createEvent.mock.calls[0]?.[1];
		const ics = await icsFor(passed);
		const alarm = valarmBlock(ics);
		expect(alarm).toContain("ACTION:DISPLAY");
		expect(alarm).toContain("TRIGGER:-PT15M");
		expect(alarm).toContain("DESCRIPTION:Dentist");
		expect(ics).toContain("BEGIN:VALARM");
		expect(ics).toContain("END:VALARM");
	});

	test("omits the alarm when alert is not provided", async () => {
		const mockClient = {
			createEvent: vi.fn().mockResolvedValue({ uid: "event-123" }),
		};

		const { server, getHandler } = makeServer();
		registerCreateEvent(mockClient as unknown as CalDAVClient, server);
		const handler = getHandler();
		if (!handler) throw new Error("handler not registered");

		await handler({
			summary: "Dentist",
			start: "2026-05-12T10:00:00.000Z",
			end: "2026-05-12T10:30:00.000Z",
			calendarUrl: "/f/test-calendar/",
		});

		const passed = mockClient.createEvent.mock.calls[0]?.[1];
		expect(passed).not.toHaveProperty("alarms");
		const ics = await icsFor(passed);
		expect(ics).not.toContain("BEGIN:VALARM");
		expect(ics).not.toContain("END:VALARM");
	});

	test("rejects an alert that is not a whole number of minutes", async () => {
		const alert = createEventDefinition.inputSchema.alert;
		expect(alert.unwrap().description).toBe(
			"Minutes before the event starts to show a display alert. 0 means at the time of the event. Omit to create the event with no alert.",
		);
		expect(alert.safeParse(0).success).toBe(true);
		expect(alert.safeParse(15).success).toBe(true);
		expect(alert.safeParse(undefined).success).toBe(true);
		expect(alert.safeParse(-1).success).toBe(false);
		expect(alert.safeParse(1.5).success).toBe(false);
		expect(alert.safeParse("PT15M").success).toBe(false);
		expect(alert.safeParse(null).success).toBe(false);

		const mockClient = {
			createEvent: vi.fn().mockResolvedValue({ uid: "event-123" }),
		};
		const [clientTransport, serverTransport] =
			InMemoryTransport.createLinkedPair();
		const mcp = new McpServer({ name: "test-server", version: "0.1.0" });
		registerCreateEvent(mockClient as unknown as CalDAVClient, mcp);
		await mcp.connect(serverTransport);
		const client = new Client({ name: "test-client", version: "0.0.0" });
		await client.connect(clientTransport);

		const rejected = await client.callTool({
			name: "create-event",
			arguments: {
				summary: "Dentist",
				start: "2026-05-12T10:00:00.000Z",
				end: "2026-05-12T10:30:00.000Z",
				calendarUrl: "/f/test-calendar/",
				alert: -1,
			},
		});
		expect(rejected.isError).toBe(true);
		expect(rejected.content).toEqual([
			expect.objectContaining({
				type: "text",
				text: expect.stringContaining(
					"Invalid arguments for tool create-event",
				),
			}),
		]);
		expect(mockClient.createEvent).not.toHaveBeenCalled();

		await client.close();
		await mcp.close();
	});
});
