import { useState } from 'react';
import { useRun, useSnapshot } from '../../app/data';
import { useSession } from '../../auth/session';
import { DecimalInput, Field, Loading } from '../../ui/controls';
import { Sheet } from '../../ui/Sheet';
import { money, num, parseDecimal } from '../../domain/format';
import { potBalance } from '../../domain/budget';
import type { Member } from '../../domain/schemas';
import { SettingsPage } from './common';

const COLORS = ['#1F4FA8', '#E8B030', '#2E7D5B', '#B3261E', '#7A4FB0', '#566070'];

export function HouseholdSettings() {
  const { snap } = useSnapshot();
  const { run } = useRun();
  const [target, setTarget] = useState<string | null>(null);
  const [editing, setEditing] = useState<Member | null>(null);
  if (!snap) return <Loading />;
  const h = snap.household;
  const years = Object.values(snap.budgets).sort((a, b) => a.year - b.year);
  const opening = years[0]?.openingBalance ?? 0;
  const t = target ?? num(h.monthlyTarget);
  const v = parseDecimal(t);

  return (
    <SettingsPage title="People and budget" hint="Shared settings for both of you.">
      <form
        className="card card-pad stack-lg"
        style={{ gap: 12 }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            v >= 0 &&
            (await run('setMonthlyTarget', { amount: v }, { toast: `Monthly target set to ${money(v)}` }))
          )
            setTarget(null);
        }}
      >
        <Field
          label="Monthly spending target, in lei"
          hint="A guide, not a limit. Spending over it is allowed and shown clearly."
        >
          <DecimalInput value={t} onChange={(e) => setTarget(e.target.value)} />
        </Field>
        <button
          type="submit"
          className="btn btn-primary btn-md"
          disabled={!(v >= 0) || v === h.monthlyTarget}
        >
          Save target
        </button>
        <span className="small muted">
          The pot started with {money(opening)} when you set up the app. It holds {money(potBalance(years))}{' '}
          now. To correct the balance, use a pot adjustment in Budget.
        </span>
      </form>
      <h2 className="group-title">People</h2>
      <div className="list">
        {h.members.map((m) => (
          <button key={m.email} type="button" className="list-row" onClick={() => setEditing(m)}>
            <span className="dot" style={{ width: 14, height: 14, borderRadius: 7, background: m.color }} />
            <span className="grow stack" style={{ gap: 0 }}>
              <span className="title">{m.name}</span>
              <span className="sub">{m.email}</span>
            </span>
            <span className="small" style={{ color: 'var(--cobalt)', fontWeight: 700 }}>
              Edit
            </span>
          </button>
        ))}
      </div>
      <p className="small muted">
        People come from Google sign-in. Each of you keeps your own Gemini key on your own phone.
      </p>
      {editing && <MemberSheet member={editing} onClose={() => setEditing(null)} />}
    </SettingsPage>
  );
}

function MemberSheet({ member, onClose }: { member: Member; onClose: () => void }) {
  const { run } = useRun();
  const [name, setName] = useState(member.name);
  const [color, setColor] = useState(member.color);
  return (
    <Sheet onClose={onClose} title={`Edit ${member.name}`} labelledBy="mem-title">
      <Field label="Name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="stack-sm">
        <span className="bold" style={{ fontSize: 15 }}>
          Colour in charts and history
        </span>
        <div className="wrap" role="radiogroup" aria-label="Colour">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={c}
              onClick={() => setColor(c)}
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                background: c,
                border: color === c ? '3px solid var(--ink)' : '3px solid transparent',
                boxShadow: 'inset 0 0 0 2px var(--surface)',
              }}
            />
          ))}
        </div>
      </div>
      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={!name.trim()}
        onClick={async () => {
          if (await run('updateMember', { ...member, name: name.trim(), color }, { toast: 'Saved' }))
            onClose();
        }}
      >
        Save
      </button>
    </Sheet>
  );
}

/** Per-device settings: Gemini key and model, voice, household folder, sign out. Filled in further in Phases 6-7b. */
export function DeviceSettings({ children }: { children?: React.ReactNode }) {
  const session = useSession();
  return (
    <SettingsPage title="This phone" hint="These settings stay on this phone only.">
      {children}
      {session.mode === 'mock' && <MockUserSwitch />}
      <h2 className="group-title">Account</h2>
      <div className="card card-pad stack" style={{ gap: 10 }}>
        <span className="small muted">Signed in as {session.email}</span>
        <button type="button" className="btn btn-danger btn-md" onClick={session.signOut}>
          Sign out of this phone
        </button>
        <span className="small muted">
          Signing out removes the household link, your Gemini key and the assistant conversation from this
          phone.
        </span>
      </div>
    </SettingsPage>
  );
}

function MockUserSwitch() {
  const { snap } = useSnapshot();
  const session = useSession();
  if (!snap || !session.switchUser) return null;
  return (
    <>
      <h2 className="group-title">Sample data</h2>
      <div className="card card-pad stack" style={{ gap: 10 }}>
        <span className="small muted">
          You're using sample data. Switch person to see how the app looks for the other one.
        </span>
        <div className="grid-2">
          {snap.household.members.map((m) => (
            <button
              key={m.email}
              type="button"
              className="choice"
              aria-pressed={session.email === m.email}
              onClick={() => session.switchUser!(m.email)}
            >
              {m.name}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
