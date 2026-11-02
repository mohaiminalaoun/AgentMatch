import { useId, type CSSProperties } from "react";
export type Mood = "idle" | "pitching" | "declining" | "matched";
export function AgentCharacter({
	color = "#28bbae",
	muse = false,
	level = 0,
	mood = "idle",
	sprout = false,
	badge,
	width = 120,
	height = 150,
	x,
	y,
}: {
	color?: string;
	muse?: boolean;
	level?: number;
	mood?: Mood;
	sprout?: boolean;
	badge?: string;
	width?: number;
	height?: number;
	x?: number;
	y?: number;
}) {
	const id = useId();
	const gradient = id.replaceAll(":", "");
	const timing = characterTiming(id);
	return (
		<svg
			viewBox="0 0 160 200"
			width={width}
			height={height}
			x={x}
			y={y}
			className={`agent-character mood-${mood}`}
			style={timing}
			aria-hidden="true"
		>
			<defs>
				<linearGradient
					id={gradient}
					x1="0"
					y1="0"
					x2=".9"
					y2="1"
					gradientUnits="objectBoundingBox"
				>
					<stop stopColor={color} />
					<stop
						offset="1"
						stopColor={`color-mix(in srgb, ${color} 82%, #173b44)`}
					/>
				</linearGradient>
			</defs>
			<ellipse
				className="character-shadow"
				cx="80"
				cy="184"
				rx="51"
				ry="8"
				fill="#33345a"
				opacity=".13"
			/>
			<g className="character-gesture">
				<g className="character-body">
					{muse ? (
						<MuseBody />
					) : (
						<>
							{sprout && (
								<g className="character-sprout">
									<path
										d="M80 37 Q79 13 92 5"
										fill="none"
										stroke="#45956b"
										strokeWidth="4"
										strokeLinecap="round"
									/>
									<ellipse
										cx="95"
										cy="7"
										rx="13"
										ry="6"
										transform="rotate(-27 95 7)"
										fill="#7ed797"
									/>
								</g>
							)}
							<g transform="translate(29 101)">
								<g transform="rotate(20)">
									<ellipse
										cy="14"
										rx="12"
										ry="22"
										fill={color}
									/>
									<ellipse
										cy="14"
										rx="12"
										ry="22"
										fill="#143e48"
										opacity=".18"
									/>
								</g>
							</g>
							<g transform="translate(131 101)">
								<g className="character-wave-pivot">
									<g transform="rotate(-20)">
										<ellipse
											cy="14"
											rx="12"
											ry="22"
											fill={color}
										/>
										<ellipse
											cy="14"
											rx="12"
											ry="22"
											fill="#143e48"
											opacity=".18"
										/>
									</g>
								</g>
							</g>
							<g fill={color}>
								<ellipse cx="59" cy="173" rx="13" ry="11" />
								<ellipse cx="101" cy="173" rx="13" ry="11" />
							</g>
							<rect
								x="27"
								y="32"
								width="106"
								height="142"
								rx="53"
								fill={`url(#${gradient})`}
							/>
							<ellipse
								cx="48"
								cy="52"
								rx="9"
								ry="16"
								transform="rotate(32 48 52)"
								fill="white"
								opacity=".4"
							/>
							<g className="character-eyes">
								<ellipse
									cx="64"
									cy="82"
									rx="7"
									ry={mood === "matched" ? 6 : 7}
									fill="#172b3c"
								/>
								<ellipse
									cx="96"
									cy="82"
									rx="7"
									ry={mood === "matched" ? 6 : 7}
									fill="#172b3c"
								/>
								<circle cx="66" cy="79" r="2.4" fill="white" />
								<circle cx="98" cy="79" r="2.4" fill="white" />
							</g>
							{mood === "matched" && (
								<>
									<ellipse
										cx="51"
										cy="98"
										rx="7"
										ry="4"
										fill="#ffdad4"
										opacity=".55"
									/>
									<ellipse
										cx="109"
										cy="98"
										rx="7"
										ry="4"
										fill="#ffdad4"
										opacity=".55"
									/>
									<path
										d="M75 99 Q80 105 85 99"
										fill="none"
										stroke="#17404a"
										strokeWidth="2"
										strokeLinecap="round"
									/>
								</>
							)}
							<rect
								x="51"
								y="119"
								width="58"
								height="30"
								rx="15"
								fill="#163b46"
								opacity=".35"
							/>
							{[0, 1, 2].map((i) => (
								<circle
									key={i}
									cx={65 + i * 15}
									cy="134"
									r="5.3"
									fill="white"
									opacity={i < level ? 1 : 0.3}
								/>
							))}
						</>
					)}
					{muse && (
						<text
							x="80"
							y="151"
							textAnchor="middle"
							fill="#65553e"
							fontSize="12"
							fontWeight="600"
						>
							Muse
						</text>
					)}
					{!muse && badge && (
						<g>
							<circle
								cx="111"
								cy="113"
								r="16"
								fill="#fff"
								stroke="#518ce2"
								strokeWidth="4"
							/>
							<text
								x="111"
								y="118"
								textAnchor="middle"
								fill="#243247"
								fontSize="14"
								fontWeight="600"
							>
								{badge}
							</text>
						</g>
					)}
				</g>
			</g>
			{mood === "matched" && (
				<g className="character-sparks" fill="#f5a524">
					<path
						className="character-spark"
						d={SPARK}
						transform="translate(124 34) scale(1.5)"
					/>
					<path
						className="character-spark"
						d={SPARK}
						transform="translate(14 54) scale(1.1)"
					/>
				</g>
			)}
		</svg>
	);
}

