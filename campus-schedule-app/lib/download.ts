// File downloads are a web feature here (the deployed app). Native builds
// would need expo-file-system + expo-sharing, which aren't installed.

export function downloadText(_filename: string, _text: string, _mime?: string): boolean {
  return false;
}

export const canDownloadFiles = false;
