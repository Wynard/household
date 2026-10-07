import { PageHeader } from '../ui/controls';

/** Temporary screen for tabs that arrive in later phases. */
export function Placeholder({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <p className="summary">This part of the app is being built.</p>
    </>
  );
}