const SPARK = "M8 0 Q9 7 16 8 Q9 9 8 16 Q7 9 0 8 Q7 7 8 0 Z";

/**
 * Per-character timing, so a row (or a whole network) of characters never
 * breathes, blinks, or gestures in step. Derived from the instance id, so it
 * is stable across renders.
 */
function characterTiming(id: string): CSSProperties {
	let hash = 0;
	for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
	// Mix the bits, so ids that differ in one character spread out.
	hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0;
	hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0;
	const pick = (salt: number, min: number, max: number) =>
		min + (((hash >>> salt) % 1000) / 1000) * (max - min);
	return {
		"--breath-duration": `${pick(0, 3.2, 4.4).toFixed(2)}s`,
		"--blink-duration": `${pick(3, 5, 7.5).toFixed(2)}s`,
		"--gesture-duration": `${pick(6, 2.6, 3.4).toFixed(2)}s`,
		"--motion-delay": `${(-pick(9, 0, 4)).toFixed(2)}s`,
	} as CSSProperties;
}

// Simplified vector interpretation of Muse's default Hatch character.
// Reference: https://muse.ai/images/landing/brand/hatch.jpg
function MuseBody() {
	return (
		<g>
			<g fill="#ded0b4" stroke="#c7b899" strokeWidth="1.5">
				<ellipse
					cx="28"
					cy="133"
					rx="13"
					ry="30"
					transform="rotate(22 28 133)"
				/>
				{/* Animate around the shoulder, using the same local origin as the other characters. */}
				<g transform="translate(128 110)">
					<g className="character-wave-pivot">
						<g transform="rotate(-22)">
							<ellipse cy="23" rx="13" ry="30" />
						</g>
					</g>
				</g>
				<ellipse cx="58" cy="174" rx="18" ry="11" />
				<ellipse cx="102" cy="174" rx="18" ry="11" />
			</g>
			<path
				d="M80 24 C43 24 27 46 27 79 L24 137 Q22 177 80 178 Q138 177 136 137 L133 79 C133 46 117 24 80 24Z"
				fill="#eee3cb"
				stroke="#d3c3a5"
				strokeWidth="2"
			/>
			<path
				d="M80 44 C51 44 39 59 39 82 Q37 110 55 115 Q80 123 105 115 Q123 110 121 82 C121 59 109 44 80 44Z"
				fill="#f8e6bf"
				stroke="#d6c09a"
				strokeWidth="2"
			/>
			<path
				d="M35 64 Q40 37 68 33 M91 33 Q117 37 125 62 M32 118 l5 8 m5 -2 l5 9 m5 -5 l5 10 m46 -10 l-5 10 m15 -14 l-5 10 m14 -15 l-4 9"
				fill="none"
				stroke="#fff7e5"
				strokeWidth="3"
				strokeLinecap="round"
			/>
			<g className="character-eyes" fill="#29221d">
				<ellipse cx="61" cy="81" rx="5.5" ry="6.5" />
				<ellipse cx="99" cy="81" rx="5.5" ry="6.5" />
				<g fill="white" opacity=".8">
					<circle cx="63" cy="78" r="1.8" />
					<circle cx="101" cy="78" r="1.8" />
				</g>
			</g>
			<g fill="#edb89c" opacity=".4">
				<ellipse cx="52" cy="94" rx="8" ry="4" />
				<ellipse cx="108" cy="94" rx="8" ry="4" />
			</g>
			<path
				d="M73 94 Q80 101 87 94"
				fill="none"
				stroke="#59432d"
				strokeWidth="2"
				strokeLinecap="round"
			/>
		</g>
	);
}
