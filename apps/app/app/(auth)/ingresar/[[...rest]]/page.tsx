import { SignIn } from '@clerk/nextjs';

export const metadata = { title: 'Ingresar' };

export default function Page() {
  return <SignIn signUpUrl="/crear-cuenta" />;
}
