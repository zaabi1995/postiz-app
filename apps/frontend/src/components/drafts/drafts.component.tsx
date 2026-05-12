// BHD: drafts UI component.
//
// Tabs:
//   "Pending" — drafts ready for review (default)
//   "History" — drafts you skipped, regenerated, or shipped
// Header: Generate now button + rules card.
//
// Layout matches Postiz design system: newBgColorInner cards, newTextColor
// text, Tailwind 3 utilities only.

'use client';

import { FC, useCallback, useState } from 'react';
import useSWR from 'swr';
import { useRouter } from 'next/navigation';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

interface DraftRow {
  id: string;
  newsItemId: string;
  sourceTitle: string;
  sourceUrl: string;
  sourceName: string;
  category: 'global-ai' | 'gcc-sovereign' | 'ai-security' | 'operator-pulse';
  linkedinBody: string;
  xBody: string;
  imageUrl: string | null;
  status: string;
  createdAt: string;
}

interface DraftsResponse {
  drafts: DraftRow[];
}

const categoryLabel: Record<DraftRow['category'], string> = {
  'global-ai': 'Global AI',
  'gcc-sovereign': 'GCC / Sovereign',
  'ai-security': 'AI Security',
  'operator-pulse': 'Operator Pulse',
};

const statusLabel: Record<string, string> = {
  pending: 'Pending',
  skipped: 'Skipped',
  shipped: 'Shipped',
  regenerated: 'Regenerated',
};

const useDrafts = (mode: 'pending' | 'history') => {
  const fetch = useFetch();
  const path = mode === 'pending' ? '/drafts/list' : '/drafts/history';
  const load = useCallback(async () => (await (await fetch(path)).json()) as DraftsResponse, [fetch, path]);
  return useSWR<DraftsResponse>(`drafts:${mode}`, load, {
    refreshInterval: mode === 'pending' ? 30_000 : 0,
  });
};

