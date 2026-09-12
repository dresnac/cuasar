import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

/**
 * Rutas que no pasan por la sesión de Clerk.
 *
 * Las de `/api/cron` y `/api/webhooks` tienen su propia autenticación —un
 * secreto compartido o una firma— y no hay usuario detrás. Sin esto,
 * `auth.protect()` les contestaba 404 y el cron de la cola de salida nunca
 * llegaba a correr: el `authorization: Bearer <secreto>` que manda Vercel
 * parece un JWT a los ojos de Clerk y lo rechaza.
 *
 * `/api/blob/upload` queda afuera de esta lista a propósito: ese sí necesita
 * la sesión, porque firma tokens de subida para la agencia de quien pide.
 */
const isPublic = createRouteMatcher([
  '/ingresar(.*)',
  '/crear-cuenta(.*)',
  '/api/webhooks(.*)',
  '/api/cron(.*)',
  '/api/diag',
]);

export default clerkMiddleware(
  async (auth, req) => {
    if (!isPublic(req)) await auth.protect();
  },
  {
    // Sin esto, `auth.protect()` manda al portal de cuentas de Clerk —que para
    // esta instancia es accounts.cuasar.app, un dominio que todavía no existe—
    // en lugar de a nuestra propia pantalla de ingreso. El navegador contestaba
    // "no se encuentra el servidor" y parecía que la aplicación estaba caída.
    signInUrl: '/ingresar',
    signUpUrl: '/crear-cuenta',
  },
);

export const config = {
  matcher: ['/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico)).*)'],
};
