import type { Metadata } from 'next';
import AuthFlow from './AuthFlow';

export const metadata: Metadata = {
  title: 'Your account | SimSoccer',
  description: 'Sign in or create a SimSoccer account.',
};

export default function AuthPage() {
  return <AuthFlow />;
}