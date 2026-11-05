import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { Config } from "@remotion/cli/config";

// Prefer the complete local Chrome bundle; the downloaded headless-shell
// build currently fails to locate its ICU resource on this Mac.
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if (existsSync(chrome)) Config.setBrowserExecutable(chrome);
Config.setCodec("h264");
Config.setPixelFormat("yuv420p");
Config.setOverwriteOutput(true);

// App source is outside this package: ensure its hooks use the renderer's React.
Config.overrideWebpackConfig((config) => ({
	...config,
	resolve: {
		...config.resolve,
 extensionAlias: {".js": [".js", ".ts", ".tsx"]},
		alias: {
			...config.resolve?.alias,
			react: resolve("node_modules/react"),
			"react-dom": resolve("node_modules/react-dom"),
		},
	},
}));
