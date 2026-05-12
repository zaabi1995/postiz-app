/* BHD: drafts UI component.
 *
 * Loads pending personal-content drafts from /drafts/list and renders them as
 * cards. Each card shows the source headline, LinkedIn preview, X preview,
 * and the AI-generated cover image. Buttons:
 *   - "Edit & schedule" → posts to /drafts/<id>/launch which creates a Postiz
 *     post in draft state and redirects to /launches?id=<postId> so the user
 *     can tweak in the native composer and schedule.
 *   - "Skip" → marks the draft as skipped (the news_item gets a skip signal
 *     so future ranking knows the user didn't want it).
 *   - "Regenerate" → triggers a fresh drafter run for the underlying news_item.
 *
 * Layout matches Postiz design system: newBgColorInner cards, newTextColor
 * text, Tailwind 3 utilities only (no --color-custom* per project CLAUDE.md).
 */

'use client';

import { FC, useCallback } from 'react';
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
  createdAt: string;
}

interface DraftsListResponse {
  drafts: DraftRow[];
}

const categoryLabel: Record<DraftRow['category'], string> = {
  'global-ai': 'Global AI',
  'gcc-sovereign': 'GCC / Sovereign',
  'ai-security': 'AI Security',
  'operator-pulse': 'Operator Pulse',
};

const useDrafts = () => {
  const fetch = useFetch();
  const load = useCallback(async () => (await (await fetch('/drafts/list')).json()) as DraftsListResponse, [fetch]);
  return useSWR<DraftsListResponse>('drafts/list', load, {
    refreshInterval: 60_000,
  });
};

export const DraftsComponent: FC = () => {
  const { data, isLoading, mutate } = useDrafts();
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

  return (
    <div className="flex flex-col flex-1 bg-newBgColorInner overflow-auto">
      <div className="p-[24px] flex flex-col gap-[24px]">
        <div>
          <div className="text-[20px] font-[600] text-newTextColor">Drafts</div>
          <div className="text-[14px] text-textItemBlur mt-[4px]">
            AI-generated personal social drafts. Pick one to edit and schedule, or skip.
          </div>
        </div>

        {isLoading && <div className="text-textItemBlur">Loading drafts...</div>}
        {!isLoading && (!data || data.drafts.length === 0) && (
          <div className="text-textItemBlur p-[24px] bg-newBgColor rounded-[12px] border border-blockSeparator">
            No drafts pending. The drafter runs daily at 07:00 Muscat. Check back tomorrow.
          </div>
        )}

        {data?.drafts.map((draft) => (
          <DraftCard
            key={draft.id}
            draft={draft}
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
  onLaunch: (id: string) => void;
  onSkip: (id: string) => void;
  onRegenerate: (id: string) => void;
}> = ({ draft, onLaunch, onSkip, onRegenerate }) => {
  return (
    <div className="bg-newBgColor rounded-[12px] border border-blockSeparator p-[20px] flex flex-col gap-[16px]">
      <div className="flex items-start gap-[12px]">
        <div className="text-[11px] font-[600] uppercase tracking-wide px-[8px] py-[3px] bg-newBgLineColor rounded-[6px] text-textItemBlur">
          {categoryLabel[draft.category]}
        </div>
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
          <DraftPreview label="LinkedIn" body={draft.linkedinBody} />
          <DraftPreview label="X" body={draft.xBody} maxChars={280} />
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
    </div>
  );
};

const DraftPreview: FC<{ label: string; body: string; maxChars?: number }> = ({
  label,
  body,
  maxChars,
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
      <div className="text-[13px] text-newTextColor whitespace-pre-wrap leading-[1.55]">{body}</div>
    </div>
  );
};
