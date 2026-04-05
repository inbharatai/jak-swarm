'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, Zap, Loader2, CheckCircle2 } from 'lucide-react';
import { authApi } from '@/lib/api-client';
import { setToken } from '@/lib/auth';

const INDUSTRY_OPTIONS = [
  { value: 'TECHNOLOGY', label: '💻 Technology' },
  { value: 'FINANCE', label: '💰 Finance' },
  { value: 'HEALTHCARE', label: '🏥 Healthcare' },
  { value: 'LEGAL', label: '⚖️ Legal' },
  { value: 'RETAIL', label: '🛒 Retail' },
  { value: 'LOGISTICS', label: '🚚 Logistics' },
  { value: 'MANUFACTURING', label: '🏭 Manufacturing' },
  { value: 'REAL_ESTATE', label: '🏠 Real Estate' },
  { value: 'EDUCATION', label: '🎓 Education' },
  { value: 'HOSPITALITY', label: '🏨 Hospitality' },
];

const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Please enter a valid email'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Must contain at least one number'),
  tenantName: z.string().min(2, 'Organization name must be at least 2 characters'),
  industry: z.string().min(1, 'Please select an industry'),
});

type RegisterFormData = z.infer<typeof registerSchema>;

const PASSWORD_STRENGTH_CHECKS = [
  { label: '8+ characters', test: (p: string) => p.length >= 8 },
  { label: 'Uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'Number', test: (p: string) => /[0-9]/.test(p) },
];

export default function RegisterPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [password, setPassword] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: { industry: 'TECHNOLOGY' },
  });

  const onSubmit = async (data: RegisterFormData) => {
    setServerError(null);
    try {
      const response = await authApi.register({
        email: data.email,
        password: data.password,
        name: data.name,
        tenantName: data.tenantName,
        industry: data.industry,
      }) as { token: string };
      setToken(response.token);
      router.push('/onboarding');
    } catch (err: unknown) {
      setServerError((err as { message?: string })?.message ?? 'Registration failed. Please try again.');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-primary/5 to-background px-4 py-8">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 text-center">
          <Link href="/" className="inline-flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary">
              <Zap className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold">JAK Swarm</span>
          </Link>
          <h1 className="mt-6 text-2xl font-bold">Create your account</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Deploy your first agent swarm in minutes
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border bg-card shadow-sm p-8">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {/* Name */}
            <div className="space-y-1.5">
              <label htmlFor="name" className="text-sm font-medium">
                Full name
              </label>
              <input
                {...register('name')}
                id="name"
                type="text"
                autoComplete="name"
                placeholder="Jane Smith"
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-shadow"
              />
              {errors.name && (
                <p className="text-xs text-destructive">{errors.name.message}</p>
              )}
            </div>

            {/* Email */}
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm font-medium">
                Work email
              </label>
              <input
                {...register('email')}
                id="email"
                type="email"
                autoComplete="email"
                placeholder="jane@company.com"
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-shadow"
              />
              {errors.email && (
                <p className="text-xs text-destructive">{errors.email.message}</p>
              )}
            </div>

            {/* Organization */}
            <div className="space-y-1.5">
              <label htmlFor="tenantName" className="text-sm font-medium">
                Organization name
              </label>
              <input
                {...register('tenantName')}
                id="tenantName"
                type="text"
                placeholder="Acme Corp"
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-shadow"
              />
              {errors.tenantName && (
                <p className="text-xs text-destructive">{errors.tenantName.message}</p>
              )}
            </div>

            {/* Industry */}
            <div className="space-y-1.5">
              <label htmlFor="industry" className="text-sm font-medium">
                Industry
              </label>
              <select
                {...register('industry')}
                id="industry"
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring transition-shadow"
              >
                {INDUSTRY_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {errors.industry && (
                <p className="text-xs text-destructive">{errors.industry.message}</p>
              )}
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              <div className="relative">
                <input
                  {...register('password', {
                    onChange: e => setPassword(e.target.value),
                  })}
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-shadow"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>

              {/* Password strength checks */}
              {password && (
                <div className="flex gap-3 pt-1">
                  {PASSWORD_STRENGTH_CHECKS.map(check => (
                    <div key={check.label} className="flex items-center gap-1">
                      <CheckCircle2
                        className={`h-3 w-3 ${check.test(password) ? 'text-green-500' : 'text-muted-foreground'}`}
                      />
                      <span className="text-xs text-muted-foreground">{check.label}</span>
                    </div>
                  ))}
                </div>
              )}

              {errors.password && (
                <p className="text-xs text-destructive">{errors.password.message}</p>
              )}
            </div>

            {/* Server error */}
            {serverError && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">
                {serverError}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 transition-colors mt-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating account…
                </>
              ) : (
                'Create Account'
              )}
            </button>
          </form>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            By creating an account, you agree to our{' '}
            <Link href="/terms" className="text-primary hover:underline">Terms of Service</Link>
            {' '}and{' '}
            <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>.
          </p>
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/login" className="text-primary hover:underline font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
