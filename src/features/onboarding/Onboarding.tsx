import { useState, type ReactNode } from 'react';
import { DecimalInput, Field } from '../../ui/controls';
import { IconCheck } from '../../ui/icons';
import { googleConfigured } from '../../config';
import { parseDecimal, money } from '../../domain/format';
import type { GoogleAuth } from '../../auth/google';
import { DriveAdapter, driveFolderLink } from '../../storage/drive';
import { pickFilesIn, pickFolder } from '../../storage/picker';
import { prefs } from '../../app/prefs';
import { createHousehold, missingFiles } from './setup';

export function OnboardingFrame({ children }: { children: ReactNode }) {
  return (
    <div className="app" id="app-frame">
      <div className="rim" />
      <main className="page" style={{ paddingBottom: 40 }}>
        {children}
      </main>
    </div>
  );
}

function Brand({ sub }: { sub: string }) {
  return (
    <div className="stack" style={{ gap: 6, margin: '24px 0 28px' }}>
      <h1 className="h1" style={{ fontSize: 'var(--fs-title)' }}>
        Household
      </h1>
      <p className="muted" style={{ margin: 0, fontSize: 'var(--fs-label)' }}>
        {sub}
      </p>
    </div>
  );
}

export function SignInScreen({
  onSignIn,
  error,
  busy,
}: {
  onSignIn: () => void;
  error?: string | null;
  busy?: boolean;
}) {
  if (!googleConfigured())
    return (
      <OnboardingFrame>
        <Brand sub="Stock, recipes, shopping and a shared money pot for the two of you." />
        <div className="callout callout-saffron stack" style={{ gap: 8 }}>
          <span className="bold">This copy isn't connected to Google yet.</span>
          <span>
            Follow SETUP.md to add the Google client ID, Picker key and project number, then build again.
          </span>
        </div>
      </OnboardingFrame>
    );
  const returning = !!prefs.folderId();
  return (
    <OnboardingFrame>
      {/* the button sits at the bottom of the screen, where a thumb reaches it */}
      <div className="signin">
        <Brand sub="Stock, recipes, shopping and a shared money pot for the two of you." />
        <div className="stack-lg">
          <p className="small muted" style={{ margin: 0 }}>
            {returning
              ? 'Your household data stays in your Google Drive. Signing in again is needed each time the app starts, because the app never stores your Google sign-in on the phone.'
              : 'Your data stays in a folder in your own Google Drive, shared only with your partner. The app can only see the files it creates or that you pick.'}
          </p>
          {error && <p className="problem">{error}</p>}
          <button
            type="button"
            className="btn btn-primary btn-lg btn-block"
            onClick={onSignIn}
            disabled={busy}
          >
            {busy ? 'Signing in…' : 'Continue with Google'}
          </button>
        </div>
      </div>
    </OnboardingFrame>
  );
}

export function ChooseScreen({
  name,
  onCreate,
  onJoin,
}: {
  name: string;
  onCreate: () => void;
  onJoin: () => void;
}) {
  return (
    <OnboardingFrame>
      <Brand sub={`Hi ${name}. Is this the first phone, or is your partner already set up?`} />
      <div className="stack-lg">
        <button
          type="button"
          className="card card-pad stack"
          style={{ textAlign: 'left', gap: 4, cursor: 'pointer' }}
          onClick={onCreate}
        >
          <span className="display bold" style={{ fontSize: 'var(--fs-header)' }}>
            Create household
          </span>
          <span className="muted">I'm the first of us. Make the shared folder in my Google Drive.</span>
        </button>
        <button
          type="button"
          className="card card-pad stack"
          style={{ textAlign: 'left', gap: 4, cursor: 'pointer' }}
          onClick={onJoin}
        >
          <span className="display bold" style={{ fontSize: 'var(--fs-header)' }}>
            Join household
          </span>
          <span className="muted">My partner already made it and shared the folder with me.</span>
        </button>
      </div>
    </OnboardingFrame>
  );
}

