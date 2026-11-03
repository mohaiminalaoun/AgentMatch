// Only for project-only repair proposals: exclude verbatim project language that
// every recipient already received. This is not a general vocabulary exemption.
export function undisclosedProjectText(
	text: string,
	agreed: readonly string[],
): string {
	if (agreed.some((source) => source.trim() === text.trim())) return "";
	const tokenize = (value: string) => [...value.matchAll(/[\p{L}\p{N}]+/gu)];
	const phrases = new Set<string>();
	for (const source of agreed) {
		const words = tokenize(source);
		for (let i = 0; i + 2 < words.length; i++) {
			phrases.add(
				words
					.slice(i, i + 3)
					.map((word) => word[0].toLowerCase())
					.join(" "),
			);
		}
	}
	const words = tokenize(text);
	// Regex indices are UTF-16 offsets; split likewise so non-ASCII project text
	// cannot shift a mask onto unrelated personal information.
	const masked = text.split("");
	for (let i = 0; i + 2 < words.length; i++) {
		const phrase = words
			.slice(i, i + 3)
			.map((word) => word[0].toLowerCase())
			.join(" ");
		if (!phrases.has(phrase)) continue;
		const end = words[i + 2]!.index! + words[i + 2]![0].length;
		masked.fill(" ", words[i]!.index!, end);
	}
	return masked.join("");
}

// A repair describes a product, not the people behind it. Do not let an existing
// project phrase authorize new personal claims such as "I have ML experience".
export function containsPersonalClaim(text: string): boolean {
	return /\b(i|me|my|mine|we|us|our|ours|they|their|human|humans|owner|owners|member|members|teammate|teammates|person)\b/i.test(
		text,
	);
}
