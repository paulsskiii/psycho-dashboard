import { SignInForm } from "./SignInForm";
import s from "./signin.module.css";

export const metadata = { title: "Sign in · Psycho" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ link?: string }> }) {
  const { link } = await searchParams;
  return (
    <main className={s.page}>
      <div className={`display ${s.wordmark}`}>PSYCHO</div>
      <SignInForm linkExpired={link === "expired"} />
    </main>
  );
}
