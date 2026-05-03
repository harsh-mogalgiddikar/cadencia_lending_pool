import { useEffect, useState } from 'react';
import api from '@/lib/api';
import type { KycUser } from '@/lib/types';
import { truncAddr, relTime } from '@/lib/format';
import { Reveal } from '@/components/ui/Reveal';
import { Inbox, Check, X, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

/** Inline confirmation dialog — no external library needed */
function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  confirmClass,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  confirmClass: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-sm mc-card-lg animate-scale-in">
        <div className="flex items-start gap-3 mb-4">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-warning/10 text-warning">
            <AlertTriangle size={18} />
          </div>
          <div>
            <p className="font-medium">{title}</p>
            <p className="text-sm text-muted-foreground mt-1">{body}</p>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="pill-ghost !py-2 !text-xs">Cancel</button>
          <button onClick={onConfirm} className={`pill-ink !py-2 !text-xs ${confirmClass}`}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export default function AdminKyc() {
  const [users, setUsers] = useState<KycUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<{
    action: 'approve' | 'reject';
    address: string;
    name?: string;
  } | null>(null);

  const refresh = () =>
    api.get('/api/kyc/admin/pending')
      .then(r => setUsers(r.data.users ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 10000);
    return () => clearInterval(id);
  }, []);

  const executeAction = async () => {
    if (!confirm) return;
    const { action, address } = confirm;
    setConfirm(null);
    try {
      if (action === 'approve') {
        await api.post('/api/kyc/admin/approve', { address });
        toast.success('Approved — KYC oracle job enqueued');
      } else {
        await api.post('/api/kyc/admin/reject', { address });
        toast.success('Rejected');
      }
      refresh();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? `${action} failed`);
    }
  };

  return (
    <div className="space-y-8">
      <Reveal>
        <header>
          <p className="eyebrow mb-3">Admin · KYC</p>
          <h1 className="text-5xl tracking-tight">KYC <span className="italic font-light">queue</span></h1>
          <p className="text-muted-foreground mt-2 text-sm">Review and verify submitted KYC applications.</p>
        </header>
      </Reveal>

      <Reveal>
        <div className="mc-card-lg">
          {loading ? (
            <div className="text-center py-16 text-sm text-muted-foreground">Loading…</div>
          ) : users.length === 0 ? (
            <div className="text-center py-16">
              <Inbox className="mx-auto mb-4 text-muted-foreground" size={32}/>
              <p className="text-muted-foreground">No pending KYC applications.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wider text-muted-foreground border-b hairline">
                  <tr>
                    <th className="text-left py-3 font-medium">Wallet</th>
                    <th className="text-left font-medium">Business</th>
                    <th className="text-left font-medium">Role</th>
                    <th className="text-left font-medium">Submitted</th>
                    <th className="text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.wallet_address} className="border-b hairline last:border-0">
                      <td className="py-4 mono">{truncAddr(u.wallet_address, 8)}</td>
                      <td>
                        <p>{u.business_name}</p>
                        {u.gstin && <p className="text-xs text-muted-foreground mono">{u.gstin}</p>}
                      </td>
                      <td><span className="status-pill bg-canvas text-ink capitalize">{u.role}</span></td>
                      <td className="text-muted-foreground">{relTime(u.created_at)}</td>
                      <td className="text-right">
                        <div className="inline-flex gap-2">
                          <button
                            onClick={() => setConfirm({ action: 'approve', address: u.wallet_address, name: u.business_name })}
                            className="status-pill status-verified hover:opacity-80"
                          >
                            <Check size={12}/> Approve
                          </button>
                          <button
                            onClick={() => setConfirm({ action: 'reject', address: u.wallet_address, name: u.business_name })}
                            className="status-pill status-rejected hover:opacity-80"
                          >
                            <X size={12}/> Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-6 text-xs text-muted-foreground">{users.length} pending application{users.length !== 1 ? 's' : ''}</p>
        </div>
      </Reveal>

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.action === 'approve' ? 'Approve KYC?' : 'Reject KYC?'}
        body={confirm?.action === 'approve'
          ? `This will enqueue an on-chain KYC oracle write for ${confirm?.name || confirm?.address}. This action cannot be undone.`
          : `Rejecting will mark ${confirm?.name || confirm?.address} as rejected. They can resubmit KYC.`}
        confirmLabel={confirm?.action === 'approve' ? 'Yes, approve' : 'Yes, reject'}
        confirmClass={confirm?.action === 'reject' ? '!bg-destructive' : ''}
        onConfirm={executeAction}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
