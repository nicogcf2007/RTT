interface FileMetadata {
  [format: string]: {
    filename: string;
    content_type: string;
  };
}

declare global {
  interface Window {
    fileMetadata: FileMetadata | null;
  }
}

export {};