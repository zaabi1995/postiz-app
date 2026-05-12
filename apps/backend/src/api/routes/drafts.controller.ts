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

import { Controller, Get, Post, Param, Query, Logger } from '@nestjs/common';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

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
}

@ApiTags('Drafts')
@Controller('/drafts')
export class DraftsController {
  private readonly logger = new Logger(DraftsController.name);

  constructor(private prisma: PrismaService) {}

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
      return { drafts: rows };
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
      return { drafts: rows };
    } catch (err) {
      this.logger.warn(`drafts/history query failed: ${(err as Error).message}`);
      return { drafts: [] };
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

  @Post('/:id/skip')
  async skip(
    @GetOrgFromRequest() _org: Organization,
    @Param('id') id: string
  ): Promise<{ ok: true }> {
    await this.prisma.$executeRawUnsafe(
      `UPDATE news."NewsDraft" SET status = 'skipped', "updatedAt" = NOW() WHERE id = $1`,
      id
    );
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
    return { ok: true };
  }

  @Post('/:id/launch')
  async launch(
    @GetOrgFromRequest() _org: Organization,
    @Param('id') _id: string
  ): Promise<{ postId: string }> {
    return { postId: 'PHASE-3-V2-PENDING' };
  }
}
