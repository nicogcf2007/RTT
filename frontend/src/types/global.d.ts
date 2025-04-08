// Declare global window properties for file download handling
interface Window {
  fileMetadata: Record<string, { filename: string; content_type: string }> | null;
  downloadCounter: number;
}