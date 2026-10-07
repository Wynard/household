// Build-time configuration. Only public-by-design browser identifiers live
// here (they end up in the bundle). The Gemini key is per device, in Settings.
export const config = {
  useMock: import.meta.env.VITE_USE_MOCK === 'true' || import.meta.env.MODE === 'mock',
  googleClientId: (import.meta.env.HH_GOOGLE_CLIENT_ID as string | undefined) ?? '',
  pickerApiKey: (import.meta.env.HH_PICKER_API_KEY as string | undefined) ?? '',
  googleProjectNumber: (import.meta.env.HH_GOOGLE_PROJECT_NUMBER as string | undefined) ?? '',
  folderName: 'Household Data',
};

export const googleConfigured = () =>
  !!(config.googleClientId && config.pickerApiKey && config.googleProjectNumber);
