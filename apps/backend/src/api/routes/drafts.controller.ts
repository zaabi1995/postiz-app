// BHD: drafts controller — backs the personal-content "Drafts" sidebar tab.
//
// Endpoints:
//   GET  /drafts/list          - pending drafts joined with news_items
//   GET  /drafts/history       - all drafts (pending/skipped/shipped/regenerated), newest first
//   POST /drafts/generate      - queue 2 fresh news_items as 'priority' for next drafter run
//   POST /drafts/:id/skip      - mark draft skipped (negative training signal)
//   POST /drafts/:id/regenerate - mark draft regenerated + flip news_item back to 'new'
//   POST /drafts/:id/launch    - placeholder for future PostsService wiring
//
// Survivability:
//   Talks to our news.NewsDraft + news.NewsItem tables via raw SQL through the
//   existing PrismaService. No modifications to Postiz's prisma schema.

import { Controller, Delete, Get, Post, Body, Param, Query, Logger } from '@nestjs/common';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';

interface DraftRow {
  id: string;
  newsItemId: string;
  linkedinBody: string;
  xBody: string;
  imageUrl: string | null;
  status: string;
  createdAt: Date;
  sourceTitle: string;
  sourceUrl: string;
  sourceName: string;
  category: string;
  metadata?: { images?: string[]; suggestedTags?: string[] } | null;
}

function enrichDraft(r: any): DraftRow {
  const images = Array.isArray(r?.metadata?.images) ? r.metadata.images : (r.imageUrl ? [r.imageUrl] : []);
  const suggestedTags = Array.isArray(r?.metadata?.suggestedTags) ? r.metadata.suggestedTags : [];
  return { ...r, metadata: { images, suggestedTags } };
}

@ApiTags('Drafts')
@Controller('/drafts')
export class DraftsController {
  private readonly logger = new Logger(DraftsController.name);

  constructor(
    private prisma: PrismaService,
    private postsService: PostsService,
    private integrationService: IntegrationService,
  ) {}

