import { SignUp } from '@clerk/nextjs';

export const metadata = { title: 'Crear cuenta' };

export default function Page() {
  return <SignUp signInUrl="/ingresar" />;
}