export const DraftsComponent: FC = () => {
  const [mode, setMode] = useState<'pending' | 'history'>('pending');
  const [showRules, setShowRules] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const { data, isLoading, mutate } = useDrafts(mode);
  const router = useRouter();
  const fetch = useFetch();

  const onLaunch = useCallback(async (draftId: string) => {
    const res = await fetch(`/drafts/${draftId}/launch`, { method: 'POST' });
    if (!res.ok) return;
    const json = (await res.json()) as { postId: string };
    router.push(`/launches?id=${json.postId}`);
  }, [fetch, router]);

  const onSkip = useCallback(async (draftId: string) => {
    await fetch(`/drafts/${draftId}/skip`, { method: 'POST' });
    void mutate();
  }, [fetch, mutate]);

  const onRegenerate = useCallback(async (draftId: string) => {
    await fetch(`/drafts/${draftId}/regenerate`, { method: 'POST' });
    void mutate();
  }, [fetch, mutate]);

  const onGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      const res = await fetch('/drafts/generate', { method: 'POST' });
      const json = (await res.json()) as { queued: number; nextRunWithinMinutes: number };
      if (json.queued > 0) {
        setToast(`Queued ${json.queued} drafts. They'll appear within ~${json.nextRunWithinMinutes} min.`);
      } else {
        setToast('No fresh news items to queue. Ingester runs hourly; try again later.');
      }
      setTimeout(() => setToast(null), 6000);
    } finally {
      setGenerating(false);
    }
  }, [fetch]);

  return (
    <div className="flex flex-col flex-1 bg-newBgColorInner overflow-auto">
      <div className="p-[24px] flex flex-col gap-[20px]">
        {/* Header */}
        <div className="flex items-start justify-between gap-[16px]">
          <div>
            <div className="text-[20px] font-[600] text-newTextColor">Drafts</div>
            <div className="text-[14px] text-textItemBlur mt-[4px]">
              AI-generated personal social drafts. Pick one to edit and schedule, or skip and the system learns.
            </div>
          </div>
          <button
            onClick={onGenerate}
            disabled={generating}
            className="px-[18px] py-[10px] bg-newButtonColor text-newTextColor rounded-[8px] text-[13px] font-[600] hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
          >
            {generating ? 'Queuing...' : '+ Generate now'}
          </button>
        </div>

        {toast && (
          <div className="px-[16px] py-[12px] bg-newBgLineColor rounded-[8px] text-[13px] text-newTextColor">
            {toast}
          </div>
        )}

        {/* Rules card */}
        <div className="bg-newBgColor border border-blockSeparator rounded-[12px] p-[20px]">
          <div className="flex items-center justify-between mb-[10px]">
            <div className="text-[14px] font-[600] text-newTextColor">Drafter rules</div>
            <button
              onClick={() => setShowRules((v) => !v)}
              className="text-[12px] text-textItemBlur hover:text-newTextColor"
            >
              {showRules ? 'Hide' : 'Show'}
            </button>
          </div>
          {showRules && (
            <div className="text-[13px] text-textItemBlur leading-[1.6]">
              <p className="mb-[8px]"><span className="text-newTextColor font-[600]">Audience:</span> GCC sovereign-tech officials, ITHCA/OIA-tier executives, ministry heads. Reader is in the room on these decisions.</p>
              <p className="mb-[8px]"><span className="text-newTextColor font-[600]">Voice:</span> Measured, institutional, not founder-bro. No "we built X for this". Vision 2040 + GCC peer context where natural.</p>
              <p className="mb-[8px]"><span className="text-newTextColor font-[600]">LinkedIn:</span> Bilingual. Arabic block (350-650 chars) + blank line + English block (350-650 chars). Not word-for-word translations. Total 700-1300 chars, hard ceiling 1500.</p>
              <p className="mb-[8px]"><span className="text-newTextColor font-[600]">X:</span> Always Arabic. &lt;230 chars target, hard ceiling 270.</p>
              <p className="mb-[8px]"><span className="text-newTextColor font-[600]">Banned:</span> em-dashes, hashtags, emoji, closing-question CTAs, GPT-isms (delve, leverage, paradigm), founder-bro framings ("we built Hosn for"), parallel triplets, markdown bold.</p>
              <p><span className="text-newTextColor font-[600]">Learning loop:</span> Every skip becomes a negative training example. The drafter sees the last 8 skipped drafts per category and is told to avoid them.</p>
            </div>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex gap-[2px] bg-newBgColor rounded-[8px] p-[3px] w-fit border border-blockSeparator">
          <button
            onClick={() => setMode('pending')}
            className={`px-[14px] py-[6px] rounded-[6px] text-[13px] ${mode === 'pending' ? 'bg-newBgColorInner text-newTextColor font-[600]' : 'text-textItemBlur hover:text-newTextColor'}`}
          >
            Pending {mode === 'pending' && data?.drafts ? `(${data.drafts.length})` : ''}
          </button>
          <button
            onClick={() => setMode('history')}
            className={`px-[14px] py-[6px] rounded-[6px] text-[13px] ${mode === 'history' ? 'bg-newBgColorInner text-newTextColor font-[600]' : 'text-textItemBlur hover:text-newTextColor'}`}
          >
            History
          </button>
        </div>

        {/* Drafts list */}
        {isLoading && <div className="text-textItemBlur">Loading drafts...</div>}
        {!isLoading && (!data || data.drafts.length === 0) && (
          <div className="text-textItemBlur p-[24px] bg-newBgColor rounded-[12px] border border-blockSeparator">
            {mode === 'pending'
              ? 'No drafts pending. Click "Generate now" or wait for the next scheduled run (every 10 minutes).'
              : 'No history yet. Once you skip or regenerate drafts, they will appear here.'}
          </div>
        )}

        {data?.drafts.map((draft) => (
          <DraftCard
            key={draft.id}
            draft={draft}
            mode={mode}
            onLaunch={onLaunch}
            onSkip={onSkip}
            onRegenerate={onRegenerate}
          />
        ))}
      </div>
    </div>
  );
};

const DraftCard: FC<{
  draft: DraftRow;
  mode: 'pending' | 'history';
  onLaunch: (id: string) => void;
  onSkip: (id: string) => void;
  onRegenerate: (id: string) => void;
}> = ({ draft, mode, onLaunch, onSkip, onRegenerate }) => {
  return (
    <div className="bg-newBgColor rounded-[12px] border border-blockSeparator p-[20px] flex flex-col gap-[16px]">
      <div className="flex items-start gap-[12px]">
        <div className="text-[11px] font-[600] uppercase tracking-wide px-[8px] py-[3px] bg-newBgLineColor rounded-[6px] text-textItemBlur whitespace-nowrap">
          {categoryLabel[draft.category]}
        </div>
        {mode === 'history' && (
          <div className={`text-[11px] font-[600] uppercase tracking-wide px-[8px] py-[3px] rounded-[6px] whitespace-nowrap ${
            draft.status === 'shipped' ? 'bg-green-900/30 text-green-300' :
            draft.status === 'skipped' ? 'bg-red-900/30 text-red-300' :
            'bg-yellow-900/30 text-yellow-300'
          }`}>
            {statusLabel[draft.status] || draft.status}
          </div>
        )}
        <div className="flex-1">
          <a
            href={draft.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[14px] font-[600] text-newTextColor hover:underline"
          >
            {draft.sourceTitle}
          </a>
          <div className="text-[11px] text-textItemBlur mt-[2px]">
            {draft.sourceName} · {new Date(draft.createdAt).toLocaleString()}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-[16px]">
        <div className="flex flex-col gap-[12px]">
          <DraftPreview label="LinkedIn (bilingual)" body={draft.linkedinBody} maxChars={1500} />
          <DraftPreview label="X (Arabic)" body={draft.xBody} maxChars={280} rtl />
        </div>
        {draft.imageUrl && (
          <div className="flex flex-col gap-[6px]">
            <div className="text-[11px] text-textItemBlur uppercase tracking-wide">Cover image</div>
            <img
              src={draft.imageUrl}
              alt="Cover preview"
              className="w-full rounded-[8px] border border-blockSeparator"
            />
          </div>
        )}
      </div>

      {mode === 'pending' && (
        <div className="flex gap-[8px]">
          <button
            onClick={() => onLaunch(draft.id)}
            className="px-[16px] py-[8px] bg-newButtonColor text-newTextColor rounded-[8px] text-[13px] font-[600] hover:opacity-90"
          >
            Edit &amp; schedule
          </button>
          <button
            onClick={() => onRegenerate(draft.id)}
            className="px-[16px] py-[8px] bg-newBgLineColor text-newTextColor rounded-[8px] text-[13px] hover:opacity-90"
          >
            Regenerate
          </button>
          <button
            onClick={() => onSkip(draft.id)}
            className="px-[16px] py-[8px] text-textItemBlur rounded-[8px] text-[13px] hover:text-newTextColor"
          >
            Skip
          </button>
        </div>
      )}
    </div>
  );
};

const DraftPreview: FC<{ label: string; body: string; maxChars?: number; rtl?: boolean }> = ({
  label,
  body,
  maxChars,
  rtl,
}) => {
  const len = body.length;
  const overLimit = maxChars && len > maxChars;
  return (
    <div className="bg-newBgColorInner rounded-[8px] p-[12px]">
      <div className="flex items-center gap-[8px] mb-[8px]">
        <div className="text-[11px] font-[600] uppercase tracking-wide text-textItemBlur">{label}</div>
        <div className={`text-[11px] ${overLimit ? 'text-red-400' : 'text-textItemBlur'}`}>
          {len} chars{maxChars ? ` / ${maxChars}` : ''}
        </div>
      </div>
      <div
        className="text-[13px] text-newTextColor whitespace-pre-wrap leading-[1.6]"
        dir={rtl ? 'rtl' : 'auto'}
      >
        {body}
      </div>
    </div>
  );
};
