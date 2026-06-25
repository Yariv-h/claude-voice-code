// Pure turn-taking state machine. No I/O — given a state and an event, it
// returns the next state plus side-effects for the gateway to perform. This is
// where barge-in lives, and it's exhaustively unit-tested.

export type ActiveState = "idle" | "listening" | "thinking" | "speaking";

export type VoiceEvent =
  | { type: "speechStart" }
  | { type: "finalTranscript"; text: string }
  | { type: "replyReady"; text: string }
  | { type: "ttsDone" };

export type GatewayEffect =
  | { type: "inject"; text: string } // send a turn to the agent
  | { type: "say"; text: string } // speak a reply
  | { type: "cancelTts" } // stop current playback + flush queued audio
  | { type: "interruptAgent" }; // Escape the agent (it's mid-work)

export interface Transition {
  state: ActiveState;
  effects: GatewayEffect[];
  /** True when this transition was caused by the user interrupting. */
  bargeIn: boolean;
}

function t(state: ActiveState, effects: GatewayEffect[] = [], bargeIn = false): Transition {
  return { state, effects, bargeIn };
}

export function reduce(state: ActiveState, ev: VoiceEvent): Transition {
  switch (ev.type) {
    case "speechStart":
      switch (state) {
        case "idle":
        case "listening":
          return t("listening");
        case "thinking":
          // User changed their mind while the agent works → interrupt + listen.
          return t("listening", [{ type: "interruptAgent" }], true);
        case "speaking":
          // Barge-in over the reply → stop talking + listen.
          return t("listening", [{ type: "cancelTts" }], true);
      }
      return t(state);

    case "finalTranscript":
      switch (state) {
        case "idle":
        case "listening":
          return t("thinking", [{ type: "inject", text: ev.text }]);
        case "speaking":
          // Full utterance arrived over the reply → cancel + send the new turn.
          return t("thinking", [{ type: "cancelTts" }, { type: "inject", text: ev.text }], true);
        case "thinking":
          // Ignore mid-think utterances so we never double-send a turn.
          return t("thinking");
      }
      return t(state);

    case "replyReady":
      // Only speak if still waiting; if the user barged in, drop the stale reply.
      return state === "thinking" ? t("speaking", [{ type: "say", text: ev.text }]) : t(state);

    case "ttsDone":
      return state === "speaking" ? t("idle") : t(state);
  }
}
