import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublic = createRouteMatcher(['/ingresar(.*)', '/crear-cuenta(.*)', '/api/webhooks(.*)']);

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
