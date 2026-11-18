// Weekly-template session keys: the ones the readiness phrase table understands
// (worker psycho_worker/metrics/readiness.py). Labels for the UI.
export const SESSIONS = {
  easy_run: "Easy run",
  tempo: "Tempo",
  intervals: "Intervals",
  long_run_or_rest: "Long run or rest",
  gym_upper: "Gym, upper",
  gym_legs: "Gym, legs",
  prehab: "Prehab",
} as const;
export type SessionKey = keyof typeof SESSIONS;
export const DAYS = [
  ["mon", "Mon"],
  ["tue", "Tue"],
  ["wed", "Wed"],
  ["thu", "Thu"],
  ["fri", "Fri"],
  ["sat", "Sat"],
  ["sun", "Sun"],
] as const;
