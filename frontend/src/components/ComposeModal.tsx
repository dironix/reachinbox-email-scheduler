import React, { useState } from 'react';
import Papa from 'papaparse';
import { X, Upload, Users, Send, Plus, Loader2 } from 'lucide-react';
import type { Sender } from '../types';
import { emailApi } from '../services/api';

interface ComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  senders: Sender[];
  onSenderAdded: (sender: Sender) => void;
  onScheduledSuccess: () => void;
}

export const ComposeModal: React.FC<ComposeModalProps> = ({
  isOpen,
  onClose,
  senders,
  onSenderAdded,
  onScheduledSuccess,
}) => {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [manualEmails, setManualEmails] = useState('');
  const [startTime, setStartTime] = useState(() => {
    const now = new Date(Date.now() + 60_000);
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
  });
  const [delaySeconds, setDelaySeconds] = useState<number>(2);
  const [hourlyLimit, setHourlyLimit] = useState<number>(50);
  const [selectedSenderId, setSelectedSenderId] = useState<string>(senders[0]?.id || '');
  const [submitting, setSubmitting] = useState(false);
  const [addingSender, setAddingSender] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const extractEmails = (rawText: string): string[] => {
    const matches = rawText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
    return Array.from(new Set(matches.map((m) => m.toLowerCase())));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      complete: (results) => {
        const flatText = JSON.stringify(results.data);
        const extracted = extractEmails(flatText);
        setRecipients((prev) => Array.from(new Set([...prev, ...extracted])));
      },
      error: () => {
        // Fallback plain text read
        const reader = new FileReader();
        reader.onload = (ev) => {
          const extracted = extractEmails(String(ev.target?.result || ''));
          setRecipients((prev) => Array.from(new Set([...prev, ...extracted])));
        };
        reader.readAsText(file);
      },
    });
  };

  const handleAddManualEmails = () => {
    if (!manualEmails.trim()) return;
    const extracted = extractEmails(manualEmails);
    setRecipients((prev) => Array.from(new Set([...prev, ...extracted])));
    setManualEmails('');
  };

  const handleCreateSender = async () => {
    try {
      setAddingSender(true);
      const res = await emailApi.addSender();
      onSenderAdded(res.data);
      setSelectedSenderId(res.data.id);
    } catch {
      setError('Failed to provision new Ethereal sender.');
    } finally {
      setAddingSender(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const allRecipients = Array.from(
      new Set([...recipients, ...extractEmails(manualEmails)])
    );

    if (allRecipients.length === 0) {
      setError('Please upload a CSV/TXT file or enter at least one valid email address.');
      return;
    }

    try {
      setSubmitting(true);
      await emailApi.schedule({
        recipients: allRecipients,
        subject,
        body,
        startTime: new Date(startTime).toISOString(),
        delayBetweenEmailsMs: Math.max(0, delaySeconds * 1000),
        hourlyLimit: Math.max(1, hourlyLimit),
        senderId: selectedSenderId || senders[0]?.id,
      });

      setSubject('');
      setBody('');
      setRecipients([]);
      setManualEmails('');
      onScheduledSuccess();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to schedule emails.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-bold text-slate-900">Compose & Schedule Campaign</h2>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 font-medium">
              {error}
            </div>
          )}

          {/* Sender Selection (Multi-Sender Support) */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wide mb-1.5">
              From Sender (Ethereal SMTP)
            </label>
            <div className="flex gap-2">
              <select
                value={selectedSenderId || senders[0]?.id || ''}
                onChange={(e) => setSelectedSenderId(e.target.value)}
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {senders.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.email} (Limit: {s.hourlyLimit}/hr)
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleCreateSender}
                disabled={addingSender}
                className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition cursor-pointer"
              >
                {addingSender ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Plus className="w-3.5 h-3.5" />
                )}
                New Sender
              </button>
            </div>
          </div>

          {/* CSV / TXT Upload + Manual Input */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wide">
                Recipients (Upload CSV/TXT or Paste)
              </label>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-full">
                <Users className="w-3.5 h-3.5" />
                {recipients.length} email addresses detected
              </span>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <label className="flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-lg cursor-pointer bg-slate-50 hover:bg-blue-50/40 transition text-sm font-medium text-slate-700">
                <Upload className="w-4 h-4 text-blue-600" />
                <span>Upload CSV / TXT</span>
                <input
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>

              <div className="flex-1 flex gap-1.5">
                <input
                  type="text"
                  placeholder="Or paste emails (comma/space separated)..."
                  value={manualEmails}
                  onChange={(e) => setManualEmails(e.target.value)}
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={handleAddManualEmails}
                  className="px-3 py-2 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg cursor-pointer"
                >
                  Add
                </button>
              </div>
            </div>
          </div>

          {/* Subject */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wide mb-1.5">
              Subject Line
            </label>
            <input
              type="text"
              required
              placeholder="Quick question about scaling your outbound pipeline..."
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Body */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wide mb-1.5">
              Email Body
            </label>
            <textarea
              required
              rows={4}
              placeholder="Hi there,&#10;&#10;We noticed your team is growing fast..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Scheduling Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Start Time
              </label>
              <input
                type="datetime-local"
                required
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Delay Between Emails (sec)
              </label>
              <input
                type="number"
                min={0}
                max={3600}
                required
                value={delaySeconds}
                onChange={(e) => setDelaySeconds(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Hourly Limit (per sender)
              </label>
              <input
                type="number"
                min={1}
                max={10000}
                required
                value={hourlyLimit}
                onChange={(e) => setHourlyLimit(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Footer Buttons */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg shadow-sm transition cursor-pointer"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              Schedule Emails
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};