  // Audit log helper. Reads the current draft row and inserts a history row
  // with the given action. Best-effort: never throws back up to the caller.
  private async snapshotDraft(draftId: string, action: string, notes?: string): Promise<void> {
    try {
      const rows = await this.prisma.$queryRawUnsafe<Array<any>>(
        `SELECT "linkedinBody", "xBody", "imageUrl", status, metadata FROM news."NewsDraft" WHERE id = $1 LIMIT 1`,
        draftId
      );
      const r = rows[0];
      if (!r) return;
      const histId = `hist_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO news."NewsDraftHistory"
           (id, "draftId", action, "linkedinBody", "xBody", "imageUrl", status, metadata, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
        histId, draftId, action, r.linkedinBody, r.xBody, r.imageUrl, r.status,
        JSON.stringify(r.metadata || {}), notes || null
      );
    } catch (err) {
      this.logger.warn(`snapshotDraft(${action}) failed: ${(err as Error).message}`);
    }
  }

  @Get('/list')
  async list(@GetOrgFromRequest() _org: Organization): Promise<{ drafts: DraftRow[] }> {
    try {
      const rows = await this.prisma.$queryRawUnsafe<DraftRow[]>(
        `SELECT
           d.id,
           d."newsItemId",
           d."linkedinBody",
           d."xBody",
           d."imageUrl",
           d.status,
           d."createdAt",
           d.metadata       AS metadata,
           n.title          AS "sourceTitle",
           n.url            AS "sourceUrl",
           n.source         AS "sourceName",
           n.category       AS category
         FROM news."NewsDraft" d
         JOIN news."NewsItem"  n ON n.id = d."newsItemId"
         WHERE d.status = 'pending'
         ORDER BY d."createdAt" DESC
         LIMIT 50`
      );
      return { drafts: rows.map(enrichDraft) };
    } catch (err) {
      this.logger.warn(`drafts/list query failed: ${(err as Error).message}`);
      return { drafts: [] };
    }
  }

  @Get('/history')
  async history(
    @GetOrgFromRequest() _org: Organization,
    @Query('status') status?: string
  ): Promise<{ drafts: DraftRow[] }> {
    try {
      let where = `d.status != 'pending'`;
      let params: string[] = [];
      if (status && ['skipped', 'shipped', 'regenerated', 'pending'].includes(status)) {
        where = `d.status = $1`;
        params = [status];
      }
      const rows = await this.prisma.$queryRawUnsafe<DraftRow[]>(
        `SELECT
           d.id,
           d."newsItemId",
           d."linkedinBody",
           d."xBody",
           d."imageUrl",
           d.status,
           d."createdAt",
           d.metadata       AS metadata,
           n.title          AS "sourceTitle",
           n.url            AS "sourceUrl",
           n.source         AS "sourceName",
           n.category       AS category
         FROM news."NewsDraft" d
         JOIN news."NewsItem"  n ON n.id = d."newsItemId"
         WHERE ${where}
         ORDER BY d."createdAt" DESC
         LIMIT 100`,
        ...params
      );
      return { drafts: rows.map(enrichDraft) };
    } catch (err) {
      this.logger.warn(`drafts/history query failed: ${(err as Error).message}`);
      return { drafts: [] };
    }
  }

  @Post('/compose')
  async compose(
    @GetOrgFromRequest() _org: Organization,
    @Body() body: { prompt?: string; images?: Array<{ url?: string; dataUrl?: string }> }
  ): Promise<{ ok: boolean; itemId?: string; message: string }> {
    const prompt = (body?.prompt || '').trim();
    const incomingImages = Array.isArray(body?.images) ? body.images.slice(0, 4) : [];
    if (prompt.length < 15) {
      return { ok: false, message: 'Please type at least 15 characters describing what you want to post about.' };
    }
    if (prompt.length > 4000) {
      return { ok: false, message: 'Prompt too long. Keep it under 4000 characters.' };
    }

    try {
      const id = `manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const title = prompt.slice(0, 120).replace(/\s+/g, ' ');
      const urlPlaceholder = `urn:manual:${id}`;

      // Save attached photos first so we have URLs to store in metadata.
      const preuploadedImages: string[] = [];
      const { writeFileSync, mkdirSync, existsSync } = await import('node:fs');
      const { resolve } = await import('node:path');
      const day = new Date().toISOString().slice(0, 10);
      const dir = `/uploads/drafts/${day}`;
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      for (const img of incomingImages) {
        try {
          let buf: Buffer; let ext = 'jpg';
          if (img?.dataUrl) {
            const m = img.dataUrl.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
            if (!m) continue;
            ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
            buf = Buffer.from(m[2], 'base64');
          } else if (img?.url) {
            const r = await fetch(img.url, { redirect: 'follow' });
            if (!r.ok) continue;
            buf = Buffer.from(await r.arrayBuffer());
            const ct = (r.headers.get('content-type') || '').toLowerCase();
            ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg';
          } else {
            continue;
          }
          if (buf.length > 10 * 1024 * 1024) continue; // skip too-large
          const fname = `compose-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
          writeFileSync(resolve(dir, fname), buf);
          preuploadedImages.push(`https://social.alizaabi.om/uploads/drafts/${day}/${fname}`);
        } catch (err) {
          this.logger.warn(`compose: image upload skipped: ${(err as Error).message}`);
        }
      }

      const metadata = {
        kind: preuploadedImages.length > 0 ? 'manual-with-photos' : 'manual-compose',
        preuploadedImages,
      };

      await this.prisma.$executeRawUnsafe(
        `INSERT INTO news."NewsItem"
           (id, url, "urlHash", title, summary, content, source, category, "publishedAt", "fetchedAt", score, status, metadata)
         VALUES
           ($1, $2, MD5($2), $3, $4, $4, 'manual', 'manual', NOW(), NOW(), 5.0, 'priority', $5::jsonb)`,
        id, urlPlaceholder, title, prompt, JSON.stringify(metadata)
      );

      const photoNote = preuploadedImages.length > 0 ? ` with ${preuploadedImages.length} photo${preuploadedImages.length > 1 ? 's' : ''}` : '';
      return {
        ok: true,
        itemId: id,
        message: `Queued${photoNote}. Your draft will appear here within ~10 minutes.`,
      };
    } catch (err) {
      this.logger.error(`drafts/compose failed: ${(err as Error).message}`);
      return { ok: false, message: `Failed to queue: ${(err as Error).message}` };
    }
  }

