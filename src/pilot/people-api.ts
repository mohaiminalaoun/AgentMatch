import { mkdirSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { listPeople, removePerson, savePerson } from "./people.js";

// Where real people's files go: gitignored, apart from the example.
export const PROFILES_DIR = "profiles";

// The most a request body may hold: far more than one person, far less than anything abusive.
const MAX_BODY = 100_000;

// Handles the People page's requests, under /api/people, for the local dev server only:
// - GET /api/people lists everyone saved (names and skills, nothing private);
// - POST /api/people with { person, replace? } saves one person, or returns what's wrong with them;
// - DELETE /api/people/<id> removes one.
// Anything not from this machine is refused: these files hold real people's private notes.
export async function handlePeople(
	req: IncomingMessage,
	res: ServerResponse,
	dir = PROFILES_DIR,
): Promise<void> {
	const send = (status: number, body: unknown) => {
		res.statusCode = status;
		res.setHeader("Content-Type", "application/json");
		res.end(JSON.stringify(body));
	};
	const address = req.socket.remoteAddress ?? "";
	if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address)) {
		return send(403, { problems: ["only this machine may manage people"] });
	}
	mkdirSync(dir, { recursive: true });
	// Mounted at /api/people, so `url` is what comes after it.
	const id = (req.url ?? "/").split("?")[0]!.replace(/^\/+/, "");
	if (req.method === "GET" && id === "") {
		return send(200, listPeople(dir));
	}
	if (req.method === "DELETE" && id !== "") {
		return removePerson(dir, decodeURIComponent(id))
			? send(200, { removed: id })
			: send(404, { problems: [`nobody saved has the id ${id}`] });
	}
	if (req.method === "POST" && id === "") {
		let body = "";
		for await (const chunk of req) {
			body += chunk;
			if (body.length > MAX_BODY) {
				return send(413, {
					problems: ["that's too large for one person"],
				});
			}
		}
		let parsed: { person?: unknown; replace?: unknown };
		try {
			parsed = JSON.parse(body);
		} catch {
			return send(400, { problems: ["the request wasn't valid JSON"] });
		}
		const result = savePerson(dir, parsed.person, {
			replace: parsed.replace === true,
		});
		return "saved" in result ? send(200, result) : send(422, result);
	}
	send(405, { problems: [`${req.method} isn't supported here`] });
}
