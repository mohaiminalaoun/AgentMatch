// Returns a number in [0, 1), like Math.random().
export type Rng = () => number;

// Added to the state on every call. Being odd, it visits all 2^32 states before repeating.
const STEP = 0x6d2b79f5;
const UINT32_RANGE = 2 ** 32;

// Mulberry32: a tiny, fast generator whose whole state is one 32-bit number.
// The same seed always produces the same sequence.
export function createRng(seed: number): Rng {
	if (!Number.isInteger(seed)) {
		throw new Error(`seed must be an integer, got ${seed}`);
	}
	// `>>> 0` keeps values as unsigned 32-bit integers.
	let state = seed >>> 0;
	return () => {
		state = (state + STEP) >>> 0;
		// Scramble the bits. The shifts (15, 7, 14) and odd constants (1, 61) are
		// the published Mulberry32 values, tuned for good mixing. Don't change them;
		// the "known output" test catches it if you do.
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
	};
}
