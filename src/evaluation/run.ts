// Entry point for `npm run eval`: compares every matching method and prints a table.
import { BASELINES, evaluate, formatTable } from "./evaluate.js";

const SEEDS = [1, 2, 3, 4, 5];
const PEOPLE = 40;
const TEAM_SIZE = 3;

console.log(
	`${PEOPLE} people · teams of ${TEAM_SIZE} · seeds ${SEEDS.join(", ")}\n`,
);
console.log(
	formatTable(
		evaluate(BASELINES, {
			seeds: SEEDS,
			people: PEOPLE,
			teamSize: TEAM_SIZE,
		}),
	),
);
