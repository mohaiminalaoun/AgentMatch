import { Profile, ROLES, SkillLevel } from "../engine/profile.js";
import {
	createRng,
	pick,
	randomInt,
	sample,
	type Rng,
} from "../engine/random.js";

export const INTERESTS = [
	"climate",
	"education",
	"health",
	"finance",
	"gaming",
	"music",
	"accessibility",
	"civic tech",
	"open source",
	"developer tools",
	"food",
	"travel",
] as const;

const PROJECT_FORMATS = ["app", "platform", "dashboard", "game", "bot", "API"];

const FIRST_NAMES = [
	"Ada",
	"Ben",
	"Chen",
	"Dara",
	"Eli",
	"Farah",
	"Gus",
	"Hana",
	"Ivan",
	"Jo",
	"Kemi",
	"Leo",
	"Mira",
	"Nico",
	"Omar",
	"Priya",
	"Quinn",
	"Rosa",
	"Sami",
	"Tomas",
];

// Includes half-hour zones (India is +5.5) so overlap math can't assume whole hours.
const UTC_OFFSETS = [-8, -7, -5, -3, 0, 1, 2, 3, 5.5, 8, 9, 10];

// Builds `count` fake people from a seed; used to give every matching method the same population.
export function generateProfiles(count: number, seed: number): Profile[] {
	const rng = createRng(seed);
	return Array.from({ length: count }, (_, i) =>
		generateProfile(rng, `p${i + 1}`),
	);
}

// Builds one random but internally consistent profile, drawing every choice from `rng`.
function generateProfile(rng: Rng, id: string): Profile {
	const skillNames = sample(rng, ROLES, randomInt(rng, 1, 3));
	const interests = sample(rng, INTERESTS, randomInt(rng, 1, 3));
	const minTeamSize = randomInt(rng, 2, 3);

	// Parse so a bug in the generator fails loudly instead of producing a bad profile.
	return Profile.parse({
		id,
		name: pick(rng, FIRST_NAMES),
		skills: skillNames.map((name) => ({
			name,
			level: pick(rng, SkillLevel.options),
		})),
		interests,
		projectIdeas: Array.from({ length: randomInt(rng, 0, 2) }, () => {
			const interest = pick(rng, interests);
			const format = pick(rng, PROJECT_FORMATS);
			return {
				title: `${capitalize(interest)} ${format}`,
				description: `A ${format} for people who care about ${interest}.`,
			};
		}),
		availability: {
			hoursPerWeek: randomInt(rng, 5, 40),
			utcOffset: pick(rng, UTC_OFFSETS),
		},
		preferences: {
			minTeamSize,
			maxTeamSize: randomInt(rng, minTeamSize, 5),
			// People prefer roles they actually have skills for.
			preferredRoles: sample(rng, skillNames, 1),
		},
	});
}

// Uppercases the first letter, for project titles like "Climate app".
function capitalize(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}
