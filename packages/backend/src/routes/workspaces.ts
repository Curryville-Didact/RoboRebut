/**
 * Workspace routes — team plan only
 * POST   /api/workspaces              — create workspace
 * GET    /api/workspaces/mine         — get my workspace (owner or member)
 * POST   /api/workspaces/:id/members  — invite member by email
 * DELETE /api/workspaces/:id/members/:memberId — remove member
 * GET    /api/workspaces/:id/conversations — all team conversations
 */

import type { FastifyInstance } from "fastify";
import { sendApiError } from "../lib/apiErrors.js";

export async function workspaceRoutes(
  fastify: FastifyInstance
): Promise<void> {
  // POST /api/workspaces — create a workspace (team plan only)
  fastify.post<{ Body: { name?: string } }>(
    "/workspaces",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const userId = req.user.id;
      const name = (req.body?.name ?? "").toString().trim().slice(0, 100);
      if (!name) {
        return sendApiError(reply, {
          status: 400,
          code: "INVALID_REQUEST",
          message: "name is required",
        });
      }

      // Check plan — must be team
      const { data: profile } = await fastify.supabase
        .from("profiles")
        .select("plan_type")
        .eq("id", userId)
        .maybeSingle();

      if (profile?.plan_type !== "team") {
        return sendApiError(reply, {
          status: 403,
          code: "FORBIDDEN",
          message: "Team workspaces require a team plan",
        });
      }

      // Only one workspace per owner
      const { data: existing } = await fastify.supabase
        .from("workspaces")
        .select("id")
        .eq("owner_id", userId)
        .maybeSingle();

      if (existing) {
        return sendApiError(reply, {
          status: 409,
          code: "INVALID_REQUEST",
          message: "You already have a workspace",
        });
      }

      const { data: ws, error } = await fastify.supabase
        .from("workspaces")
        .insert({
          name,
          owner_id: userId,
          plan_type: "team",
          updated_at: new Date().toISOString(),
        })
        .select("*")
        .single();

      if (error || !ws) {
        return sendApiError(reply, {
          status: 500,
          code: "INTERNAL_ERROR",
          message: "Failed to create workspace",
        });
      }

      // Add owner as a member with role 'owner'
      await fastify.supabase.from("workspace_members").insert({
        workspace_id: ws.id,
        user_id: userId,
        role: "owner",
        accepted_at: new Date().toISOString(),
      });

      req.log.info({ userId, workspaceId: ws.id }, "workspace_created");
      return reply.status(201).send({ ok: true, item: ws });
    }
  );

  // GET /api/workspaces/mine
  fastify.get(
    "/workspaces/mine",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const userId = req.user.id;

      // Owner
      let { data: ws } = await fastify.supabase
        .from("workspaces")
        .select("*")
        .eq("owner_id", userId)
        .maybeSingle();

      // Member
      if (!ws) {
        const { data: membership } = await fastify.supabase
          .from("workspace_members")
          .select("workspace_id")
          .eq("user_id", userId)
          .not("accepted_at", "is", null)
          .maybeSingle();

        if (membership) {
          const { data: found } = await fastify.supabase
            .from("workspaces")
            .select("*")
            .eq("id", membership.workspace_id)
            .maybeSingle();
          ws = found ?? null;
        }
      }

      if (!ws) {
        return reply.send({ ok: true, item: null });
      }

      // Fetch members
      const { data: members } = await fastify.supabase
        .from("workspace_members")
        .select("id, user_id, role, invited_email, accepted_at, created_at")
        .eq("workspace_id", ws.id);

      return reply.send({ ok: true, item: ws, members: members ?? [] });
    }
  );

  // POST /api/workspaces/:id/members — invite by email
  fastify.post<{
    Params: { id: string };
    Body: { email?: string };
  }>(
    "/workspaces/:id/members",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const userId = req.user.id;
      const workspaceId = req.params.id;
      const email = (req.body?.email ?? "").toString().trim().toLowerCase();

      if (!email) {
        return sendApiError(reply, {
          status: 400,
          code: "INVALID_REQUEST",
          message: "email is required",
        });
      }

      // Must be owner
      const { data: ws } = await fastify.supabase
        .from("workspaces")
        .select("id, owner_id")
        .eq("id", workspaceId)
        .maybeSingle();

      if (!ws) {
        return sendApiError(reply, {
          status: 404,
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      if (ws.owner_id !== userId) {
        return sendApiError(reply, {
          status: 403,
          code: "FORBIDDEN",
          message: "Only the workspace owner can invite members",
        });
      }

      // Look up user by email via profiles table
      const { data: invitee } = await fastify.supabase
        .from("profiles")
        .select("id")
        .eq("email", email)
        .maybeSingle();

      const { data: member, error } = await fastify.supabase
        .from("workspace_members")
        .insert({
          workspace_id: workspaceId,
          user_id: invitee?.id ?? null,
          role: "member",
          invited_email: email,
          accepted_at: invitee ? new Date().toISOString() : null,
        })
        .select("*")
        .single();

      if (error) {
        if (error.code === "23505") {
          return sendApiError(reply, {
            status: 409,
            code: "INVALID_REQUEST",
            message: "This user is already a member",
          });
        }
        return sendApiError(reply, {
          status: 500,
          code: "INTERNAL_ERROR",
          message: "Failed to invite member",
        });
      }

      req.log.info({ userId, workspaceId, email }, "member_invited");
      return reply.status(201).send({ ok: true, item: member });
    }
  );

  // DELETE /api/workspaces/:id/members/:memberId
  fastify.delete<{ Params: { id: string; memberId: string } }>(
    "/workspaces/:id/members/:memberId",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const userId = req.user.id;
      const { id: workspaceId, memberId } = req.params;

      const { data: ws } = await fastify.supabase
        .from("workspaces")
        .select("owner_id")
        .eq("id", workspaceId)
        .maybeSingle();

      if (!ws) {
        return sendApiError(reply, {
          status: 404,
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      // Owner can remove anyone; members can remove themselves
      const { data: target } = await fastify.supabase
        .from("workspace_members")
        .select("user_id")
        .eq("id", memberId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();

      if (!target) {
        return sendApiError(reply, {
          status: 404,
          code: "NOT_FOUND",
          message: "Member not found",
        });
      }

      if (ws.owner_id !== userId && target.user_id !== userId) {
        return sendApiError(reply, {
          status: 403,
          code: "FORBIDDEN",
          message: "Not allowed",
        });
      }

      await fastify.supabase
        .from("workspace_members")
        .delete()
        .eq("id", memberId)
        .eq("workspace_id", workspaceId);

      return reply.send({ ok: true });
    }
  );

  // GET /api/workspaces/:id/conversations — team view
  fastify.get<{ Params: { id: string } }>(
    "/workspaces/:id/conversations",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const userId = req.user.id;
      const workspaceId = req.params.id;

      const { data: ws } = await fastify.supabase
        .from("workspaces")
        .select("id, owner_id")
        .eq("id", workspaceId)
        .maybeSingle();

      if (!ws) {
        return sendApiError(reply, {
          status: 404,
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      const { data: membership } = await fastify.supabase
        .from("workspace_members")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("user_id", userId)
        .not("accepted_at", "is", null)
        .maybeSingle();

      const isOwner = ws.owner_id === userId;
      if (!isOwner && !membership) {
        return sendApiError(reply, {
          status: 403,
          code: "FORBIDDEN",
          message: "Not a member of this workspace",
        });
      }

      const { data: memberRows } = await fastify.supabase
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", workspaceId)
        .not("accepted_at", "is", null);

      const acceptedUserIds = (memberRows ?? [])
        .map((r) => r.user_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);

      const teamUserIds = Array.from(new Set([ws.owner_id, ...acceptedUserIds]));

      const { data: conversations, error } = await fastify.supabase
        .from("conversations")
        .select("*")
        .in("user_id", teamUserIds)
        .order("updated_at", { ascending: false });

      if (error) {
        return sendApiError(reply, {
          status: 500,
          code: "INTERNAL_ERROR",
          message: "Failed to load conversations",
        });
      }

      return reply.send({ ok: true, items: conversations ?? [] });
    }
  );

  // GET /api/workspaces/:id/leaderboard
  fastify.get<{
    Params: { id: string };
    Querystring: { period?: "week" | "month" | "all" };
  }>(
    "/workspaces/:id/leaderboard",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const userId = req.user.id;
      const workspaceId = req.params.id;
      const period = req.query.period ?? "week";

      // Verify caller is a member or owner of this workspace
      const { data: ws } = await fastify.supabase
        .from("workspaces")
        .select("id, owner_id")
        .eq("id", workspaceId)
        .maybeSingle();

      if (!ws) {
        return reply.status(404).send({ error: "Workspace not found" });
      }

      const { data: membership } = await fastify.supabase
        .from("workspace_members")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("user_id", userId)
        .not("accepted_at", "is", null)
        .maybeSingle();

      const isOwner = ws.owner_id === userId;
      if (!isOwner && !membership) {
        return reply.status(403).send({ error: "Not a member of this workspace" });
      }

      // Get all accepted member user_ids + emails from workspace_members
      const { data: memberRows } = await fastify.supabase
        .from("workspace_members")
        .select("user_id, email, role, invited_email")
        .eq("workspace_id", workspaceId)
        .not("accepted_at", "is", null);

      const members = memberRows ?? [];

      // Build full list including owner
      const ownerInMembers = members.some((m) => m.user_id === ws.owner_id);
      const allMembers: { user_id: string; email: string | null; role: string }[] = [
        ...(ownerInMembers ? [] : [{ user_id: ws.owner_id, email: null, role: "owner" }]),
        ...members.map((m) => ({
          user_id: m.user_id as string,
          email: (m.email ?? m.invited_email ?? null) as string | null,
          role: m.role as string,
        })),
      ].filter((m): m is { user_id: string; email: string | null; role: string } =>
        typeof m.user_id === "string" && m.user_id.length > 0
      );

      const teamUserIds = allMembers.map((m) => m.user_id);

      // Build date filter
      const now = new Date();
      const periodDays = period === "week" ? 7 : period === "month" ? 30 : null;
      const fromDate = periodDays
        ? new Date(now.getTime() - periodDays * 86400000)
        : null;

      // Fetch all conversations for workspace members in period
      let convQuery = fastify.supabase
        .from("conversations")
        .select("user_id, outcome, deal_size")
        .in("user_id", teamUserIds);

      if (fromDate) {
        convQuery = convQuery.gte("created_at", fromDate.toISOString());
      }

      const { data: convRows, error: convError } = await convQuery;

      if (convError) {
        req.log.error({ convError }, "Failed to fetch leaderboard conversations");
        return reply.status(500).send({ error: "Failed to fetch leaderboard" });
      }

      // Also fetch profiles for emails of owner + members who may not have
      // email in workspace_members
      const missingEmailIds = allMembers
        .filter((m) => !m.email)
        .map((m) => m.user_id);

      const profileEmailMap: Record<string, string> = {};
      if (missingEmailIds.length > 0) {
        const { data: profileRows } = await fastify.supabase
          .from("profiles")
          .select("id, email")
          .in("id", missingEmailIds);
        for (const p of profileRows ?? []) {
          if (p.id && p.email) profileEmailMap[p.id] = p.email;
        }
      }

      // Aggregate per user
      const rows = convRows ?? [];

      const leaderboard = allMembers.map((member) => {
        const userConvs = rows.filter((r) => r.user_id === member.user_id);
        const won = userConvs.filter((r) => r.outcome === "WON").length;
        const lost = userConvs.filter((r) => r.outcome === "LOST").length;
        const inProgress = userConvs.filter(
          (r) => r.outcome === "IN_PROGRESS"
        ).length;
        const closed = won + lost;
        const closeRate = closed > 0 ? Math.round((won / closed) * 1000) / 10 : 0;
        const wonConvs = userConvs.filter(
          (r) => r.outcome === "WON" && r.deal_size != null
        );
        const totalDealValue = wonConvs.reduce(
          (s, r) => s + (r.deal_size ?? 0),
          0
        );
        const displayEmail =
          member.email ?? profileEmailMap[member.user_id] ?? "Unknown";
        // Derive display name: part before @ sign
        const displayName = displayEmail.includes("@")
          ? displayEmail.split("@")[0]!
          : displayEmail;

        return {
          userId: member.user_id,
          displayName,
          email: displayEmail,
          role: member.role,
          isCurrentUser: member.user_id === userId,
          isOwner: member.user_id === ws.owner_id,
          totalConversations: userConvs.length,
          won,
          lost,
          inProgress,
          closeRate,
          totalDealValue,
        };
      });

      // Sort: closeRate desc, then won desc, then totalConversations desc
      leaderboard.sort((a, b) => {
        if (b.closeRate !== a.closeRate) return b.closeRate - a.closeRate;
        if (b.won !== a.won) return b.won - a.won;
        return b.totalConversations - a.totalConversations;
      });

      // Add rank
      const ranked = leaderboard.map((entry, i) => ({ ...entry, rank: i + 1 }));

      // Find current user's rank and gap to #3
      const myEntry = ranked.find((r) => r.isCurrentUser);
      const thirdPlace = ranked[2] ?? ranked[ranked.length - 1] ?? null;
      const gapToTop3 =
        myEntry && thirdPlace && myEntry.rank > 3
          ? thirdPlace.won - myEntry.won
          : null;

      return reply.send({
        ok: true,
        period,
        isOwner,
        totalReps: ranked.length,
        leaderboard: ranked,
        myRank: myEntry?.rank ?? null,
        gapToTop3,
      });
    }
  );

  // GET /api/workspaces/:id/shop-report
  fastify.get<{
    Params: { id: string };
    Querystring: { period?: "week" | "month" };
  }>(
    "/workspaces/:id/shop-report",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const userId = req.user.id;
      const workspaceId = req.params.id;
      const period = req.query.period ?? "week";

      // Verify caller is owner (report is owner-only)
      const { data: ws } = await fastify.supabase
        .from("workspaces")
        .select("id, owner_id, name")
        .eq("id", workspaceId)
        .maybeSingle();

      if (!ws) {
        return reply.status(404).send({ error: "Workspace not found" });
      }
      if (ws.owner_id !== userId) {
        return reply.status(403).send({
          error: "Shop report is only available to workspace owners",
        });
      }

      // Get all accepted members
      const { data: memberRows } = await fastify.supabase
        .from("workspace_members")
        .select("user_id, email, invited_email, role")
        .eq("workspace_id", workspaceId)
        .not("accepted_at", "is", null);

      const members = memberRows ?? [];
      const allMembers: {
        user_id: string;
        email: string | null;
        role: string;
      }[] = [
        { user_id: ws.owner_id, email: null, role: "owner" },
        ...members
          .filter((m) => m.user_id && m.user_id !== ws.owner_id)
          .map((m) => ({
            user_id: m.user_id as string,
            email: (m.email ?? m.invited_email ?? null) as string | null,
            role: m.role as string,
          })),
      ];

      const teamUserIds = allMembers.map((m) => m.user_id);

      // Fill missing emails from profiles
      const missingIds = allMembers
        .filter((m) => !m.email)
        .map((m) => m.user_id);
      const profileEmailMap: Record<string, string> = {};
      if (missingIds.length > 0) {
        const { data: profiles } = await fastify.supabase
          .from("profiles")
          .select("id, email")
          .in("id", missingIds);
        for (const p of profiles ?? []) {
          if (p.id && p.email) profileEmailMap[p.id] = p.email;
        }
      }
      for (const m of allMembers) {
        if (!m.email && profileEmailMap[m.user_id]) {
          m.email = profileEmailMap[m.user_id]!;
        }
      }

      // Date range
      const now = new Date();
      const periodDays = period === "week" ? 7 : 30;
      const currentFrom = new Date(
        now.getTime() - periodDays * 86400000
      ).toISOString();
      const prevFrom = new Date(
        now.getTime() - periodDays * 2 * 86400000
      ).toISOString();

      // Fetch conversations for current period
      const { data: currentConvs } = await fastify.supabase
        .from("conversations")
        .select("id, user_id, outcome, deal_size, lost_reason")
        .in("user_id", teamUserIds)
        .gte("created_at", currentFrom);

      // Fetch conversations for previous period (for improvement calc)
      const { data: prevConvs } = await fastify.supabase
        .from("conversations")
        .select("user_id, outcome")
        .in("user_id", teamUserIds)
        .gte("created_at", prevFrom)
        .lt("created_at", currentFrom);

      const rows = currentConvs ?? [];
      const prevRows = prevConvs ?? [];

      // ── Team totals ───────────────────────────────────────────────────
      const totalAttempted = rows.length;
      const totalWon = rows.filter((r) => r.outcome === "WON").length;
      const totalLost = rows.filter((r) => r.outcome === "LOST").length;
      const totalInProgress = rows.filter(
        (r) => r.outcome === "IN_PROGRESS"
      ).length;
      const closed = totalWon + totalLost;
      const teamCloseRate =
        closed > 0 ? Math.round((totalWon / closed) * 1000) / 10 : 0;

      // ── Revenue lost to objections ────────────────────────────────────
      const wonRows = rows.filter(
        (r) => r.outcome === "WON" && r.deal_size != null
      );
      const avgDealSize =
        wonRows.length > 0
          ? wonRows.reduce((s, r) => s + (r.deal_size ?? 0), 0) /
            wonRows.length
          : 0;
      const estimatedRevenueLost = Math.round(totalLost * avgDealSize);

      // ── Top objections that beat the team ────────────────────────────
      const lostReasonCounts: Record<string, number> = {};
      for (const r of rows.filter((r) => r.outcome === "LOST")) {
        const reason = (r.lost_reason as string | null)?.trim().toLowerCase();
        if (reason) {
          lostReasonCounts[reason] =
            (lostReasonCounts[reason] ?? 0) + 1;
        }
      }
      const topObjections = Object.entries(lostReasonCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([reason, count]) => ({ reason, count }));

      // ── Per-rep stats (current + previous period) ─────────────────────
      const repStats = allMembers.map((member) => {
        const displayEmail = member.email ?? "Unknown";
        const displayName = displayEmail.includes("@")
          ? displayEmail.split("@")[0]!
          : displayEmail;

        const repCurrent = rows.filter(
          (r) => r.user_id === member.user_id
        );
        const repPrev = prevRows.filter(
          (r) => r.user_id === member.user_id
        );

        const won = repCurrent.filter((r) => r.outcome === "WON").length;
        const lost = repCurrent.filter((r) => r.outcome === "LOST").length;
        const repClosed = won + lost;
        const closeRate =
          repClosed > 0
            ? Math.round((won / repClosed) * 1000) / 10
            : 0;

        const prevWon = repPrev.filter((r) => r.outcome === "WON").length;
        const prevLost = repPrev.filter(
          (r) => r.outcome === "LOST"
        ).length;
        const prevClosed = prevWon + prevLost;
        const prevCloseRate =
          prevClosed > 0
            ? Math.round((prevWon / prevClosed) * 1000) / 10
            : 0;

        const improvement =
          Math.round((closeRate - prevCloseRate) * 10) / 10;

        return {
          userId: member.user_id,
          displayName,
          role: member.role,
          totalConversations: repCurrent.length,
          won,
          lost,
          closeRate,
          prevCloseRate,
          improvement,
        };
      });

      // ── Most improved rep ─────────────────────────────────────────────
      const mostImproved = [...repStats]
        .filter((r) => r.prevCloseRate > 0 || r.closeRate > 0)
        .sort((a, b) => b.improvement - a.improvement)[0] ?? null;

      // ── Struggling rep (lowest close rate with >= 2 closed deals) ─────
      const strugglingRep =
        [...repStats]
          .filter((r) => r.won + r.lost >= 2)
          .sort((a, b) => a.closeRate - b.closeRate)[0] ?? null;

      // ── Recommended training focus ────────────────────────────────────
      // Top objection that caused the most losses
      const trainingFocus =
        topObjections[0]?.reason ?? null;

      // ── Recommended action ────────────────────────────────────────────
      let recommendedAction: string | null = null;
      if (strugglingRep && trainingFocus) {
        recommendedAction = `Coach ${strugglingRep.displayName} on "${trainingFocus}" objections this week`;
      } else if (trainingFocus) {
        recommendedAction = `Run a team drill on "${trainingFocus}" objections this week`;
      } else if (mostImproved) {
        recommendedAction = `Have ${mostImproved.displayName} share what's working with the team`;
      }

      return reply.send({
        ok: true,
        period,
        workspaceName: ws.name as string,
        generatedAt: now.toISOString(),
        team: {
          totalReps: allMembers.length,
          totalAttempted,
          totalWon,
          totalLost,
          totalInProgress,
          teamCloseRate,
          avgDealSize: Math.round(avgDealSize),
          estimatedRevenueLost,
        },
        topObjections,
        repStats,
        mostImproved: mostImproved
          ? {
              displayName: mostImproved.displayName,
              improvement: mostImproved.improvement,
              closeRate: mostImproved.closeRate,
            }
          : null,
        strugglingRep: strugglingRep
          ? {
              displayName: strugglingRep.displayName,
              closeRate: strugglingRep.closeRate,
              lost: strugglingRep.lost,
            }
          : null,
        trainingFocus,
        recommendedAction,
      });
    }
  );
}
