import crypto from "node:crypto";
import { Router } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { getServerSupabase } from "../lib/supabase";
import { issueDeviceToken } from "../lib/deviceTrust";

const router = Router();

router.post("/register", async (req, res) => {
  const cin = typeof req.body?.cin === "string" ? req.body.cin.trim() : "";
  const firstName = typeof req.body?.firstName === "string" ? req.body.firstName.trim() : "";
  const lastName = typeof req.body?.lastName === "string" ? req.body.lastName.trim() : "";
  const dateOfBirth = typeof req.body?.dateOfBirth === "string" ? req.body.dateOfBirth : null;
  const can = typeof req.body?.can === "string" ? req.body.can.trim() : "";
  const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (!cin || !firstName || !lastName || !can || !phone || !password) {
    return res.status(400).json({ error: "Tous les champs sont requis", data: null });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: "Le mot de passe doit contenir au moins 8 caractères", data: null });
  }

  try {
    const supabase = getServerSupabase();

    const { data: existing } = await supabase
      .from("user_chefs")
      .select("cin")
      .eq("cin", cin)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: "Ce numéro CIN est déjà enregistré", data: null });
    }

    // bcrypt, not the old sha256: salted + adaptive-cost, unlike a bare
    // sha256 digest which is fast to brute-force and has no per-user salt.
    const passwordHash = await bcrypt.hash(password, 12);

    const { data: newChef, error } = await supabase
      .from("user_chefs")
      .insert({
        cin,
        first_name: firstName,
        last_name: lastName,
        date_of_birth: dateOfBirth,
        can,
        phone,
        password_hash: passwordHash,
      })
      .select()
      .single();

    if (error || !newChef) {
      return res.status(400).json({ error: error?.message || "Erreur lors de l'inscription", data: null });
    }

    const { password_hash: _passwordHash, ...safeChef } = newChef;
    res.json({ error: null, data: safeChef });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ error: "Erreur lors de l'inscription", data: null });
  }
});

router.post("/login", async (req, res) => {
  // TEMP DEBUG — à retirer une fois le bug résolu. Affiche dans les
  // logs Netlify Functions ce que le serveur reçoit réellement, pour
  // savoir si le problème est un body vide, mal parsé, ou des clés
  // au mauvais format.
  console.log("[DEBUG /api/auth/login] content-type:", req.headers["content-type"]);
  console.log("[DEBUG /api/auth/login] typeof req.body:", typeof req.body);
  console.log("[DEBUG /api/auth/login] req.body:", JSON.stringify(req.body));

  const cin = typeof req.body?.cin === "string" ? req.body.cin.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const firstName = typeof req.body?.firstName === "string" ? req.body.firstName.trim() : "";
  const lastName = typeof req.body?.lastName === "string" ? req.body.lastName.trim() : "";
  // Optional: present when the client already has (or just generated)
  // a stable local device identifier. Absent on first-ever login
  // before client/lib/offline/deviceTrust.ts has created one, or on
  // clients that opt out of offline mode entirely. Login must succeed
  // either way — device trust is additive, never a login requirement.
  const deviceId = typeof req.body?.device_id === "string" ? req.body.device_id.trim() : "";
  const deviceLabel = typeof req.body?.device_label === "string" ? req.body.device_label.trim() : undefined;
  const secret = process.env.JWT_SECRET;

  if (!cin || !password || !firstName || !lastName) {
    console.log("[DEBUG /api/auth/login] Champ(s) manquant(s) — cin:", !!cin, "password:", !!password, "firstName:", !!firstName, "lastName:", !!lastName);
    return res.status(400).json({ error: "All login fields are required", data: null });
  }

  try {
    const supabase = getServerSupabase();
    const { data: chef, error } = await supabase
      .from("user_chefs")
      .select("*")
      .eq("cin", cin)
      .maybeSingle();

    if (error || !chef) {
      return res.status(401).json({ error: "CIN ou mot de passe incorrect", data: null });
    }

    // Transparent migration: existing accounts still have an old sha256
    // hash (64 hex chars, no bcrypt "$2..." prefix). Verify against that
    // once, then silently re-hash with bcrypt so the account is upgraded
    // on its very next successful login -- no forced password reset for
    // anyone.
    const storedHash = typeof chef.password_hash === "string" ? chef.password_hash : "";
    const isLegacySha256Hash = /^[a-f0-9]{64}$/i.test(storedHash);

    let passwordMatches: boolean;
    if (isLegacySha256Hash) {
      const legacyHash = crypto.createHash("sha256").update(password).digest("hex");
      passwordMatches = legacyHash === storedHash;
    } else {
      passwordMatches = await bcrypt.compare(password, storedHash);
    }

    if (!passwordMatches) {
      return res.status(401).json({ error: "CIN ou mot de passe incorrect", data: null });
    }

    if (isLegacySha256Hash) {
      const upgradedHash = await bcrypt.hash(password, 12);
      await supabase.from("user_chefs").update({ password_hash: upgradedHash }).eq("id", chef.id);
    }

    if (
      typeof chef.first_name !== "string" ||
      typeof chef.last_name !== "string" ||
      chef.first_name.trim().toLowerCase() !== firstName.toLowerCase() ||
      chef.last_name.trim().toLowerCase() !== lastName.toLowerCase()
    ) {
      return res.status(401).json({ error: "Le nom ou le prénom ne correspond pas au CIN", data: null });
    }

    const { password_hash: _passwordHash, ...safeChef } = chef;
    let token: string | null = null;

    if (secret) {
      try {
        token = jwt.sign({ user_id: String(chef.id) }, secret, { expiresIn: "12h" });
      } catch (error) {
        console.error("JWT creation failed:", error);
      }
    }

    // Device trust: only attempted when the client sent a device_id
    // AND DEVICE_TOKEN_SECRET is configured. Neither being present is
    // a login failure — it just means this device won't get offline
    // access until both are true (e.g. staging environments that
    // don't set DEVICE_TOKEN_SECRET keep working exactly as before).
    let device: { token: string; signed_envelope: string; expires_at: string } | null = null;
    if (deviceId && process.env.DEVICE_TOKEN_SECRET) {
      try {
        const issued = await issueDeviceToken(String(chef.id), deviceId, deviceLabel);
        device = {
          token: issued.deviceToken,
          signed_envelope: issued.signedEnvelope,
          expires_at: issued.expiresAt,
        };
      } catch (deviceError) {
        // Device trust is a bonus, not a login blocker. Log and
        // continue with a normal online-only session.
        console.error("Device token issuance failed:", deviceError);
      }
    }

    return res.json({ error: null, data: safeChef, token, device });
  } catch (error) {
    console.error("Chef login error:", error);
    return res.status(500).json({ error: "Erreur lors de la connexion", data: null });
  }
});

export default router;
