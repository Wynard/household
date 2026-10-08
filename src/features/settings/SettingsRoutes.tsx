import { Navigate, Route, Routes } from 'react-router-dom';
import { SettingsHome } from './SettingsHome';
import { ImportList } from './ImportList';
import {
  CategoriesTable,
  ItemsTable,
  PlacesTable,
  RecipeCategoriesTable,
  RecipesTable,
  StoresTable,
  UnitsTable,
} from './tables';
import { DeviceSettings, HouseholdSettings } from './HouseholdSettings';
import { AppearanceSettings, AssistantSettings, GeminiSettings } from './DeviceParts';

/** Settings is a full-screen area (no tab bar or Assistant button). */
export function SettingsRoutes() {
  return (
    <Routes>
      <Route index element={<SettingsHome />} />
      <Route path="items" element={<ItemsTable />} />
      <Route path="items/import" element={<ImportList />} />
      <Route path="categories" element={<CategoriesTable />} />
      <Route path="places" element={<PlacesTable />} />
      <Route path="recipes" element={<RecipesTable />} />
      <Route path="recipe-categories" element={<RecipeCategoriesTable />} />
      <Route path="stores" element={<StoresTable />} />
      <Route path="units" element={<UnitsTable />} />
      <Route path="household" element={<HouseholdSettings />} />
      <Route
        path="device"
        element={
          <DeviceSettings>
            <AppearanceSettings />
            <GeminiSettings />
          </DeviceSettings>
        }
      />
      <Route path="assistant" element={<AssistantSettings />} />
      <Route path="*" element={<Navigate to="/settings" replace />} />
    </Routes>
  );
}
