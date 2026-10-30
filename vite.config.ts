import { defineConfig } from "vite";
import { handlePeople } from "./src/pilot/people-api.js";

export default defineConfig({
	plugins: [
		{
			// The People page saves real people's profiles into profiles/ through the dev server, which only
			// listens on this machine. There's no such endpoint in a production build.
			name: "agentmatch-people",
			configureServer(server) {
				server.middlewares.use("/api/people", (req, res, next) => {
					handlePeople(req, res).catch(next);
				});
			},
		},
	],
	build: {
		rollupOptions: {
			input: { main: "index.html", people: "people.html" },
		},
	},
});
