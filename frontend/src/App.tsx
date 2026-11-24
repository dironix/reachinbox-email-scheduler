import React, { useEffect, useState, useCallback } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { Plus, Search, RefreshCw, Mail, Clock, CheckCircle2 } from 'lucide-react';
import type { UserProfile, EmailJobItem, Sender } from './types';
import { authApi, emailApi } from './services/api';
import { Header } from './components/Header';
import { EmailTable } from './components/EmailTable';
import { ComposeModal } from './components/ComposeModal';

export function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'scheduled' | 'sent'>('scheduled');
  const [scheduledEmails, setScheduledEmails] = useState<EmailJobItem[]>([]);
  const [sentEmails, setSentEmails] = useState<EmailJobItem[]>([]);
  const [searchResults, setSearchResults] = useState<EmailJobItem[] | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [tableLoading, setTableLoading] = useState(false);
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const fetchProfile = useCallback(async () => {
    const token = localStorage.getItem('reachinbox_token');
    if (!token) {
      setAuthLoading(false);
      return;
    }
    try {
      const res = await authApi.getMe();
      setUser(res.data);
    } catch {
      localStorage.removeItem('reachinbox_token');
      setUser(null);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const fetchEmails = useCallback(async () => {
    if (!user) return;
    try {
      setTableLoading(true);
      const [schedRes, sentRes] = await Promise.all([
        emailApi.getScheduled(),
        emailApi.getSent(),
      ]);
      setScheduledEmails(schedRes.data);
      setSentEmails(sentRes.data);
    } catch (err) {
      console.error('Error loading emails:', err);
    } finally {
      setTableLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchProfile();

    // Check Slack OAuth redirect query params
    const params = new URLSearchParams(window.location.search);
    if (params.get('slack') === 'connected') {
      showToast('Slack workspace connected! Rate limit alerts are now live.');
      window.history.replaceState({}, '', '/');
    } else if (params.get('slack') === 'error') {
      showToast('Slack connection failed. Please try again.');
      window.history.replaceState({}, '', '/');
    }
  }, [fetchProfile]);

  useEffect(() => {
    if (user) {
      fetchEmails();
      const interval = setInterval(fetchEmails, 5000); // Live poll every 5s
      return () => clearInterval(interval);
    }
  }, [user, fetchEmails]);

  // Elasticsearch Debounced Search
  useEffect(() => {
    if (!user || !searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        setTableLoading(true);
        const res = await emailApi.search(searchQuery);
        setSearchResults(res.data);
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setTableLoading(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [searchQuery, user]);

  const handleGoogleSuccess = async (credentialResponse: any) => {
    try {
      const res = await authApi.googleLogin(credentialResponse.credential);
      localStorage.setItem('reachinbox_token', res.data.token);
      await fetchProfile();
      showToast('Welcome to ReachInbox Scheduler!');
    } catch {
      showToast('Google Sign-In failed. Check your Client ID.');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('reachinbox_token');
    setUser(null);
  };

  const handleConnectSlack = async () => {
    try {
      const res = await authApi.getSlackConnectUrl();
      window.location.href = res.data.url;
    } catch {
      showToast('Failed to initiate Slack OAuth.');
    }
  };

  const handleDisconnectSlack = async () => {
    try {
      await authApi.disconnectSlack();
      setUser((prev) => (prev ? { ...prev, slackConnected: false, slackChannel: null } : null));
      showToast('Slack disconnected.');
    } catch {
      showToast('Failed to disconnect Slack.');
    }
  };

  const handleSenderAdded = (newSender: Sender) => {
    setUser((prev) =>
      prev
        ? { ...prev, senders: [...(prev.senders || []), newSender] }
        : null
    );
    showToast(`Added Ethereal sender: ${newSender.email}`);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <RefreshCw className="w-7 h-7 animate-spin text-blue-600" />
      </div>
    );
  }

  // Login Screen
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 px-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full text-center space-y-6">
          <div className="w-14 h-14 rounded-2xl bg-blue-600 text-white flex items-center justify-center mx-auto shadow-md">
            <Mail className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">ReachInbox Scheduler</h1>
            <p className="text-sm text-slate-500 mt-1.5">
              Production-grade cold email scheduling powered by BullMQ, Redis & Elasticsearch.
            </p>
          </div>
          <div className="flex justify-center pt-2">
            <GoogleLogin
              onSuccess={handleGoogleSuccess}
              onError={() => showToast('Google Login popup failed')}
              theme="outline"
              size="large"
              shape="rectangular"
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Header
        user={user}
        onLogout={handleLogout}
        onConnectSlack={handleConnectSlack}
        onDisconnectSlack={handleDisconnectSlack}
      />

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900 text-white text-xs font-medium px-4 py-3 rounded-xl shadow-lg">
          {toast}
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Top Action Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          {/* Tabs */}
          <div className="inline-flex bg-white p-1 rounded-xl border border-slate-200 shadow-2xs">
            <button
              onClick={() => {
                setActiveTab('scheduled');
                setSearchQuery('');
              }}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition cursor-pointer ${
                activeTab === 'scheduled' && !searchQuery
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Clock className="w-4 h-4" />
              Scheduled Emails
              <span
                className={`ml-1 px-2 py-0.5 text-xs rounded-full ${
                  activeTab === 'scheduled' && !searchQuery
                    ? 'bg-blue-500 text-white'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {scheduledEmails.length}
              </span>
            </button>

            <button
              onClick={() => {
                setActiveTab('sent');
                setSearchQuery('');
              }}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition cursor-pointer ${
                activeTab === 'sent' && !searchQuery
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              Sent Emails
              <span
                className={`ml-1 px-2 py-0.5 text-xs rounded-full ${
                  activeTab === 'sent' && !searchQuery
                    ? 'bg-blue-500 text-white'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {sentEmails.length}
              </span>
            </button>
          </div>

          {/* Search & Compose */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 sm:w-72">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search via Elasticsearch..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <button
              onClick={() => setIsComposeOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-sm transition whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Compose New Email
            </button>
          </div>
        </div>

        {/* Email Table */}
        {searchQuery.trim() ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-500">
              Showing Elasticsearch results for "{searchQuery}"
            </p>
            <EmailTable emails={searchResults || []} loading={tableLoading} type="search" />
          </div>
        ) : (
          <EmailTable
            emails={activeTab === 'scheduled' ? scheduledEmails : sentEmails}
            loading={tableLoading}
            type={activeTab}
          />
        )}
      </main>

      <ComposeModal
        isOpen={isComposeOpen}
        onClose={() => setIsComposeOpen(false)}
        senders={user.senders || []}
        onSenderAdded={handleSenderAdded}
        onScheduledSuccess={() => {
          fetchEmails();
          showToast('Emails scheduled into BullMQ!');
        }}
      />
    </div>
  );
}

export default App;