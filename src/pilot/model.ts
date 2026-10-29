import type { Config } from "../engine/config.js";

// Providers train on what's sent to "-contributor" models, which is why they cost so much less: fine for
// generated people, never for real ones.
const TRAINED_ON = /-contributor$/;

// Throws unless `config`'s model is safe for real people's data. Names the model, never other settings.
export function assertRealDataModel(config: Config): void {
	if (TRAINED_ON.test(config.model)) {
		throw new Error(
			`LLM_MODEL is ${config.model}, which the provider trains on, so it must never see real people's data. Set LLM_MODEL to the regular model (for example, without "-contributor") to run with real people.`,
		);
	}
}