export function CreateScreen({
  auth,
  onDone,
  onBack,
}: {
  auth: GoogleAuth;
  onDone: (folderId: string, partnerEmail: string) => void;
  onBack: () => void;
}) {
  const [f, setF] = useState({
    myName: auth.profile?.name ?? '',
    partnerName: '',
    partnerEmail: '',
    target: '',
    pot: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const target = f.target.trim() ? parseDecimal(f.target) : 0;
  const pot = f.pot.trim() ? parseDecimal(f.pot) : 0;
  const emailOk = !f.partnerEmail.trim() || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.partnerEmail.trim());
  const problem = !f.myName.trim()
    ? 'Add your name'
    : !f.partnerName.trim()
      ? "Add your partner's name"
      : !emailOk
        ? "That email doesn't look right"
        : Number.isNaN(target) || target < 0
          ? 'Enter the monthly target as a number'
          : Number.isNaN(pot)
            ? 'Enter how much is in the pot as a number'
            : null;
  return (
    <OnboardingFrame>
      <button type="button" className="back-link" onClick={onBack}>
        ‹ Back
      </button>
      <h1 className="h1" style={{ margin: '8px 0 16px' }}>
        Create household
      </h1>
      <form
        className="stack-lg"
        onSubmit={async (e) => {
          e.preventDefault();
          if (problem) return;
          setBusy(true);
          setErr(null);
          try {
            const id = await createHousehold(auth, {
              myName: f.myName,
              partnerName: f.partnerName,
              partnerEmail: f.partnerEmail,
              monthlyTarget: target,
              potNow: pot,
            });
            prefs.setFolderId(id);
            onDone(id, f.partnerEmail.trim().toLowerCase());
          } catch (x) {
            setErr(x instanceof Error ? x.message : "Couldn't create the household.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Your name">
          <input
            className="input"
            value={f.myName}
            onChange={(e) => setF({ ...f, myName: e.target.value })}
          />
        </Field>
        <Field label="Your partner's name">
          <input
            className="input"
            value={f.partnerName}
            onChange={(e) => setF({ ...f, partnerName: e.target.value })}
          />
        </Field>
        <Field
          label="Your partner's Google email"
          hint="Used to share the folder with them and to check nobody else has access. It stays in your Drive."
        >
          <input
            className="input"
            type="email"
            inputMode="email"
            autoComplete="off"
            value={f.partnerEmail}
            onChange={(e) => setF({ ...f, partnerEmail: e.target.value })}
          />
        </Field>
        <Field label="Monthly spending target, in lei" hint="A guide, not a limit. You can change it later.">
          <DecimalInput
            placeholder="e.g. 2 000"
            value={f.target}
            onChange={(e) => setF({ ...f, target: e.target.value })}
          />
        </Field>
        <Field label="Money in the shared pot right now, in lei">
          <DecimalInput placeholder="0" value={f.pot} onChange={(e) => setF({ ...f, pot: e.target.value })} />
        </Field>
        {err && <p className="problem">{err}</p>}
        {problem && (f.myName || f.partnerName) && <span className="problem">{problem}</span>}
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={!!problem || busy}>
          {busy ? 'Creating the folder…' : `Create household${pot ? ` with ${money(pot)}` : ''}`}
        </button>
      </form>
    </OnboardingFrame>
  );
}

export function ShareScreen({
  auth,
  folderId,
  partnerEmail,
  onDone,
}: {
  auth: GoogleAuth;
  folderId: string;
  partnerEmail: string;
  onDone: () => void;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [err, setErr] = useState<string | null>(null);
  return (
    <OnboardingFrame>
      <h1 className="h1" style={{ margin: '8px 0 12px' }}>
        Share it with your partner
      </h1>
      <p className="muted">
        The household lives in a folder called Household Data in your Google Drive. Share it only with your
        partner, never "anyone with the link".
      </p>
      <div className="stack-lg">
        {partnerEmail && (
          <button
            type="button"
            className="btn btn-primary btn-lg btn-block"
            disabled={state !== 'idle'}
            onClick={async () => {
              setState('busy');
              setErr(null);
              try {
                await new DriveAdapter(auth, folderId).shareWith(partnerEmail);
                setState('done');
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Couldn't share the folder.");
                setState('idle');
              }
            }}
          >
            {state === 'done' ? (
              <>
                <IconCheck size={20} />
                Shared with {partnerEmail}
              </>
            ) : state === 'busy' ? (
              'Sharing…'
            ) : (
              `Share the folder with ${partnerEmail}`
            )}
          </button>
        )}
        {err && <p className="problem">{err}</p>}
        <div className="note stack" style={{ gap: 6 }}>
          <span className="bold">Or share it by hand</span>
          <span>1. Open the folder in Google Drive: </span>
          <a
            href={driveFolderLink(folderId)}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontWeight: 700 }}
          >
            Open Household Data in Drive
          </a>
          <span>2. Tap Share, add your partner's Google email and choose Editor.</span>
          <span>3. On their phone, they open this app, sign in and tap Join household.</span>
        </div>
        <button type="button" className="btn btn-outline btn-lg btn-block" onClick={onDone}>
          Continue
        </button>
      </div>
    </OnboardingFrame>
  );
}

export function JoinScreen({
  auth,
  onDone,
  onBack,
}: {
  auth: GoogleAuth;
  onDone: (folderId: string) => void;
  onBack: () => void;
}) {
  const [step, setStep] = useState<'folder' | 'files'>('folder');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pick1 = async () => {
    setErr(null);
    setBusy(true);
    try {
      const picked = await pickFolder(await auth.getToken());
      if (picked?.[0]) {
        setFolderId(picked[0].id);
        setStep('files');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't open the Picker.");
    } finally {
      setBusy(false);
    }
  };
  const pick2 = async () => {
    if (!folderId) return;
    setErr(null);
    setBusy(true);
    try {
      await pickFilesIn(await auth.getToken(), folderId);
      const left = await missingFiles(new DriveAdapter(auth, folderId));
      setMissing(left);
      if (!left.length) {
        prefs.setFolderId(folderId);
        onDone(folderId);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't open the Picker.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <OnboardingFrame>
      <button type="button" className="back-link" onClick={onBack}>
        ‹ Back
      </button>
      <h1 className="h1" style={{ margin: '8px 0 12px' }}>
        Join household
      </h1>
      <ol className="stack" style={{ paddingLeft: 20, gap: 8 }}>
        <li style={{ fontWeight: step === 'folder' ? 700 : 400 }}>
          Pick the Household Data folder your partner shared with you.
        </li>
        <li style={{ fontWeight: step === 'files' ? 700 : 400 }}>
          Then select every file inside it. Google only lets the app open what you pick.
        </li>
      </ol>
      <div className="stack-lg" style={{ marginTop: 12 }}>
        {step === 'folder' ? (
          <button
            type="button"
            className="btn btn-primary btn-lg btn-block"
            onClick={() => void pick1()}
            disabled={busy}
          >
            Pick the shared folder
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-lg btn-block"
            onClick={() => void pick2()}
            disabled={busy}
          >
            {missing.length ? 'Pick the missing files' : 'Select the files in the folder'}
          </button>
        )}
        {missing.length > 0 && (
          <div className="callout callout-saffron">
            Still not shared with this phone: {missing.map((m) => `${m}.json`).join(', ')}. Tap the button and
            select {missing.length === 1 ? 'it' : 'them'} too.
          </div>
        )}
        {err && <p className="problem">{err}</p>}
        <p className="small muted">
          Can't see the folder? Ask your partner to share Household Data with this Google account as an
          Editor.
        </p>
      </div>
    </OnboardingFrame>
  );
}

export function DoneScreen({ onDone }: { onDone: () => void }) {
  const items = [
    [
      'Add your Gemini key',
      'Settings › This phone. Needed for receipt scanning, recipe import and the Assistant. Each of you uses your own.',
    ],
    ['Install the app', 'Android: Chrome menu › Install app. iPhone: Safari › Share › Add to Home Screen.'],
    ['Start with what you have', 'Scan your next receipt with the Assistant, or add a few items in Stock.'],
  ];
  return (
    <OnboardingFrame>
      <h1 className="h1" style={{ margin: '16px 0 16px' }}>
        You're set up
      </h1>
      <div className="list">
        {items.map(([t, s]) => (
          <div key={t} className="row" style={{ padding: '14px 16px', alignItems: 'flex-start', gap: 12 }}>
            <span className="ing-mark ok" aria-hidden>
              <IconCheck />
            </span>
            <span className="stack" style={{ gap: 2 }}>
              <span className="bold">{t}</span>
              <span className="small muted">{s}</span>
            </span>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="btn btn-primary btn-lg btn-block"
        style={{ marginTop: 20 }}
        onClick={onDone}
      >
        Open the app
      </button>
    </OnboardingFrame>
  );
}
