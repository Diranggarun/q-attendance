// Type declarations for Workbox modules used by the service worker
declare module 'workbox-core' {
  export function clientsClaim(): void;
}

declare module 'workbox-precaching' {
  export const precacheAndRoute: (manifest?: any) => void;
  export const cleanupOutdatedCaches: () => void;
  export function createHandlerBoundToURL(url: string): any;
}

declare module 'workbox-routing' {
  export function registerRoute(...args: any[]): any;
  export class NavigationRoute {
    constructor(handler: any, options?: any);
  }
}

declare module 'register-service-worker' {
  export function register(path: string, options?: any): void;
}

// For local dev / tests when vitest config import is used
declare module 'vitest/config' {
  export function defineConfig<T = any>(config: T): T;
}
