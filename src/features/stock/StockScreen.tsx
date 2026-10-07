import { useSnapshot } from '../../app/data';
import { PageHeader, Loading } from '../../ui/controls';
import { stockStatus } from '../../domain/stock';

export function StockScreen() {
  const { snap, error } = useSnapshot();
  if (error) return <p className="empty">{error.message}</p>;
  if (!snap) return <Loading />;
  const shown = snap.items.items.filter((i) => i.showInStock && !i.archived);
  const low = shown.filter((i) => stockStatus(i) === 'low').length;
  const out = shown.filter((i) => stockStatus(i) === 'out').length;
  return (
    <>
      <PageHeader title="Stock" />
      <p className="summary">
        {shown.length} items, {low} running low, {out} out
      </p>
    </>
  );
}
