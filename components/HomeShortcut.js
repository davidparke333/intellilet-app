import Link from 'next/link';
import { currentMember, isStaff } from '@/lib/supabase/server';
import styles from './HomeShortcut.module.css';

export default async function HomeShortcut() {
  const { member } = await currentMember();
  if (!member) return null;
  const href = isStaff(member) ? '/today' : member.role === 'readonly' ? '/' : '/portal';
  return <Link href={href} className={styles.home} title="Return to your home page" aria-label="Home">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" /></svg>
    <span>Home</span>
  </Link>;
}
