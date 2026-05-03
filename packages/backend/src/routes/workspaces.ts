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
}
