// A list pasted into the Assistant is handed to the import page in memory only:
// it never goes to Gemini, to the chat history or to the URL.
let pending: string | null = null;

export const setPendingList = (text: string) => {
  pending = text;
};

export const takePendingList = (): string | null => {
  const t = pending;
  pending = null;
  return t;
};
