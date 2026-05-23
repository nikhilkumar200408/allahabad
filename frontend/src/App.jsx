import { useState, useEffect } from 'react';
import BankingDashboard from './components/BankingDashboard';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const DEVICE_ID = import.meta.env.VITE_DEVICE_ID || 'web-dashboard-v1';

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ email: '', password: '' });
  const [registerForm, setRegisterForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    phoneNumber: '',
  });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [kycForm, setKycForm] = useState({
    fullName: '',
    documentType: 'AADHAR',
    documentNumber: '',
    dateOfBirth: '',
  });

  useEffect(() => {
    const savedAccess = localStorage.getItem('accessToken');
    const savedRefresh = localStorage.getItem('refreshToken');
    if (savedAccess && savedRefresh) {
      setSession({ accessToken: savedAccess, refreshToken: savedRefresh });
    }
  }, []);

  useEffect(() => {
    if (!session) {
      return;
    }
    const fetchProfile = async () => {
      try {
        const res = await fetch(`${BASE_URL}/api/v1/auth/me`, {
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
            'X-Device-ID': DEVICE_ID,
          },
        });
        if (!res.ok) {
          throw new Error('Unable to load profile');
        }
        const data = await res.json();
        setProfile(data);
      } catch (err) {
        console.error(err);
        setError('Failed to load profile. Please log in again.');
        setSession(null);
        setProfile(null);
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
      }
    };
    fetchProfile();
  }, [session]);

  const handleLogin = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    try {
      const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: form.email.trim(),
          password: form.password,
          deviceId: DEVICE_ID,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.message || 'Login failed');
      }

      const data = await res.json();
      const { accessToken, refreshToken, user } = data;
      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', refreshToken);
      setSession({ accessToken, refreshToken, user });
    } catch (err) {
      console.error(err);
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    try {
      const res = await fetch(`${BASE_URL}/api/v1/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          firstName: registerForm.firstName.trim(),
          lastName: registerForm.lastName.trim(),
          email: registerForm.email.trim(),
          password: registerForm.password,
          phoneNumber: registerForm.phoneNumber.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.message || 'Registration failed');
      }

      const data = await res.json();
      setMessage(data?.message || 'Registration successful. Please log in.');
      setMode('login');
      setRegisterForm({ firstName: '', lastName: '', email: '', password: '', phoneNumber: '' });
    } catch (err) {
      console.error(err);
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    setSession(null);
    setProfile(null);
  };

  const handleKycSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    try {
      const res = await fetch(`${BASE_URL}/api/v1/auth/verify-kyc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.accessToken}`,
          'X-Device-ID': DEVICE_ID,
        },
        body: JSON.stringify({
          fullName: kycForm.fullName.trim(),
          documentType: kycForm.documentType,
          documentNumber: kycForm.documentNumber.trim(),
          dateOfBirth: kycForm.dateOfBirth,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.message || 'KYC verification failed');
      }

      const success = await res.json();
      if (success === true) {
        setMessage('KYC verification successful. Loading your dashboard...');
        const profileRes = await fetch(`${BASE_URL}/api/v1/auth/me`, {
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
            'X-Device-ID': DEVICE_ID,
          },
        });
        if (!profileRes.ok) {
          throw new Error('Failed to refresh profile after KYC completion');
        }
        const refreshed = await profileRes.json();
        setProfile(refreshed);
      } else {
        setError('KYC verification was rejected. Please review your details and try again.');
      }
    } catch (err) {
      console.error(err);
      setError(err.message || 'KYC verification failed');
    } finally {
      setLoading(false);
    }
  };

  if (!session || !profile) {
    const isRegister = mode === 'register';

    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4">
        <div className="w-full max-w-lg rounded-3xl border border-slate-800 bg-slate-900/95 p-8 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-semibold">MyBank Dashboard</h1>
              <p className="text-sm text-slate-400">{isRegister ? 'Create a new customer account.' : 'Login with your banking account.'}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setMode(isRegister ? 'login' : 'register');
                setError('');
                setMessage('');
              }}
              className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:border-emerald-500"
            >
              {isRegister ? 'Switch to Login' : 'Register'}
            </button>
          </div>

          <form onSubmit={isRegister ? handleRegister : handleLogin} className="space-y-4">
            {isRegister && (
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm text-slate-200">
                  First name
                  <input
                    type="text"
                    value={registerForm.firstName}
                    onChange={(e) => setRegisterForm({ ...registerForm, firstName: e.target.value })}
                    className="mt-2 w-full rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
                    required
                  />
                </label>
                <label className="block text-sm text-slate-200">
                  Last name
                  <input
                    type="text"
                    value={registerForm.lastName}
                    onChange={(e) => setRegisterForm({ ...registerForm, lastName: e.target.value })}
                    className="mt-2 w-full rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
                    required
                  />
                </label>
              </div>
            )}

            <label className="block text-sm text-slate-200">
              Email
              <input
                type="email"
                value={isRegister ? registerForm.email : form.email}
                onChange={(e) => isRegister
                  ? setRegisterForm({ ...registerForm, email: e.target.value })
                  : setForm({ ...form, email: e.target.value })}
                className="mt-2 w-full rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
                required
              />
            </label>
            <label className="block text-sm text-slate-200">
              Password
              <input
                type="password"
                value={isRegister ? registerForm.password : form.password}
                onChange={(e) => isRegister
                  ? setRegisterForm({ ...registerForm, password: e.target.value })
                  : setForm({ ...form, password: e.target.value })}
                className="mt-2 w-full rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
                required
              />
            </label>

            {isRegister && (
              <label className="block text-sm text-slate-200">
                Phone number
                <input
                  type="tel"
                  value={registerForm.phoneNumber}
                  onChange={(e) => setRegisterForm({ ...registerForm, phoneNumber: e.target.value })}
                  className="mt-2 w-full rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  required
                />
              </label>
            )}

            {error && <p className="text-sm text-rose-400">{error}</p>}
            {message && <p className="text-sm text-emerald-300">{message}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              {loading ? (isRegister ? 'Creating account…' : 'Signing in…') : (isRegister ? 'Register account' : 'Sign in')}
            </button>
          </form>

          {isRegister ? (
            <p className="mt-4 text-xs text-slate-500">After registration, your account will be created with KYC status PENDING.</p>
          ) : (
            <p className="mt-4 text-xs text-slate-500">If login fails, verify that your user exists and KYC status is VERIFIED.</p>
          )}
        </div>
      </div>
    );
  }

  if (profile.user.kycStatus !== 'VERIFIED') {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4">
        <div className="w-full max-w-2xl rounded-3xl border border-slate-800 bg-slate-900/95 p-8 shadow-xl">
          <div className="flex items-start justify-between gap-4 mb-6">
            <div>
              <h1 className="text-3xl font-semibold">Complete Your KYC</h1>
              <p className="mt-2 text-sm text-slate-400">
                Your account is currently <span className="font-semibold text-amber-300">{profile.user.kycStatus}</span>.
                Submit your details below to verify your identity and unlock the dashboard.
              </p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:border-rose-500"
            >
              Logout
            </button>
          </div>

          <form onSubmit={handleKycSubmit} className="space-y-4">
            <label className="block text-sm text-slate-200">
              Full name
              <input
                type="text"
                value={kycForm.fullName}
                onChange={(e) => setKycForm({ ...kycForm, fullName: e.target.value })}
                className="mt-2 w-full rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
                required
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm text-slate-200">
                Document type
                <select
                  value={kycForm.documentType}
                  onChange={(e) => setKycForm({ ...kycForm, documentType: e.target.value })}
                  className="mt-2 w-full rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
                >
                  <option value="AADHAR">Aadhar</option>
                  <option value="PAN">PAN</option>
                  <option value="DRIVING_LICENSE">Driving License</option>
                </select>
              </label>
              <label className="block text-sm text-slate-200">
                Date of birth
                <input
                  type="date"
                  value={kycForm.dateOfBirth}
                  onChange={(e) => setKycForm({ ...kycForm, dateOfBirth: e.target.value })}
                  className="mt-2 w-full rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  required
                />
              </label>
            </div>
            <label className="block text-sm text-slate-200">
              Document number
              <input
                type="text"
                value={kycForm.documentNumber}
                onChange={(e) => setKycForm({ ...kycForm, documentNumber: e.target.value })}
                className="mt-2 w-full rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
                required
              />
            </label>

            {error && <p className="text-sm text-rose-400">{error}</p>}
            {message && <p className="text-sm text-emerald-300">{message}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              {loading ? 'Verifying KYC…' : 'Submit KYC Verification'}
            </button>
          </form>

          <p className="mt-4 text-xs text-slate-500">KYC is required before you can access the full banking dashboard.</p>
        </div>
      </div>
    );
  }

  const account = profile.account || { id: '', currentBalance: '0.00', currency: 'MYSIM' };

  return (
    <BankingDashboard
      accessToken={session.accessToken}
      refreshToken={session.refreshToken}
      userId={profile.user.id}
      upiHandle={profile.user.upiHandle}
      kycStatus={profile.user.kycStatus}
      accountId={account.id}
      initialBalance={account.currentBalance?.toString() ?? '0.00'}
      currency={account.currency}
      onLogout={handleLogout}
    />
  );
}
