/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    requestId: string;
    app: import('./server/context.ts').App;
    /** Presente solo si hay sesión activa. */
    session?: import('./server/auth/sessions.ts').ActiveSession;
    user?: import('./server/auth/sessions.ts').SessionUser;
    /** Token CSRF para incrustar en formularios (vacío sin sesión). */
    csrf: string;
    /** true si la petición llegó con una sesión expirada o revocada. */
    sessionExpired: boolean;
  }
}
