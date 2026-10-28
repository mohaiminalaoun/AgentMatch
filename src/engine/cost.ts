import type { TokenUsage } from "./llm.js";

// What the provider charges, in US dollars per million tokens.
export type Prices = {
	input: number;
	cachedInput: number;
	output: number;
};

// The estimated price of `usage` in US dollars. Cached input tokens are billed at the cached rate and the
// rest of the input at the full rate; hidden reasoning tokens are part of output, so they're included.
export function estimateCost(usage: TokenUsage, prices: Prices): number {
	const cached = usage.cached ?? 0;
	return (
		((usage.input - cached) * prices.input +
			cached * prices.cachedInput +
			usage.output * prices.output) /
		1_000_000
	);
}
