// BHD: drafts controller — backs the personal-content "Drafts" sidebar tab.
//
// Survivability:
//   - Entire file is new; nothing in Postiz core changed.
//   - Talks to our own news_drafts table via raw SQL through the existing
//     PrismaService (same DB, separate `news` schema). No modifications to
//     Postiz's prisma schema.
//   - Registration in app.module.ts is the only other core touch (one line,
//     marked with a BHD comment).
//
// v1 scope (this commit):
//   - GET /drafts/list      → list pending drafts joined with news_items
//   - POST /drafts/:id/skip → mark draft skipped
//   - POST /drafts/:id/regenerate → enqueue regeneration (stub for now)
//   - POST /drafts/:id/launch     → push into Postiz launches as a draft post,
//     return its postId so the UI can redirect to /launches?id=<postId>.
//     Launch wiring is stubbed in v1, returns a placeholder while we finish
//     the PostsService integration in v2.

import { Controller, Get, Post, Param, Logger } from '@nestjs/common';
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
      // Pre-Phase-1f the schema may not exist yet. Return empty list rather
      // than 500 so the UI gracefully shows "no drafts pending".
      this.logger.warn(`drafts/list query failed (schema may not exist yet): ${(err as Error).message}`);
      return { drafts: [] };
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
    // v1: mark the underlying news_item as 'new' again so the next drafter
    // cron run picks it back up. v2: enqueue an immediate regeneration job.
    await this.prisma.$executeRawUnsafe(
      `UPDATE news."NewsItem" SET status = 'new' WHERE id =
         (SELECT "newsItemId" FROM news."NewsDraft" WHERE id = $1)`,
      id
    );
    await this.prisma.$executeRawUnsafe(
      `UPDATE news."NewsDraft" SET status = 'skipped', "updatedAt" = NOW() WHERE id = $1`,
      id
    );
    return { ok: true };
  }

  @Post('/:id/launch')
  async launch(
    @GetOrgFromRequest() _org: Organization,
    @Param('id') _id: string
  ): Promise<{ postId: string }> {
    // v2 will create a real Postiz post in draft state via PostsService and
    // return its postId for the UI to redirect to /launches?id=<postId>.
    return { postId: 'PHASE-3-V2-PENDING' };
  }
}
