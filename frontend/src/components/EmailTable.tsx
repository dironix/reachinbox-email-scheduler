import React from 'react';
import { Clock, CheckCircle, AlertTriangle, XCircle, Loader2, Inbox } from 'lucide-react';
import type { EmailJobItem, EmailStatus } from '../types';

interface EmailTableProps {
  emails: EmailJobItem[];
  loading: boolean;
  type: 'scheduled' | 'sent' | 'search';
}

const StatusBadge: React.FC<{ status: EmailStatus }> = ({ status }) => {
  switch (status) {
    case 'SENT':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
          <CheckCircle className="w-3 h-3" /> Sent
        </span>
      );
    case 'SCHEDULED':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
          <Clock className="w-3 h-3" /> Scheduled
        </span>
      );
    case 'RATE_LIMITED':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
          <AlertTriangle className="w-3 h-3" /> Delayed (Rate Limit)
        </span>
      );
    case 'PROCESSING':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
          <Loader2 className="w-3 h-3 animate-spin" /> Sending...
        </span>
      );
    case 'FAILED':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200">
          <XCircle className="w-3 h-3" /> Failed
        </span>
      );
  }
};

export const EmailTable: React.FC<EmailTableProps> = ({ emails, loading, type }) => {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 flex flex-col items-center justify-center text-slate-500">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-3" />
        <p className="text-sm font-medium">Loading emails...</p>
      </div>
    );
  }

  if (emails.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-14 flex flex-col items-center justify-center text-center">
        <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-3">
          <Inbox className="w-6 h-6" />
        </div>
        <h3 className="text-sm font-semibold text-slate-900">
          {type === 'scheduled'
            ? 'No scheduled emails yet'
            : type === 'sent'
            ? 'No sent emails yet'
            : 'No matching emails found'}
        </h3>
        <p className="text-xs text-slate-500 mt-1 max-w-sm">
          {type === 'scheduled'
            ? 'Click "Compose New Email" to upload a CSV lead list and schedule your outreach.'
            : 'Once your scheduled jobs execute via BullMQ, they will appear here automatically.'}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase tracking-wider">
              <th className="py-3.5 px-4">Recipient Email</th>
              <th className="py-3.5 px-4">Subject</th>
              <th className="py-3.5 px-4">Sender</th>
              <th className="py-3.5 px-4">
                {type === 'sent' ? 'Sent Time' : 'Scheduled Time'}
              </th>
              <th className="py-3.5 px-4">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-sm">
            {emails.map((item) => {
              const displayTime =
                type === 'sent' && item.sentAt ? item.sentAt : item.scheduledAt;
              const senderAddr = item.sender?.email || item.senderEmail || 'Default Ethereal';

              return (
                <tr key={item.id} className="hover:bg-slate-50/80 transition">
                  <td className="py-3.5 px-4 font-medium text-slate-900">
                    {item.recipientEmail}
                  </td>
                  <td className="py-3.5 px-4 text-slate-700 max-w-xs truncate">
                    {item.subject}
                  </td>
                  <td className="py-3.5 px-4 text-xs text-slate-500 font-mono">
                    {senderAddr}
                  </td>
                  <td className="py-3.5 px-4 text-slate-600 text-xs whitespace-nowrap">
                    {new Date(displayTime).toLocaleString()}
                  </td>
                  <td className="py-3.5 px-4 whitespace-nowrap">
                    <StatusBadge status={item.status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};