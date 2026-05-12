/* BHD: drafts page entry — renders the AI-generated personal post drafts.
   Backend route: /drafts (NestJS controller in apps/backend/src/api/routes/drafts.controller.ts).
   Removing this directory is a clean rollback. */

import { Metadata } from 'next';
import { DraftsComponent } from '@gitroom/frontend/components/drafts/drafts.component';

export const metadata: Metadata = {
  title: 'Drafts',
  description: 'AI-generated personal social drafts ready for review',
};

export default function DraftsPage() {
  return <DraftsComponent />;
}