  @Get('/:id/history')
  async getHistory(
    @GetOrgFromRequest() _org: Organization,
    @Param('id') id: string
  ): Promise<{ versions: any[] }> {
    try {
      const rows = await this.prisma.$queryRawUnsafe(
        `SELECT id, "draftId", "snapshotAt", action, "linkedinBody", "xBody", "imageUrl", status, metadata, notes
           FROM news."NewsDraftHistory"
          WHERE "draftId" = $1
          ORDER BY "snapshotAt" DESC
          LIMIT 50`,
        id
      );
      return { versions: rows as any[] };
    } catch (err) {
      this.logger.warn(`drafts/${id}/history failed: ${(err as Error).message}`);
      return { versions: [] };
    }
  }

  @Post('/:id/restore/:versionId')
  async restoreVersion(
    @GetOrgFromRequest() _org: Organization,
    @Param('id') id: string,
    @Param('versionId') versionId: string
  ): Promise<{ ok: boolean; message?: string }> {
    try {
      const rows = await this.prisma.$queryRawUnsafe<Array<any>>(
        `SELECT "linkedinBody", "xBody", "imageUrl", metadata FROM news."NewsDraftHistory" WHERE id = $1 AND "draftId" = $2 LIMIT 1`,
        versionId, id
      );
      const v = rows[0];
      if (!v) return { ok: false, message: 'Version not found' };
      await this.prisma.$executeRawUnsafe(
        `UPDATE news."NewsDraft"
            SET "linkedinBody" = $1, "xBody" = $2, "imageUrl" = $3,
                metadata = $4::jsonb, "aliEdited" = true, "updatedAt" = NOW()
          WHERE id = $5`,
        v.linkedinBody, v.xBody, v.imageUrl, JSON.stringify(v.metadata || {}), id
      );
      await this.snapshotDraft(id, 'restored', `restored from version ${versionId}`);
      return { ok: true };
    } catch (err) {
      this.logger.error(`restoreVersion failed: ${(err as Error).message}`);
      return { ok: false, message: (err as Error).message };
    }
  }

