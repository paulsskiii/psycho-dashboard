"use client";

import { useActionState, useState } from "react";

import { StatusMark } from "@/components/ui/StatusMark";
import type { Config, GoalsJson, Template } from "@/lib/data/settings";
import type { Race } from "@/lib/data/today";
import * as f from "@/lib/format";
import { DAYS, SESSIONS, type SessionKey } from "@/lib/sessions";

import { requestRecompute, saveExpiry, saveGoals, saveHeartRate, saveTemplate, type FormState } from "./actions";
import st from "./settings.module.css";

function Result({ state }: { state: FormState }) {
  if (state.error) return <p className={st.error} role="alert">{state.error}</p>;
  if (state.ok) return <p className={st.ok} role="status">{state.ok}</p>;
  return null;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className={st.field}>
      <span className={st.label}>{label}</span>
      {children}
      {hint ? <span className={st.hint}>{hint}</span> : null}
    </label>
  );
}

/* ---------------------------------------------------------------- heart rate */

export function HeartRateForm({ config, autoRest, recomputeQueued }: { config: Config | null; autoRest: number | null; recomputeQueued: boolean }) {
  const [state, action, pending] = useActionState(saveHeartRate, {});
  const [rState, rAction, rPending] = useActionState(requestRecompute, {});
  const floors = config?.hr_zones?.floors ?? [];
  const maxHr = config?.max_hr ?? config?.hr_zones?.max_hr ?? null;
  const defBand = floors.length === 5 ? [Math.ceil((floors[1]! + floors[2]!) / 2), floors[2]! - 1] : null;
  return (
    <>
      <form action={action} className={st.form}>
        <div className={st.row}>
          <Field label="Max heart rate" hint="From Garmin's zones unless you change it.">
            <input className={st.input} name="max_hr" inputMode="numeric" defaultValue={maxHr ?? ""} required />
          </Field>
          <Field label="Resting heart rate" hint={`Blank uses your 7-day median${autoRest ? ` (now ${autoRest})` : ""}.`}>
            <input className={st.input} name="rest_hr_override" inputMode="numeric" defaultValue={config?.rest_hr_override ?? ""} placeholder={autoRest ? `Auto, ${autoRest}` : "Auto"} />
          </Field>
          <Field label="Threshold heart rate" hint={floors[4] ? `Blank uses Garmin's zone 5 floor (${floors[4]}).` : "Blank uses 89 % of max."}>
            <input className={st.input} name="lthr" inputMode="numeric" defaultValue={config?.lthr ?? ""} placeholder={floors[4] ? String(floors[4]) : ""} />
          </Field>
        </div>
        <fieldset className={st.fieldset}>
          <legend className={st.label}>Pace-at-heart-rate band</legend>
          <div className={st.row}>
            <Field label="From">
              <input className={st.input} name="z2_lo" inputMode="numeric" defaultValue={config?.z2_band?.[0] ?? ""} placeholder={defBand ? String(defBand[0]) : ""} />
            </Field>
            <Field label="To">
              <input className={st.input} name="z2_hi" inputMode="numeric" defaultValue={config?.z2_band?.[1] ?? ""} placeholder={defBand ? String(defBand[1]) : ""} />
            </Field>
          </div>
          <span className={st.hint}>Blank uses the upper half of Garmin zone 2{defBand ? ` (${defBand[0]}–${defBand[1]} bpm)` : ""}.</span>
        </fieldset>
        {floors.length === 5 ? (
          <p className={st.hint}>
            Garmin zones: {floors.map((lo, i) => `Z${i + 1} ${lo}${i < 4 ? `–${floors[i + 1]! - 1}` : "+"}`).join(" · ")} bpm. Change them on the watch or in Garmin Connect.
          </p>
        ) : null}
        <div className={st.actions}>
          <button className={st.button} type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </button>
          <Result state={state} />
        </div>
      </form>
      <form action={rAction} className={st.actions}>
        <button className={st.buttonQuiet} type="submit" disabled={rPending || recomputeQueued}>
          {recomputeQueued ? "Recompute queued" : rPending ? "Queuing…" : "Recompute history"}
        </button>
        <span className={st.hint}>Re-scores every activity with these numbers. Runs overnight.</span>
        <Result state={rState} />
      </form>
    </>
  );
}

/* ---------------------------------------------------------------- keys */

