'use client';

import { FormEvent, useEffect, useState } from 'react';
import { ArrowRight, KeyRound, Mail, Sparkles, UserRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { getToken, saveToken } from '../../lib/auth';
import '../../app/globals.css';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export default function LoginPage() {
  const router = useRouter();
  const [register, setRegister] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => { if (getToken()) router.replace('/demos'); }, [router]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const endpoint = register ? 'register' : 'login';
      const response = await fetch(`${API_URL}/auth/${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(register ? { name, email, password } : { email, password }) });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { message?: string | string[] } | null;
        setError(Array.isArray(payload?.message) ? payload.message.join('; ') : payload?.message ?? `Unable to authenticate (${response.status})`);
        return;
      }
      const result = await response.json() as { accessToken: string };
      saveToken(result.accessToken);
      router.push('/demos');
    } catch (requestError) {
      setError(`Unable to reach the API: ${requestError instanceof Error ? requestError.message : 'Check that Flowcraft is running'}`);
    } finally {
      setLoading(false);
    }
  };
  return <main className="auth-page"><section className="auth-panel"><div className="brand auth-brand"><div className="brand-mark"><Sparkles size={16} /></div><span>flowcraft</span></div><div className="auth-heading"><span className="eyebrow">WORKFLOW AUTOMATION</span><h1>{register ? 'Create your workspace' : 'Welcome back'}</h1><p>{register ? 'Build and operate automations with your team.' : 'Sign in to continue building.'}</p></div><form onSubmit={submit}>{register && <label><span><UserRound size={14} />Name</span><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" /></label>}<label><span><Mail size={14} />Email</span><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label><label><span><KeyRound size={14} />Password</span><input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" /></label>{error && <div className="auth-error">{error}</div>}<button className="primary auth-submit" disabled={loading}>{loading ? 'Working...' : register ? 'Create account' : 'Sign in'}<ArrowRight size={15} /></button></form><button className="auth-switch" onClick={() => { setRegister(!register); setError(''); }}>{register ? 'Already have an account? Sign in' : 'New to Flowcraft? Create an account'}</button></section><aside className="auth-aside"><div className="auth-aside-mark"><Sparkles size={22} /></div><h2>Turn ideas into reliable workflows.</h2><p>Connect triggers, actions, and conditions on a canvas your whole team can understand.</p><div className="auth-aside-line" /></aside></main>;
}