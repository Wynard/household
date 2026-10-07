import { useSnapshot, useRun } from '../../app/data';
import { useSession } from '../../auth/session';
import { FullScreen } from '../../ui/Sheet';

/**
 * Shown when the signed-in Google account isn't one of the household's two
 * people (e.g. the partner signed in with a different address than the one
 * the creator typed). They can take the partner's place or leave.
 */
export function MemberCheck() {
  const { snap } = useSnapshot();
  const session = useSession();
  const { run } = useRun();
  if (!snap || session.mode !== 'google') return null;
  const members = snap.household.members;
  if (members.some((m) => m.email === session.email)) return null;
  const slot = members[1] && members[1].email !== session.email ? members[1] : undefined;
  return (
    <FullScreen label="Join the household" z={80}>
      <div className="full-body" style={{ paddingTop: 24 }}>
        <h1 className="h1-sm">You're signed in as {session.email}</h1>
        <p className="muted">
          This household belongs to {members.map((m) => m.name).join(' and ')}
          {slot ? `, and was set up for ${slot.name} with the address ${slot.email}.` : '.'}
        </p>
        {slot ? (
          <button
            type="button"
            className="btn btn-primary btn-lg btn-block"
            onClick={() =>
              void run(
                'joinAsMember',
                { email: session.email, name: slot.name, replaceEmail: slot.email },
                { toast: `Welcome, ${slot.name}` },
              )
            }
          >
            I'm {slot.name}, use this account
          </button>
        ) : (
          members.length < 2 && (
            <button
              type="button"
              className="btn btn-primary btn-lg btn-block"
              onClick={() =>
                void run(
                  'joinAsMember',
                  { email: session.email, name: session.email.split('@')[0] },
                  { toast: 'Welcome' },
                )
              }
            >
              Join this household
            </button>
          )
        )}
        <button type="button" className="btn btn-ghost btn-md" onClick={session.leaveHousehold}>
          Pick a different household
        </button>
        <button type="button" className="btn btn-ghost btn-md" onClick={session.signOut}>
          Sign out
        </button>
      </div>
    </FullScreen>
  );
}
