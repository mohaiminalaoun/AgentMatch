import { useId } from "react";
export type Mood = "idle" | "pitching" | "declining" | "matched";
export function AgentCharacter({
	color = "#28bbae",
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
	level?: number;
	mood?: Mood;
	sprout?: boolean;
	badge?: string;
	width?: number;
	height?: number;
	x?: number;
	y?: number;
}) {
	const gradient = useId().replaceAll(":", "");
	return (
		<svg
			viewBox="0 0 160 200"
			width={width}
			height={height}
			x={x}
			y={y}
			className={`agent-character mood-${mood}`}
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
			<g className="character-body">
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
						<ellipse cy="14" rx="12" ry="22" fill={color} />
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
							<ellipse cy="14" rx="12" ry="22" fill={color} />
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
				{badge && (
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
		</svg>
	);
}