function Expiry({ label, name, value, renew, today }: { label: string; name: string; value: string | null; renew: string; today: string }) {
  const [v, setV] = useState(value ? f.toDate(value).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }) : "");
  const days = v ? Math.round((+f.toDate(v) - +f.toDate(today)) / 86400e3) : null;
  return (
    <Field label={label} hint={renew}>
      <input className={st.input} type="date" name={name} value={v} onChange={(e) => setV(e.target.value)} />
      {days != null ? (
        <span className={st.hint}>
          <StatusMark
            kind={days < 0 ? "serious" : days <= 14 ? "warning" : "good"}
            label={days < 0 ? `Expired ${-days} ${days === -1 ? "day" : "days"} ago` : days === 0 ? "Expires today" : `${days} ${days === 1 ? "day" : "days"} left`}
          />
        </span>
      ) : (
        <span className={st.hint}>
          <StatusMark kind="none" label="Not set" />
        </span>
      )}
    </Field>
  );
}

export function ExpiryForm({ apiKey, github, today }: { apiKey: string | null; github: string | null; today: string }) {
  const [state, action, pending] = useActionState(saveExpiry, {});
  return (
    <form action={action} className={st.form}>
      <Expiry label="Garmin Personal API key" name="personal_api_key_expires_at" today={today} value={apiKey} renew="Renew in the Garmin developer portal, then update the GitHub secret (SETUP.md)." />
      <Expiry label="GitHub dispatch token" name="github_token_expires_at" today={today} value={github} renew="Used by Sync now. Renew in GitHub → Settings → Developer settings." />
      <div className={st.actions}>
        <button className={st.button} type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save dates"}
        </button>
        <Result state={state} />
      </div>
    </form>
  );
}

/* ---------------------------------------------------------------- week */

