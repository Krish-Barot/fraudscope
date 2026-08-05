// apps/web/app/login/page.tsx
// Login page — real implementation
// No HTML <form> tag — React state + onClick as specified
'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Crosshair, Eye, EyeOff, AlertCircle } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../../lib/authContext';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Where to redirect after successful login
  const from = searchParams.get('from') || '/dashboard';

  async function handleLogin() {
    // Basic client-side validation
    if (!email.trim()) {
      setError('Please enter your email address');
      return;
    }
    if (!password) {
      setError('Please enter your password');
      return;
    }

    setError('');
    setIsLoading(true);

    try {
      await login(email.trim().toLowerCase(), password);
      router.push(from);
    } catch (err) {
      setError((err as Error).message || 'Invalid email or password');
    } finally {
      setIsLoading(false);
    }
  }

  // Allow Enter key to submit
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      handleLogin();
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center p-4 bg-[#0D0F1A]">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-600 rounded-xl mb-4">
            <Crosshair size={24} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-100">FraudScope</h1>
          <p className="text-slate-400 text-sm mt-1">Sign in to your account</p>
        </div>

        {/* Card */}
        <div className="bg-[#131929] border border-[#1E2535] rounded-xl p-6 space-y-4">

          {/* Error message */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-950 border border-red-800 rounded-lg">
              <AlertCircle size={14} className="text-red-400 shrink-0" />
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {/* Email input */}
          <div>
            <label className="block text-sm text-slate-300 mb-1.5 font-medium">
              Email address
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="analyst@fraudscope.dev"
              disabled={isLoading}
              className={clsx(
                'w-full px-3 py-2.5 bg-[#0D0F1A] border rounded-lg text-slate-200',
                'placeholder-slate-600 text-sm',
                'focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                'transition-colors duration-150',
                error ? 'border-red-700' : 'border-[#1E2535]'
              )}
            />
          </div>

          {/* Password input */}
          <div>
            <label className="block text-sm text-slate-300 mb-1.5 font-medium">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="••••••••"
                disabled={isLoading}
                className={clsx(
                  'w-full px-3 py-2.5 pr-10 bg-[#0D0F1A] border rounded-lg text-slate-200',
                  'placeholder-slate-600 text-sm',
                  'focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  'transition-colors duration-150',
                  error ? 'border-red-700' : 'border-[#1E2535]'
                )}
              />
              <button
                onClick={() => setShowPassword(prev => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                tabIndex={-1}
              >
                {showPassword
                  ? <EyeOff size={14} />
                  : <Eye size={14} />
                }
              </button>
            </div>
          </div>

          {/* Submit button — onClick not form submit */}
          <button
            onClick={handleLogin}
            disabled={isLoading}
            className={clsx(
              'w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg',
              'hover:bg-blue-500 active:bg-blue-700',
              'disabled:opacity-60 disabled:cursor-not-allowed',
              'transition-colors duration-150',
              'flex items-center justify-center gap-2'
            )}
          >
            {isLoading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Signing in...
              </>
            ) : (
              'Sign in'
            )}
          </button>

          {/* Dev credentials hint */}
          {process.env.NODE_ENV === 'development' && (
            <p className="text-center text-xs text-slate-600">
              Dev: analyst@fraudscope.dev / analyst123
            </p>
          )}
        </div>

        <p className="text-center text-xs text-slate-700 mt-6">
          FraudScope — Secure access only
        </p>
      </div>
    </div>
  );
}