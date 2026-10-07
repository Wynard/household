import { useEffect, useMemo, useRef, useState } from 'react';
import { GoogleAuth } from '../auth/google';
import type { Session } from '../auth/session';
import { DataStore, fileKey, type Loaded } from '../storage/store';
import { DriveAdapter, unsafePermissions, type Permission } from '../storage/drive';
import { pickFilesIn } from '../storage/picker';
import { AppShell, makeQueryClient } from './App';
import { prefs, wipeLocalData } from './prefs';
import type { HouseholdFile } from '../domain/schemas';
import {
  ChooseScreen,
  CreateScreen,
  DoneScreen,
  JoinScreen,
  ShareScreen,
  SignInScreen,
} from '../features/onboarding/Onboarding';
import { MemberCheck } from '../features/onboarding/MemberCheck';
import { IconWarn } from '../ui/icons';

type Phase =
  | { k: 'signin' }
  | { k: 'choose' }
  | { k: 'create' }
  | { k: 'share'; folderId: string; partnerEmail: string }
  | { k: 'join' }
  | { k: 'done' }
  | { k: 'ready'; folderId: string };

/** The real app: Google sign-in, then onboarding or the household. */
export function GoogleApp() {
  const auth = useMemo(() => new GoogleAuth(), []);
  const [phase, setPhase] = useState<Phase>({ k: 'signin' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    setBusy(true);
    setErr(null);
    try {
      await auth.signIn({ returning: !!prefs.folderId() });
      const folderId = prefs.folderId();
      setPhase(folderId ? { k: 'ready', folderId } : { k: 'choose' });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't sign in.");
    } finally {
      setBusy(false);
    }
  };

  switch (phase.k) {
    case 'signin':
      return <SignInScreen onSignIn={() => void signIn()} error={err} busy={busy} />;
    case 'choose':
      return (
        <ChooseScreen
          name={auth.profile?.name ?? ''}
          onCreate={() => setPhase({ k: 'create' })}
          onJoin={() => setPhase({ k: 'join' })}
        />
      );
    case 'create':
      return (
        <CreateScreen
          auth={auth}
          onBack={() => setPhase({ k: 'choose' })}
          onDone={(folderId, partnerEmail) => setPhase({ k: 'share', folderId, partnerEmail })}
        />
      );
    case 'share':
      return (
        <ShareScreen
          auth={auth}
          folderId={phase.folderId}
          partnerEmail={phase.partnerEmail}
          onDone={() => setPhase({ k: 'done' })}
        />
      );
    case 'join':
      return (
        <JoinScreen
          auth={auth}
          onBack={() => setPhase({ k: 'choose' })}
          onDone={() => setPhase({ k: 'done' })}
        />
      );
    case 'done':
      return <DoneScreen onDone={() => setPhase({ k: 'ready', folderId: prefs.folderId()! })} />;
    case 'ready':
      return (
        <ReadyApp
          auth={auth}
          folderId={phase.folderId}
          onLeave={() => {
            prefs.setFolderId(null);
            setPhase({ k: 'choose' });
          }}
        />
      );
  }
}

function ReadyApp({ auth, folderId, onLeave }: { auth: GoogleAuth; folderId: string; onLeave: () => void }) {
  const qc = useMemo(makeQueryClient, []);
  const email = auth.profile!.email;
  const adapter = useMemo(() => new DriveAdapter(auth, folderId), [auth, folderId]);
  const store = useMemo(() => new DataStore(adapter, qc, () => email), [adapter, qc, email]);
  const [needsReconnect, setNeedsReconnect] = useState(auth.needsReconnect);
  const [accessNeeded, setAccessNeeded] = useState<string[]>([]);
  const [unsafe, setUnsafe] = useState<Permission[]>([]);
  const checked = useRef(false);

  useEffect(() => auth.onChange((s) => setNeedsReconnect(s.needsReconnect)), [auth]);

  useEffect(() => {
    // record IDs of files this phone creates (e.g. a new year's budget), and learn the others'
    adapter.onFileCreated = (name, id) =>
      void store
        .commit([{ t: 'mapSet', file: 'household', field: 'fileIds', key: name, value: id }])
        .catch(() => undefined);
    adapter.onAccessNeeded = (files) => setAccessNeeded((x) => [...new Set([...x, ...files])]);
    const sync = () => {
      const h = qc.getQueryData<Loaded<HouseholdFile>>(fileKey('household'));
      if (!h) return;
      adapter.setKnownIds(h.data.fileIds);
      if (!checked.current && h.version !== null) {
        checked.current = true;
        void adapter.missingAccess().then((m) => m.length && setAccessNeeded(m));
        // 2b: the folder must be shared only with the two members
        void adapter
          .permissions()
          .then((p) =>
            setUnsafe(
              unsafePermissions(
                p,
                h.data.members.map((m) => m.email),
              ),
            ),
          )
          .catch(() => undefined);
      }
    };
    sync();
    return qc.getQueryCache().subscribe((e) => {
      if (e.query.queryKey[1] === 'household') sync();
    });
  }, [adapter, store, qc]);

  const session: Session = useMemo(
    () => ({
      mode: 'google',
      email,
      needsReconnect,
      reconnect: () =>
        void auth.signIn({ returning: true }).then(
          () => store.refreshAll(),
          () => undefined,
        ),
      signOut: () => {
        auth.signOut();
        void wipeLocalData().then(() => location.reload());
      },
      leaveHousehold: onLeave,
    }),
    [email, needsReconnect, auth, store, onLeave],
  );

  const banners = (
    <>
      {needsReconnect && (
        <button type="button" className="banner banner-saffron" onClick={session.reconnect}>
          <IconWarn />
          Your Google session ended. Tap to reconnect. Nothing you typed is lost.
        </button>
      )}
      {accessNeeded.length > 0 && (
        <button
          type="button"
          className="banner banner-saffron"
          onClick={async () => {
            try {
              await pickFilesIn(await auth.getToken(), folderId);
              await adapter.refreshIndex();
              const left = await adapter.missingAccess();
              setAccessNeeded(left);
              await store.refreshAll();
            } catch {
              /* picker closed */
            }
          }}
        >
          <IconWarn />
          Your partner's phone added {accessNeeded.length === 1
            ? 'a file'
            : `${accessNeeded.length} files`}{' '}
          to the household. Tap to give this phone access.
        </button>
      )}
      {unsafe.length > 0 && (
        <button
          type="button"
          className="banner banner-red"
          onClick={async () => {
            try {
              for (const p of unsafe) await adapter.removePermission(p.id);
              setUnsafe([]);
            } catch {
              window.open(`https://drive.google.com/drive/folders/${folderId}`, '_blank', 'noopener');
            }
          }}
        >
          <IconWarn />
          The household folder is shared with more people than the two of you
          {unsafe.some((p) => p.type === 'anyone') ? ' (anyone with the link)' : ''}. Tap to fix it.
        </button>
      )}
    </>
  );

  return (
    <AppShell
      qc={qc}
      store={store}
      session={session}
      banners={
        <>
          {banners}
          <MemberCheck />
        </>
      }
    />
  );
}
