import { Navigate, Route, Routes } from 'react-router-dom';
import { SettingsHome } from './SettingsHome';
import {
  CategoriesTable,
  ItemsTable,
  PlacesTable,
  RecipeCategoriesTable,
  RecipesTable,
  StoresTable,
} from './tables';
import { DeviceSettings, HouseholdSettings } from './HouseholdSettings';
import { AssistantSettings, GeminiSettings } from './DeviceParts';

/** Settings is a full-screen area (no tab bar or Assistant button). */
export function SettingsRoutes() {
  return (
    <Routes>
      <Route index element={<SettingsHome />} />
      <Route path="items" element={<ItemsTable />} />
      <Route path="categories" element={<CategoriesTable />} />
      <Route path="places" element={<PlacesTable />} />
      <Route path="recipes" element={<RecipesTable />} />
      <Route path="recipe-categories" element={<RecipeCategoriesTable />} />
      <Route path="stores" element={<StoresTable />} />
      <Route path="household" element={<HouseholdSettings />} />
      <Route
        path="device"
        element={
          <DeviceSettings>
            <GeminiSettings />
          </DeviceSettings>
        }
      />
      <Route path="assistant" element={<AssistantSettings />} />
      <Route path="*" element={<Navigate to="/settings" replace />} />
    </Routes>
  );
}
