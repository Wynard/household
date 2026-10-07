import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { IconBag, IconBook, IconChart, IconChat, IconChecklist, IconJar } from '../ui/icons';
import { useAnyOverlayOpen } from '../ui/overlay';
import { useAssistantUi } from './assistantUi';

const TABS = [
  { to: '/stock', label: 'Stock', Icon: IconJar },
  { to: '/recipes', label: 'Recipes', Icon: IconBook },
  { to: '/shopping', label: 'Shopping', Icon: IconChecklist },
  { to: '/budget', label: 'Budget', Icon: IconBag },
  { to: '/insights', label: 'Insights', Icon: IconChart },
];

export function TabLayout() {
  const overlay = useAnyOverlayOpen();
  const assistant = useAssistantUi();
  const loc = useLocation();
  return (
    <>
      <main className="page" id="main" key={loc.pathname.split('/')[1]}>
        <Outlet />
      </main>
      {!overlay && !assistant.disabled && (
        <button
          type="button"
          className="fab"
          aria-label="Open the assistant"
          onClick={() => assistant.open()}
        >
          <IconChat />
        </button>
      )}
      <nav className="tabbar" aria-label="Main">
        {TABS.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} className="tab">
            <span className="pill">
              <Icon />
            </span>
            {label}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
