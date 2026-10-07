import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FullScreen } from '../ui/Sheet';
import { reloadApp } from './appUpdate';

/**
 * If any data file was saved by a newer version of the app, this version
 * stops (it never writes to such a file) and asks for a reload.
 */
export function UpdateGate() {
  const qc = useQueryClient();
  const [newer, setNewer] = useState(false);
  useEffect(() => {
    const check = () =>
      setNewer(
        qc
          .getQueryCache()
          .getAll()
          .some((q) => (q.state.error as Error | null)?.name === 'NewerVersionError'),
      );
    check();
    return qc.getQueryCache().subscribe(check);
  }, [qc]);
  if (!newer) return null;
  return (
    <FullScreen label="Update needed" z={90}>
      <div className="full-body" style={{ paddingTop: 32 }}>
        <h1 className="h1-sm">This app was updated</h1>
        <p className="muted">
          The other phone saved your data with a newer version of Household. Reload to get it. Nothing was
          changed on this phone.
        </p>
        <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => void reloadApp()}>
          Reload to continue
        </button>
      </div>
    </FullScreen>
  );
}
