import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type CreateUserPayload = {
  first_name?: string;
  last_name?: string;
  email?: string;
  username?: string;
  password?: string;
  role?: string;
  branch_id?: string;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return jsonResponse({}, 200);
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const payload = await req.json() as CreateUserPayload;
    const firstName = String(payload.first_name || "").trim();
    const lastName = String(payload.last_name || "").trim();
    const fullName = [firstName, lastName].filter(Boolean).join(" ");
    const email = String(payload.email || "").trim().toLowerCase();
    const username = String(payload.username || "").trim();
    const password = String(payload.password || "");
    const role = normalizeRole(payload.role);
    const branchId = String(payload.branch_id || "").trim();

    if (!firstName || !email || !username || !password || !role || !branchId) {
      return jsonResponse({ error: "first_name, email, username, password, role, and branch_id are required" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Supabase function environment is not configured" }, 500);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        username,
        role,
      },
    });

    if (authError || !authData.user) {
      return jsonResponse({ error: authError?.message || "Failed to create auth user" }, 400);
    }

    const profilePayload = {
      id: authData.user.id,
      email,
      username,
      full_name: fullName,
      role,
      branch_id: branchId,
      status: "active",
    };

    const { error: profileError } = await adminClient
      .from("profiles")
      .insert(profilePayload);

    if (profileError) {
      await adminClient.auth.admin.deleteUser(authData.user.id);
      return jsonResponse({ error: profileError.message }, 400);
    }

    return jsonResponse({
      user: {
        id: authData.user.id,
        email,
        username,
        full_name: fullName,
        role,
        branch_id: branchId,
        status: "active",
      },
    }, 200);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

function normalizeRole(role: unknown) {
  return String(role || "operator").toLowerCase() === "admin" ? "admin" : "operator";
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
