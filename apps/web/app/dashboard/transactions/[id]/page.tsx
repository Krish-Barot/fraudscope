'use client';
import { useParams } from 'next/navigation';

export default function TransactionDetailPage() {
  const { id } = useParams();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-100">Transaction Detail</h1>
      <p className="text-slate-400 font-mono text-sm">{id}</p>
      <p className="text-slate-500">Detail view — FS-24</p>
    </div>
  );
}