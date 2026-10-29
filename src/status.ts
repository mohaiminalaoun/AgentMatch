// A status line kept at the bottom of the terminal, redrawn every second, so a slow model call never looks
// like a hang. Only on a terminal: piped output gets just the printed lines. `detail`, if given, is added
// after the counts on every redraw.
export function createStatus(started: number, detail?: () => string) {
	const live = process.stdout.isTTY;
	let calls = 0;
	let tokens = 0;
	const elapsed = () => {
		const s = Math.floor((performance.now() - started) / 1000);
		return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
	};
	const draw = () =>
		live &&
		process.stdout.write(
			`\r\x1b[2K  ⋯ ${calls} model calls done · ${tokens.toLocaleString()} tokens${detail ? ` · ${detail()}` : ""} · ${elapsed()}`,
		);
	const clear = () => live && process.stdout.write("\r\x1b[2K");
	const timer = setInterval(draw, 1000);
	return {
		// Counts one finished model call.
		call(used: number) {
			calls++;
			tokens += used;
			draw();
		},
		// Prints `line` above the status line.
		print(line: string) {
			clear();
			console.log(line);
			draw();
		},
		stop() {
			clearInterval(timer);
			clear();
		},
	};
}
