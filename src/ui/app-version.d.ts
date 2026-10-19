// Vite replaces this at build time from package.json, so the Verwaltung shows the released version
// without a runtime fetch.
interface ImportMetaEnv {
  readonly APP_VERSION: string;
}

// Safari's flag for a page started from the Home Screen.
interface Navigator {
  readonly standalone?: boolean;
}
