import { describe, expect, test } from "vitest";
import type { AgentMessage } from "../../src/engine/agent.js";
import { BusError, createBus, type BusEvent } from "../../src/engine/bus.js";
import {
	STANDARD_REFUSAL,
	type Proposal,
	type ProposalResponse,
} from "../../src/engine/proposal.js";

const proposal: Proposal = {
	id: "prop-1",
	from: "a",
	to: "ben",
	pitch: "A web app startup that helps freelancers send invoices.",
	rolesNeeded: ["frontend", "backend"],
};

const decline: ProposalResponse = {
	decision: "decline",
	reason: STANDARD_REFUSAL,
	proposalId: "prop-1",
	from: "ben",
	to: "a",
};

// A bus for agents a, ben, and kemi, plus a list that records every event it reports.
function setup() {
	const bus = createBus(["a", "ben", "kemi"]);
	const events: BusEvent[] = [];
	bus.subscribe((event) => events.push(event));
	return { bus, events };
}

describe("sending and receiving", () => {
	test("a message lands in its recipient's inbox, and only theirs", () => {
		const { bus } = setup();
		bus.send("a", proposal);
		expect(bus.receive("kemi")).toEqual([]);
		expect(bus.receive("ben")).toEqual([proposal]);
	});

	test("receiving empties the inbox", () => {
		const { bus } = setup();
		bus.send("a", proposal);
		bus.receive("ben");
		expect(bus.receive("ben")).toEqual([]);
	});

	test("messages come out in the order they were sent", () => {
		const { bus } = setup();
		const second = { ...proposal, id: "prop-2" };
		bus.send("a", proposal);
		bus.send("a", second);
		expect(bus.receive("ben").map((m) => (m as Proposal).id)).toEqual([
			"prop-1",
			"prop-2",
		]);
	});

	test("a full exchange: proposal there, decline back", () => {
		const { bus } = setup();
		bus.send("a", proposal);
		expect(bus.receive("ben")).toEqual([proposal]);
		bus.send("ben", decline);
		expect(bus.receive("a")).toEqual([decline]);
	});
});

describe("checks", () => {
	test("an agent can't send as someone else", () => {
		const { bus } = setup();
		expect(() => bus.send("kemi", proposal)).toThrow(BusError);
		expect(() => bus.send("kemi", proposal)).toThrow(
			"kemi tried to send a message marked as from a",
		);
		expect(bus.receive("ben")).toEqual([]);
	});

	test("an unknown recipient is rejected", () => {
		const { bus } = setup();
		expect(() => bus.send("a", { ...proposal, to: "nobody" })).toThrow(
			"unknown recipient nobody",
		);
	});

	test("an unknown sender is rejected", () => {
		const { bus } = setup();
		expect(() => bus.send("ghost", { ...proposal, from: "ghost" })).toThrow(
			"unknown sender ghost",
		);
	});

	test("an agent can't message itself", () => {
		const { bus } = setup();
		expect(() => bus.send("a", { ...proposal, to: "a" })).toThrow(
			"to itself",
		);
	});

	test("a decline with anything but the standard refusal is rejected", () => {
		const { bus } = setup();
		const leaky = {
			...decline,
			reason: "My human wants climate work.",
		} as unknown as AgentMessage;
		expect(() => bus.send("ben", leaky)).toThrow(
			"invalid message from ben",
		);
		expect(bus.receive("a")).toEqual([]);
	});

	test("a malformed proposal is rejected", () => {
		const { bus } = setup();
		expect(() => bus.send("a", { ...proposal, pitch: "" })).toThrow(
			"invalid message from a: pitch",
		);
	});

	test("asking for an unknown agent's inbox is an error", () => {
		const { bus } = setup();
		expect(() => bus.receive("nobody")).toThrow(BusError);
	});
});

describe("events", () => {
	test("every send is reported, numbered in order", () => {
		const { bus, events } = setup();
		bus.send("a", proposal);
		bus.send("ben", decline);
		expect(events).toMatchObject([
			{ seq: 1, type: "sent", message: proposal },
			{ seq: 2, type: "sent", message: decline },
		]);
		expect(new Date(events[0]!.time).toString()).not.toBe("Invalid Date");
	});

	test("rejections are reported too, in the same numbering", () => {
		const { bus, events } = setup();
		bus.send("a", proposal);
		expect(() => bus.send("kemi", proposal)).toThrow();
		expect(events.map((e) => [e.seq, e.type])).toEqual([
			[1, "sent"],
			[2, "rejected"],
		]);
		expect(events[1]).toMatchObject({
			from: "kemi",
			reason: "kemi tried to send a message marked as from a",
		});
	});

	test("unsubscribing stops the events", () => {
		const bus = createBus(["a", "ben"]);
		const events: BusEvent[] = [];
		const stop = bus.subscribe((event) => events.push(event));
		bus.send("a", proposal);
		stop();
		bus.send("a", { ...proposal, id: "prop-2" });
		expect(events).toHaveLength(1);
	});
});

describe("copies", () => {
	test("changing a received message doesn't change the logged event", () => {
		const { bus, events } = setup();
		bus.send("a", proposal);
		const [received] = bus.receive("ben") as Proposal[];
		received!.pitch = "Changed by the receiver";
		const sent = events[0] as Extract<BusEvent, { type: "sent" }>;
		expect((sent.message as Proposal).pitch).toBe(proposal.pitch);
	});

	test("changing the original after sending doesn't change what was delivered", () => {
		const { bus } = setup();
		const original = { ...proposal };
		bus.send("a", original);
		original.pitch = "Changed by the sender";
		expect((bus.receive("ben")[0] as Proposal).pitch).toBe(proposal.pitch);
	});
});
