export type Limiter = {
	// Runs `task` once a slot is free; at most `limit` tasks run at once.
	run: <T>(task: () => Promise<T>) => Promise<T>;
	// Tasks running right now.
	readonly active: number;
	// Tasks waiting for a slot.
	readonly waiting: number;
};

// A concurrency limit (a semaphore): extra tasks wait in arrival order until a running one finishes.
export function createLimiter(limit: number): Limiter {
	if (!Number.isInteger(limit) || limit < 1) {
		throw new Error(`limit must be a positive integer, got ${limit}`);
	}
	let active = 0;
	const queue: (() => void)[] = [];

	return {
		run: async (task) => {
			if (active < limit) {
				active++;
			} else {
				// Wait until a finishing task hands its slot straight to us.
				await new Promise<void>((resolve) => queue.push(resolve));
			}
			try {
				return await task();
			} finally {
				const next = queue.shift();
				if (next) {
					// Hand the slot over without freeing it, so a newcomer can't grab it
					// in between and push the count over the limit.
					next();
				} else {
					active--;
				}
			}
		},
		get active() {
			return active;
		},
		get waiting() {
			return queue.length;
		},
	};
}