  @Post('/generate')
  async generate(@GetOrgFromRequest() _org: Organization): Promise<{ queued: number; nextRunWithinMinutes: number }> {
    // Mark up to 2 fresh news_items as 'priority' so the next drafter run
    // picks them ahead of the bucket-based selection. The drafter timer
    // fires every 10 minutes, so users see new drafts within ~10 min.
    try {
      const result = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `UPDATE news."NewsItem"
           SET status = 'priority'
         WHERE id IN (
           SELECT id FROM news."NewsItem"
             WHERE status = 'new'
             ORDER BY score DESC NULLS LAST, "publishedAt" DESC
             LIMIT 2
         )
         RETURNING id`
      );
      return { queued: result.length, nextRunWithinMinutes: 10 };
    } catch (err) {
      this.logger.warn(`drafts/generate failed: ${(err as Error).message}`);
      return { queued: 0, nextRunWithinMinutes: 10 };
    }
  }

  /**
   * Create a real Postiz Post (state=DRAFT) from this draft so the user
   * lands in Postiz's native composer with text + images + channels
   * already populated. One-click flow, no clipboard.
   *
   * Returns { groupId } so the UI can redirect to /launches?group=<id>
   * where Postiz's calendar will surface the new draft.
   */
  @Post('/:id/launch')
  async launch(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ): Promise<{ ok: boolean; groupId?: string; postIds?: string[]; message?: string }> {
    try {
      // Fetch the draft
      const rows = await this.prisma.$queryRawUnsafe<Array<any>>(
        `SELECT "linkedinBody", "xBody", "imageUrl", metadata FROM news."NewsDraft" WHERE id = $1 LIMIT 1`,
        id
      );
      const draft = rows[0];
      if (!draft) return { ok: false, message: 'Draft not found' };
      const images: string[] = Array.isArray(draft?.metadata?.images) ? draft.metadata.images : (draft.imageUrl ? [draft.imageUrl] : []);

      // Find the user's connected LinkedIn + X integrations
      const integrations = await this.integrationService.getIntegrationsList(org.id);
      const linkedinInt = integrations.find((i: any) => i.providerIdentifier === 'linkedin' || i.providerIdentifier === 'linkedin-v2' || i.providerIdentifier === 'linkedin-page');
      const xInt = integrations.find((i: any) => i.providerIdentifier === 'x');

      if (!linkedinInt && !xInt) {
        return { ok: false, message: 'No LinkedIn or X integration connected to your Postiz organization. Connect them in Integrations first.' };
      }

      // Register each image URL as a Media row so Postiz accepts it
      const mediaRefs: Array<{ id: string; path: string; alt: string }> = [];
      for (const url of images.slice(0, 4)) {
        try {
          const mediaId = `dft_media_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          await this.prisma.$executeRawUnsafe(
            `INSERT INTO "Media" (id, name, path, "organizationId", "createdAt", "updatedAt")
             VALUES ($1, $2, $3, $4, NOW(), NOW())
             ON CONFLICT (id) DO NOTHING`,
            mediaId, url.split('/').pop() || 'draft-image.jpg', url, org.id
          );
          mediaRefs.push({ id: mediaId, path: url, alt: '' });
        } catch (err) {
          this.logger.warn(`launch: media insert skipped: ${(err as Error).message}`);
        }
      }

      // Build the per-provider post payloads
      const posts: any[] = [];
      const imagesField = mediaRefs.length > 0 ? mediaRefs : undefined;
      if (linkedinInt && draft.linkedinBody) {
        posts.push({
          integration: { id: linkedinInt.id },
          value: [{ content: draft.linkedinBody, image: imagesField }],
          settings: {},
        });
      }
      if (xInt && draft.xBody) {
        posts.push({
          integration: { id: xInt.id },
          value: [{ content: draft.xBody, image: imagesField }],
          settings: {},
        });
      }
      if (posts.length === 0) return { ok: false, message: 'Nothing to post' };

      // Create via Postiz's PostsService — state=draft so the user lands
      // in the composer to pick a time and hit Schedule themselves.
      const created = await this.postsService.createPost(org.id, {
        type: 'draft',
        date: new Date(Date.now() + 24 * 3600_000).toISOString(),
        tags: [],
        posts,
        order: '',
        shortLink: false,
        inter: false,
      } as any);
      const postIds = (created || []).map((r: any) => r.postId);
      const firstPost = postIds[0];

      // Look up the group id so we can redirect to it
      let groupId = '';
      if (firstPost) {
        const groupRows = await this.prisma.$queryRawUnsafe<Array<{ group: string }>>(
          `SELECT "group" FROM "Post" WHERE id = $1 LIMIT 1`,
          firstPost
        );
        groupId = groupRows[0]?.group || '';
      }

      // Update the draft with the Postiz post ref + ship-status
      await this.prisma.$executeRawUnsafe(
        `UPDATE news."NewsDraft" SET "postizPostId" = $1, status = 'launched', "updatedAt" = NOW() WHERE id = $2`,
        firstPost || null, id
      );
      await this.snapshotDraft(id, 'launched', `Postiz group=${groupId}, posts=${postIds.length}`);

      return { ok: true, groupId, postIds };
    } catch (err) {
      this.logger.error(`drafts/launch failed: ${(err as Error).message}\n${(err as Error).stack}`);
      return { ok: false, message: (err as Error).message };
    }
  }

  @Post('/:id/skip')
  async skip(
    @GetOrgFromRequest() _org: Organization,
    @Param('id') id: string
  ): Promise<{ ok: true }> {
    await this.prisma.$executeRawUnsafe(
      `UPDATE news."NewsDraft" SET status = 'skipped', "updatedAt" = NOW() WHERE id = $1`,
      id
    );
    await this.snapshotDraft(id, 'skipped');
    return { ok: true };
  }

  @Post('/:id/regenerate')
  async regenerate(
    @GetOrgFromRequest() _org: Organization,
    @Param('id') id: string
  ): Promise<{ ok: true }> {
    await this.prisma.$executeRawUnsafe(
      `UPDATE news."NewsItem" SET status = 'priority' WHERE id =
         (SELECT "newsItemId" FROM news."NewsDraft" WHERE id = $1)`,
      id
    );
    await this.prisma.$executeRawUnsafe(
      `UPDATE news."NewsDraft" SET status = 'regenerated', "updatedAt" = NOW() WHERE id = $1`,
      id
    );
    await this.snapshotDraft(id, 'regenerated');
    return { ok: true };
  }

  @Post('/:id/update')
  async update(
    @GetOrgFromRequest() _org: Organization,
    @Param('id') id: string,
    @Body() body: { linkedinBody?: string; xBody?: string }
  ): Promise<{ ok: boolean; message?: string }> {
    const linkedinBody = (body?.linkedinBody || '').trim();
    const xBody = (body?.xBody || '').trim();
    if (!linkedinBody || !xBody) {
      return { ok: false, message: 'Both linkedinBody and xBody are required.' };
    }
    if (linkedinBody.length > 2000 || xBody.length > 400) {
      return { ok: false, message: 'Body too long.' };
    }
    if (linkedinBody.includes('—') || xBody.includes('—')) {
      return { ok: false, message: 'Em-dashes are banned. Use commas/periods/parens instead.' };
    }
    await this.prisma.$executeRawUnsafe(
      `UPDATE news."NewsDraft"
         SET "linkedinBody" = $1,
             "xBody" = $2,
             "aliEdited" = true,
             "updatedAt" = NOW()
       WHERE id = $3`,
      linkedinBody, xBody, id
    );
    await this.snapshotDraft(id, 'edited');
    return { ok: true };
  }

  @Get('/:id/images')
  async getImages(
    @GetOrgFromRequest() _org: Organization,
    @Param('id') id: string
  ): Promise<{ images: string[] }> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ imageUrl: string | null; metadata: any }>>(
      `SELECT "imageUrl", metadata FROM news."NewsDraft" WHERE id = $1 LIMIT 1`,
      id
    );
    const r = rows[0];
    if (!r) return { images: [] };
    const list = Array.isArray(r.metadata?.images) ? r.metadata.images : [];
    if (list.length === 0 && r.imageUrl) return { images: [r.imageUrl] };
    return { images: list };
  }

  @Delete('/:id/images/:index')
  async deleteImage(
    @GetOrgFromRequest() _org: Organization,
    @Param('id') id: string,
    @Param('index') indexStr: string
  ): Promise<{ ok: boolean; images: string[] }> {
    const idx = parseInt(indexStr, 10);
    const rows = await this.prisma.$queryRawUnsafe<Array<{ imageUrl: string | null; metadata: any }>>(
      `SELECT "imageUrl", metadata FROM news."NewsDraft" WHERE id = $1 LIMIT 1`,
      id
    );
    const r = rows[0];
    if (!r) return { ok: false, images: [] };
    let list = Array.isArray(r.metadata?.images) ? [...r.metadata.images] : (r.imageUrl ? [r.imageUrl] : []);
    if (idx >= 0 && idx < list.length) list.splice(idx, 1);
    const newMeta = { ...(r.metadata || {}), images: list };
    const newPrimary = list[0] || null;
    await this.prisma.$executeRawUnsafe(
      `UPDATE news."NewsDraft" SET metadata = $1::jsonb, "imageUrl" = $2, "aliEdited" = true, "updatedAt" = NOW() WHERE id = $3`,
      JSON.stringify(newMeta), newPrimary, id
    );
    await this.snapshotDraft(id, 'image_removed');
    return { ok: true, images: list };
  }

  @Post('/:id/image')
  async setImage(
    @GetOrgFromRequest() _org: Organization,
    @Param('id') id: string,
    @Body() body: { url?: string; dataUrl?: string; replace?: boolean }
  ): Promise<{ ok: boolean; imageUrl?: string; images?: string[]; message?: string }> {
    const url = (body?.url || '').trim();
    const dataUrl = (body?.dataUrl || '').trim();
    if (!url && !dataUrl) {
      return { ok: false, message: 'Provide a url or dataUrl' };
    }
    try {
      let buf: Buffer;
      let ext = 'jpg';
      if (dataUrl) {
        const m = dataUrl.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
        if (!m) return { ok: false, message: 'Invalid dataUrl (need data:image/{png,jpg,webp};base64,...)' };
        ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
        buf = Buffer.from(m[2], 'base64');
        if (buf.length > 10 * 1024 * 1024) {
          return { ok: false, message: 'Image > 10 MB. Compress before upload.' };
        }
      } else {
        const res = await fetch(url, { redirect: 'follow' });
        if (!res.ok) return { ok: false, message: `Fetch ${res.status} from URL` };
        buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 10 * 1024 * 1024) {
          return { ok: false, message: 'Image > 10 MB. Try a smaller one.' };
        }
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (ct.includes('png')) ext = 'png';
        else if (ct.includes('webp')) ext = 'webp';
        else ext = 'jpg';
      }
      const { writeFileSync, mkdirSync, existsSync } = await import('node:fs');
      const { resolve } = await import('node:path');
      const day = new Date().toISOString().slice(0, 10);
      const dir = `/uploads/drafts/${day}`;
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const fileName = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const filePath = resolve(dir, fileName);
      writeFileSync(filePath, buf);
      const publicUrl = `https://social.alizaabi.om/uploads/drafts/${day}/${fileName}`;
      // Read current images, append (or replace), enforce max 4
      const rows = await this.prisma.$queryRawUnsafe<Array<{ imageUrl: string | null; metadata: any }>>(
        `SELECT "imageUrl", metadata FROM news."NewsDraft" WHERE id = $1 LIMIT 1`,
        id
      );
      const r = rows[0];
      let list: string[] = Array.isArray(r?.metadata?.images) ? [...r.metadata.images] : (r?.imageUrl ? [r.imageUrl] : []);
      if (body?.replace) {
        list = [publicUrl];
      } else {
        if (list.length >= 4) {
          return { ok: false, message: 'Max 4 images per draft. Remove one first.', images: list };
        }
        list.push(publicUrl);
      }
      const newMeta = { ...(r?.metadata || {}), images: list };
      await this.prisma.$executeRawUnsafe(
        `UPDATE news."NewsDraft" SET "imageUrl" = $1, metadata = $2::jsonb, "aliEdited" = true, "updatedAt" = NOW() WHERE id = $3`,
        list[0], JSON.stringify(newMeta), id
      );
      await this.snapshotDraft(id, body?.replace ? 'image_replaced' : 'image_added');
      return { ok: true, imageUrl: list[0], images: list };
    } catch (err) {
      this.logger.error(`drafts/:id/image failed: ${(err as Error).message}`);
      return { ok: false, message: (err as Error).message };
    }
  }

  @Post('/:id/ship')
  async ship(
    @GetOrgFromRequest() _org: Organization,
    @Param('id') id: string
  ): Promise<{ ok: true }> {
    await this.prisma.$executeRawUnsafe(
      `UPDATE news."NewsDraft" SET status = 'shipped', "shippedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1`,
      id
    );
    await this.snapshotDraft(id, 'shipped');
    return { ok: true };
  }
}
