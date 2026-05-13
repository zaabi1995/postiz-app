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
  const [showRules, setShowRules] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [composePrompt, setComposePrompt] = useState('');
  const [composing, setComposing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const { data, isLoading, mutate } = useDrafts(mode);
  const router = useRouter();
  const fetch = useFetch();

  const onCopyAndOpen = useCallback(async (draft: DraftRow) => {
    const blob = `${draft.linkedinBody}\n\n---\n\nX (Arabic):\n${draft.xBody}${draft.imageUrl ? `\n\nImage: ${draft.imageUrl}` : ''}`;
    try {
      await navigator.clipboard.writeText(blob);
      setToast('Copied LinkedIn + X + image URL to clipboard. Opening Postiz composer...');
    } catch {
      setToast('Clipboard blocked by browser. Open the draft body manually.');
    }
    setTimeout(() => setToast(null), 5000);
    window.open('/launches', '_blank');
  }, []);

  const onCopyOne = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setToast(`Copied ${label} to clipboard.`);
    } catch {
      setToast('Clipboard blocked by browser.');
    }
    setTimeout(() => setToast(null), 3500);
  }, []);

  const onShip = useCallback(async (draftId: string) => {
    await fetch(`/drafts/${draftId}/ship`, { method: 'POST' });
    setToast('Marked as shipped. Moved to History.');
    setTimeout(() => setToast(null), 4000);
    void mutate();
  }, [fetch, mutate]);

  const onSkip = useCallback(async (draftId: string) => {
    await fetch(`/drafts/${draftId}/skip`, { method: 'POST' });
    void mutate();
  }, [fetch, mutate]);

  const onRegenerate = useCallback(async (draftId: string) => {
    await fetch(`/drafts/${draftId}/regenerate`, { method: 'POST' });
    void mutate();
  }, [fetch, mutate]);

  const onCompose = useCallback(async () => {
    if (composePrompt.trim().length < 15) {
      setToast('Type at least 15 characters describing what you want to post about.');
      setTimeout(() => setToast(null), 4000);
      return;
    }
    setComposing(true);
    try {
      const res = await fetch('/drafts/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: composePrompt.trim() }),
      });
      const json = (await res.json()) as { ok: boolean; message: string };
      setToast(json.message);
      if (json.ok) {
        setComposePrompt('');
        setShowCompose(false);
      }
      setTimeout(() => setToast(null), 6000);
    } finally {
      setComposing(false);
    }
  }, [fetch, composePrompt]);

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
              Bilingual personal posts in your voice. Tell the engine what to write about, or let it pick from Omani/GCC news.
            </div>
          </div>
          <div className="flex gap-[8px]">
            <button
              onClick={() => setShowCompose((v) => !v)}
              className="px-[18px] py-[10px] bg-newButtonColor text-newTextColor rounded-[8px] text-[13px] font-[600] hover:opacity-90 whitespace-nowrap"
            >
              {showCompose ? 'Cancel' : '+ Write a post'}
            </button>
            <button
              onClick={onGenerate}
              disabled={generating}
              className="px-[18px] py-[10px] bg-newBgLineColor text-newTextColor rounded-[8px] text-[13px] hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
            >
              {generating ? 'Queuing...' : 'Pick from news'}
            </button>
          </div>
        </div>

        {/* Compose card */}
        {showCompose && (
          <div className="bg-newBgColor border border-blockSeparator rounded-[12px] p-[20px]">
            <div className="text-[14px] font-[600] text-newTextColor mb-[6px]">Tell the engine what to post about</div>
            <div className="text-[12px] text-textItemBlur mb-[12px] leading-[1.5]">
              Type a few sentences in any language. Mention people by name, name the event, give the result. The engine drafts a bilingual post in your voice (Arabic + English on LinkedIn, Arabic on X), with a cover image.
              <br />
              Example: "Attended the ITHCA cohort 4 graduation today at OAPP. Dr Salim Al-Ismaili spoke. 18 founders graduated, 3 already signed funding rounds. First cohort to include 4 female founders."
            </div>
            <textarea
              value={composePrompt}
              onChange={(e) => setComposePrompt(e.target.value)}
              placeholder="What do you want to post about?"
              rows={5}
              className="w-full px-[12px] py-[10px] bg-newBgColorInner border border-blockSeparator rounded-[8px] text-[14px] text-newTextColor resize-y"
            />
            <div className="flex items-center justify-between mt-[10px]">
              <div className="text-[11px] text-textItemBlur">
                {composePrompt.length} chars{composePrompt.length < 15 && composePrompt.length > 0 ? ' (need ≥15)' : ''}
              </div>
              <button
                onClick={onCompose}
                disabled={composing || composePrompt.trim().length < 15}
                className="px-[18px] py-[8px] bg-newButtonColor text-newTextColor rounded-[8px] text-[13px] font-[600] hover:opacity-90 disabled:opacity-50"
              >
                {composing ? 'Queuing...' : 'Draft this'}
              </button>
            </div>
          </div>
        )}

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
              <p className="mb-[8px]"><span className="text-newTextColor font-[600]">Audience:</span> ITHCA/OIA-tier executives, GCC sovereign-tech officials, ministry heads. Reader is in the room on these decisions.</p>
              <p className="mb-[8px]"><span className="text-newTextColor font-[600]">Voice:</span> Measured, institutional, not founder-bro. No "we built X for this". Vision 2040 + GCC peer context where natural.</p>
              <p className="mb-[8px]"><span className="text-newTextColor font-[600]">Sources:</span> Tell the engine what to write about ("Write a post"), or it picks from Oman Observer, Times of Oman, ITHCA/OIA, MGX, G42, Gulf Business. Global AI/HN/arxiv dropped (not your beat).</p>
              <p className="mb-[8px]"><span className="text-newTextColor font-[600]">LinkedIn:</span> Bilingual. Arabic + English, not word-for-word. 700-1300 chars target.</p>
              <p className="mb-[8px]"><span className="text-newTextColor font-[600]">X:</span> Always Arabic. &lt;230 chars target.</p>
              <p className="mb-[8px]"><span className="text-newTextColor font-[600]">Banned:</span> em-dashes, GPT-isms (delve, leverage, paradigm), founder-bro framings, closing-question CTAs, parallel triplets.</p>
              <p><span className="text-newTextColor font-[600]">Learning loop:</span> Every skip becomes a negative training example. The drafter sees the last 8 skipped drafts per category and avoids those patterns.</p>
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
              ? 'No drafts pending. Click "+ Write a post" to seed one from your own notes, or "Pick from news" to draft from the latest Omani/GCC headlines.'
              : 'No history yet. Once you skip or regenerate drafts, they will appear here.'}
          </div>
        )}

        {data?.drafts.map((draft) => (
          <DraftCard
            key={draft.id}
            draft={draft}
            mode={mode}
            onCopyAndOpen={onCopyAndOpen}
            onCopyOne={onCopyOne}
            onShip={onShip}
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
  onCopyAndOpen: (draft: DraftRow) => void;
  onCopyOne: (text: string, label: string) => void;
  onShip: (id: string) => void;
  onSkip: (id: string) => void;
  onRegenerate: (id: string) => void;
}> = ({ draft, mode, onCopyAndOpen, onCopyOne, onShip, onSkip, onRegenerate }) => {
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
        <div className="flex gap-[8px] flex-wrap">
          <button
            onClick={() => onCopyAndOpen(draft)}
            className="px-[16px] py-[8px] bg-newButtonColor text-newTextColor rounded-[8px] text-[13px] font-[600] hover:opacity-90"
            title="Copies LinkedIn + X + image URL to clipboard and opens Postiz composer in a new tab"
          >
            Copy &amp; open in Postiz ↗
          </button>
          <button
            onClick={() => onCopyOne(draft.linkedinBody, 'LinkedIn')}
            className="px-[12px] py-[8px] bg-newBgLineColor text-newTextColor rounded-[8px] text-[12px] hover:opacity-90"
          >
            Copy LinkedIn
          </button>
          <button
            onClick={() => onCopyOne(draft.xBody, 'X')}
            className="px-[12px] py-[8px] bg-newBgLineColor text-newTextColor rounded-[8px] text-[12px] hover:opacity-90"
          >
            Copy X
          </button>
          <button
            onClick={() => onShip(draft.id)}
            className="px-[14px] py-[8px] bg-green-900/40 text-green-300 rounded-[8px] text-[12px] hover:bg-green-900/60"
            title="Mark this draft as shipped (after you've scheduled it in Postiz). Moves it to History."
          >
            ✓ Mark as shipped
          </button>
          <div className="flex-1" />
          <button
            onClick={() => onRegenerate(draft.id)}
            className="px-[12px] py-[8px] text-textItemBlur rounded-[8px] text-[12px] hover:text-newTextColor"
          >
            Regenerate
          </button>
          <button
            onClick={() => onSkip(draft.id)}
            className="px-[12px] py-[8px] text-textItemBlur rounded-[8px] text-[12px] hover:text-red-300"
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