export function TemplateForm({ template }: { template: Template }) {
  const [state, action, pending] = useActionState(saveTemplate, {});
  return (
    <form action={action} className={st.form}>
      {DAYS.map(([key, label]) => (
        <fieldset key={key} className={st.day}>
          <legend className={st.dayLabel}>{label}</legend>
          <div className={st.chips}>
            {(Object.keys(SESSIONS) as SessionKey[]).map((sk) => (
              <label key={sk} className={st.chip}>
                <input type="checkbox" name={key} value={sk} defaultChecked={template[key]?.includes(sk)} />
                <span>{SESSIONS[sk]}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <div className={st.actions}>
        <button className={st.button} type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save week"}
        </button>
        <Result state={state} />
      </div>
    </form>
  );
}

/* ---------------------------------------------------------------- goals */

/** "1:59:30" or "59:30" → seconds; blank → null; anything else → NaN (caught on save). */
function parseTime(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  if (!/^\d{1,2}(:\d{1,2}){1,2}$/.test(t)) return NaN;
  return t.split(":").reduce((a, p) => a * 60 + Number(p), 0);
}

const PRESETS = [
  { label: "5K", km: 5 },
  { label: "10K", km: 10 },
  { label: "Half", km: 21.0975 },
  { label: "Marathon", km: 42.195 },
];

type RaceDraft = { name: string; date: string; sport: string; km: string; goal: string; priority: string };
type LongDraft = { label: string; goal: string };

export function GoalsForm({ goals }: { goals: GoalsJson }) {
  const [state, action, pending] = useActionState(saveGoals, {});
  const [races, setRaces] = useState<RaceDraft[]>(
    goals.races.map((r) => ({
      name: r.name,
      date: r.date ?? "",
      sport: r.sport,
      km: r.distance_m ? String(r.distance_m / 1000) : "",
      goal: r.goal_s ? f.duration(r.goal_s) : "",
      priority: r.priority,
    })),
  );
  const [longTerm, setLongTerm] = useState<LongDraft[]>((goals.long_term ?? []).map((g) => ({ label: g.label, goal: g.goal_s ? f.duration(g.goal_s) : "" })));
  const [weight, setWeight] = useState(goals.target_weight_kg != null ? String(goals.target_weight_kg) : "");
  const [localError, setLocalError] = useState<string | null>(null);

  const setRace = (i: number, patch: Partial<RaceDraft>) => setRaces((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  // Serialised for the server action; a bad time becomes a local error before submit.
  const out = (() => {
    const rs: Race[] = [];
    for (const r of races) {
      const goal = parseTime(r.goal);
      if (Number.isNaN(goal)) return { error: `Goal time for ${r.name || "a race"} should look like 1:59:30.` };
      const km = r.km.trim() ? Number(r.km) : null;
      if (km != null && !(km > 0)) return { error: `Distance for ${r.name || "a race"} should be in km, like 21.1.` };
      rs.push({ name: r.name, date: r.date || null, sport: r.sport || "run", distance_m: km == null ? null : Math.round(km * 1000 * 10) / 10, goal_s: goal, priority: r.priority });
    }
    const lt = [];
    for (const g of longTerm) {
      const goal = parseTime(g.goal);
      if (Number.isNaN(goal)) return { error: `Goal time for ${g.label || "a long-term goal"} should look like 3:59:00.` };
      lt.push({ label: g.label, goal_s: goal });
    }
    const w = weight.trim() ? Number(weight) : null;
    if (w != null && Number.isNaN(w)) return { error: "Target weight should be a number in kg." };
    return { json: JSON.stringify({ races: rs, long_term: lt, target_weight_kg: w }) };
  })();

  return (
    <form
      action={action}
      className={st.form}
      onSubmit={(e) => {
        if ("error" in out) {
          e.preventDefault();
          setLocalError(out.error ?? null);
        } else setLocalError(null);
      }}
    >
      <input type="hidden" name="goals" value={"json" in out ? out.json : ""} />
      <h3 className={st.h3}>Races</h3>
      <ol className={st.races}>
        {races.map((r, i) => (
          <li key={i} className={st.race}>
            <Field label="Name">
              <input className={st.input} value={r.name} onChange={(e) => setRace(i, { name: e.target.value })} required maxLength={80} />
            </Field>
            <div className={st.row}>
              <Field label="Date">
                <input className={st.input} type="date" value={r.date} onChange={(e) => setRace(i, { date: e.target.value })} />
              </Field>
              <Field label="Distance, km">
                <input className={st.input} inputMode="decimal" value={r.km} onChange={(e) => setRace(i, { km: e.target.value })} list="race-distances" />
              </Field>
              <Field label="Goal time">
                <input className={st.input} value={r.goal} onChange={(e) => setRace(i, { goal: e.target.value })} placeholder="1:59:30" />
              </Field>
              <Field label="Priority">
                <select className={st.input} value={r.priority} onChange={(e) => setRace(i, { priority: e.target.value })}>
                  <option value="A">A</option>
                  <option value="B">B</option>
                  <option value="C">C</option>
                </select>
              </Field>
            </div>
            <button type="button" className={st.link} onClick={() => setRaces((rs) => rs.filter((_, j) => j !== i))}>
              Remove {r.name || "race"}
            </button>
          </li>
        ))}
      </ol>
      <datalist id="race-distances">
        {PRESETS.map((p) => (
          <option key={p.label} value={p.km} label={p.label} />
        ))}
      </datalist>
      <button type="button" className={st.buttonQuiet} onClick={() => setRaces((rs) => [...rs, { name: "", date: "", sport: "run", km: "", goal: "", priority: "A" }])}>
        Add a race
      </button>

      <h3 className={st.h3}>Long-term goals</h3>
      <ol className={st.races}>
        {longTerm.map((g, i) => (
          <li key={i} className={st.race}>
            <div className={st.row}>
              <Field label="Goal">
                <input className={st.input} value={g.label} onChange={(e) => setLongTerm((ls) => ls.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} maxLength={80} />
              </Field>
              <Field label="Time">
                <input className={st.input} value={g.goal} onChange={(e) => setLongTerm((ls) => ls.map((x, j) => (j === i ? { ...x, goal: e.target.value } : x)))} placeholder="3:59:00" />
              </Field>
            </div>
            <button type="button" className={st.link} onClick={() => setLongTerm((ls) => ls.filter((_, j) => j !== i))}>
              Remove {g.label || "goal"}
            </button>
          </li>
        ))}
      </ol>
      <button type="button" className={st.buttonQuiet} onClick={() => setLongTerm((ls) => [...ls, { label: "", goal: "" }])}>
        Add a long-term goal
      </button>

      <h3 className={st.h3}>Body</h3>
      <div className={st.row}>
        <Field label="Target weight, kg">
          <input className={st.input} inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />
        </Field>
      </div>

      <div className={st.actions}>
        <button className={st.button} type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save goals"}
        </button>
        {localError ? (
          <p className={st.error} role="alert">
            {localError}
          </p>
        ) : (
          <Result state={state} />
        )}
      </div>
    </form>
  );
}
