import { createServer, type Server } from "node:http";
import { type Alarm, CalDAVClient } from "ts-caldav";

type EventWrite = {
	summary: string;
	start: Date;
	end: Date;
	alarms?: Alarm[];
};

export async function icsFor(event: EventWrite): Promise<string> {
	const puts: string[] = [];
	const server: Server = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => {
			chunks.push(chunk);
		});
		req.on("end", () => {
			if (req.method === "PUT") {
				puts.push(Buffer.concat(chunks).toString("utf8"));
			}
			res.writeHead(req.method === "PUT" ? 201 : 404, { ETag: '"1"' });
			res.end();
		});
	});

	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", resolve);
	});

	try {
		const address = server.address();
		if (address === null || typeof address === "string") {
			throw new Error("test server did not bind a port");
		}
		const client = CalDAVClient.createFromCache(
			{
				baseUrl: `http://127.0.0.1:${address.port}`,
				auth: { type: "basic", username: "u", password: "p" },
			},
			{ userPrincipal: "/principals/u/", calendarHome: "/calendars/u/" },
		);
		await client.createEvent("/calendars/u/home/", event);
		const body = puts[0];
		if (body === undefined) {
			throw new Error("createEvent did not PUT an iCalendar body");
		}
		return body;
	} finally {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => {
				if (error) reject(error);
				else resolve();
			});
		});
	}
}

export function valarmBlock(ics: string): string | undefined {
	return ics.split("BEGIN:VALARM")[1]?.split("END:VALARM")[0];
}
