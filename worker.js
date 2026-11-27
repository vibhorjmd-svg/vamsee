const json = (data, status = 200, extraHeaders = {}) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders }
});

const SESSION_COOKIE = "vamsee_session";
// Until per-user sessions are enabled, the existing private workspace is pinned
// to its seeded tenant. Never accept an organization ID from the browser.
const DEMO_ORG_ID = "org_vamsee_demo";
const SESSION_SECONDS = 8 * 60 * 60;
const encoder = new TextEncoder();
const USER_SESSION_COOKIE="vamsee_user_session", USER_SESSION_SECONDS=28800, PBKDF2_ITERATIONS=100000;
function decode64url(s){return Uint8Array.from(atob(s.replaceAll("-","+").replaceAll("_","/")+"=".repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));}
async function hashPassword(p){const salt=crypto.getRandomValues(new Uint8Array(16));const k=await crypto.subtle.importKey("raw",encoder.encode(p),"PBKDF2",false,["deriveBits"]);const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt,iterations:PBKDF2_ITERATIONS,hash:"SHA-256"},k,256);return "pbkdf2$"+PBKDF2_ITERATIONS+"$"+toBase64Url(salt)+"$"+toBase64Url(new Uint8Array(bits));}
async function verifyPassword(p,stored){try{const [kind,n,s,h]=stored.split("$");if(kind!=="pbkdf2"||+n<100000||+n>1000000)return false;const k=await crypto.subtle.importKey("raw",encoder.encode(p),"PBKDF2",false,["deriveBits"]);const a=new Uint8Array(await crypto.subtle.deriveBits({name:"PBKDF2",salt:decode64url(s),iterations:+n,hash:"SHA-256"},k,256)),b=decode64url(h);if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a[i]^b[i];return d===0;}catch{return false;}}
async function userToken(payload,secret){const body=toBase64Url(encoder.encode(JSON.stringify({...payload,exp:Math.floor(Date.now()/1000)+USER_SESSION_SECONDS})));const sig=await crypto.subtle.sign("HMAC",await sessionKey(secret),encoder.encode(body));return body+"."+toBase64Url(new Uint8Array(sig));}
async function userPayload(request,secret){try{const c=(request.headers.get("Cookie")||"").split(";").map(x=>x.trim()).find(x=>x.startsWith(USER_SESSION_COOKIE+"="));if(!c||!secret)return null;const [body,sig,...rest]=c.slice(USER_SESSION_COOKIE.length+1).split(".");if(!body||!sig||rest.length)return null;if(!await crypto.subtle.verify("HMAC",await sessionKey(secret),decode64url(sig),encoder.encode(body)))return null;const p=JSON.parse(new TextDecoder().decode(decode64url(body)));return p.exp>Date.now()/1000?p:null;}catch{return null;}}


function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}
async function sessionKey(secret) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function createSession(secret) {
  const expires = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS);
  const signature = await crypto.subtle.sign("HMAC", await sessionKey(secret), encoder.encode(expires));
  return expires + "." + toBase64Url(new Uint8Array(signature));
}
async function validSession(request, secret) {
  if (!secret) return false;
  const cookie = request.headers.get("Cookie") || "";
  const part = cookie.split(";").map(v => v.trim()).find(v => v.startsWith(SESSION_COOKIE + "="));
  if (!part) return false;
  const pieces = part.slice(SESSION_COOKIE.length + 1).split(".");
  if (pieces.length !== 2 || !pieces[0].split("").every(ch => ch >= "0" && ch <= "9") ||
      Number(pieces[0]) <= Math.floor(Date.now() / 1000)) return false;
  try {
    const signature = pieces[1].replaceAll("-", "+").replaceAll("_", "/");
    const padded = signature + "=".repeat((4 - signature.length % 4) % 4);
    const bytes = Uint8Array.from(atob(padded), ch => ch.charCodeAt(0));
    return await crypto.subtle.verify("HMAC", await sessionKey(secret), bytes, encoder.encode(pieces[0]));
  } catch { return false; }
}
function sameOrigin(request) {
  return request.headers.get("Origin") === new URL(request.url).origin;
}

async function passwordMatches(candidate, expected) {
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected))
  ]);
  const aa = new Uint8Array(a), bb = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    // Individual account endpoints.

    if(url.pathname==="/api/auth/bootstrap"&&request.method==="POST"){
      if(!sameOrigin(request))return json({error:"Request origin rejected."},403);
      if(!env.DB||!env.VAMSEE_BOOTSTRAP_TOKEN||!env.VAMSEE_SESSION_SECRET||env.VAMSEE_SESSION_SECRET.length<32)return json({error:"Bootstrap configuration missing.",diagnostics:{db:!!env.DB,bootstrap_token:!!env.VAMSEE_BOOTSTRAP_TOKEN,session_secret:!!env.VAMSEE_SESSION_SECRET,session_secret_length_ok:!!env.VAMSEE_SESSION_SECRET&&env.VAMSEE_SESSION_SECRET.length>=32}},503);
      let b;try{b=await request.json();}catch{return json({error:"Invalid JSON."},400);}
      if(typeof b.token!=="string"||!(await passwordMatches(b.token,env.VAMSEE_BOOTSTRAP_TOKEN)))return json({error:"Invalid setup token."},401);
      try {
      const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first();if(Number(count?.n||0)!==0)return json({error:"Initial setup is already complete."},409);
      const email=String(b.email||"").trim().toLowerCase(),name=String(b.full_name||"").trim(),pass=typeof b.password==="string"?b.password:"";
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||name.length<2||name.length>120||pass.length<12||pass.length>128)return json({error:"Enter a valid email, full name and a 12–128 character password."},400);
      const id="usr_"+crypto.randomUUID(),now=new Date().toISOString(),ph=await hashPassword(pass);
      const setup=await env.DB.batch([
        env.DB.prepare("INSERT OR IGNORE INTO organizations(id,name,slug,organization_type) VALUES(?,?,?,'platform')").bind(DEMO_ORG_ID,"VAMSEE Platform","vamsee-platform"),
        env.DB.prepare("INSERT INTO users(id,email,full_name,password_hash,status,created_at,updated_at) SELECT ?,?,?,?,'active',?,? WHERE NOT EXISTS (SELECT 1 FROM users)").bind(id,email,name,ph,now,now),
        env.DB.prepare("INSERT INTO memberships(id,organization_id,user_id,role,status) SELECT ?,?,?, 'platform_admin','active' WHERE EXISTS (SELECT 1 FROM users WHERE id=?)").bind("mem_"+crypto.randomUUID(),DEMO_ORG_ID,id,id)
      ]);
      if(!setup?.[1]?.meta?.changes)return json({error:"Initial setup has already been completed."},409);
      const t=await userToken({user_id:id,organization_id:DEMO_ORG_ID},env.VAMSEE_SESSION_SECRET);
      return json({ok:true,user:{id,email,full_name:name,role:"platform_admin"}},201,{"Set-Cookie":USER_SESSION_COOKIE+"="+t+"; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age="+USER_SESSION_SECONDS});
      } catch(error) {
        console.error("VAMSEE owner bootstrap failed", error);
        return json({error:"Owner setup failed: "+String(error?.message||error).slice(0,240)},500);
      }
    }

    if(url.pathname==="/api/auth/register"&&request.method==="POST"){
      if(!sameOrigin(request))return json({error:"Request origin rejected."},403);
      if(!env.DB||!env.VAMSEE_SESSION_SECRET||env.VAMSEE_SESSION_SECRET.length<32)return json({error:"Workspace registration is not configured."},503);
      let b;try{b=await request.json();}catch{return json({error:"Invalid JSON."},400);}
      const email=String(b.email||"").trim().toLowerCase(),name=String(b.full_name||"").trim(),company=String(b.organization_name||"").trim(),pass=typeof b.password==="string"?b.password:"";
      const type=String(b.organization_type||"seller");
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||name.length<2||name.length>120||company.length<2||company.length>120||pass.length<12||pass.length>128||!["seller","logistics","courier"].includes(type))return json({error:"Enter valid details and a password of at least 12 characters."},400);
      if(await env.DB.prepare("SELECT id FROM users WHERE email=? COLLATE NOCASE").bind(email).first())return json({error:"An account with this email already exists. Please sign in instead."},409);
      const base=company.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,42)||"workspace";
      let slug=base;
      for(let n=1;await env.DB.prepare("SELECT id FROM organizations WHERE slug=?").bind(slug).first();n++)slug=base+"-"+n;
      const orgId="org_"+crypto.randomUUID(),userId="usr_"+crypto.randomUUID(),now=new Date().toISOString(),expires=new Date(Date.now()+14*86400000).toISOString(),passwordHash=await hashPassword(pass);
      try{
        await env.DB.batch([
          env.DB.prepare("INSERT INTO organizations(id,name,slug,organization_type,status,created_at,updated_at) VALUES(?,?,?,?,'active',?,?)").bind(orgId,company,slug,type,now,now),
          env.DB.prepare("INSERT INTO users(id,email,full_name,password_hash,status,created_at,updated_at) VALUES(?,?,?,?,'active',?,?)").bind(userId,email,name,passwordHash,now,now),
          env.DB.prepare("INSERT INTO memberships(id,organization_id,user_id,role,status) VALUES(?,?,?,'org_admin','active')").bind("mem_"+crypto.randomUUID(),orgId,userId),
          env.DB.prepare("INSERT INTO subscriptions(id,organization_id,plan_code,status,trial_ends_at,created_at,updated_at) VALUES(?,?,'starter','trialing',?,?,?)").bind("sub_"+crypto.randomUUID(),orgId,expires,now,now),
          env.DB.prepare("INSERT INTO audit_logs(id,organization_id,actor_user_id,action,resource_type,resource_id,metadata_json) VALUES(?,?,?,'workspace.created','organization',?,?)").bind("aud_"+crypto.randomUUID(),orgId,userId,orgId,JSON.stringify({plan:"starter",trial_days:14}))
        ]);
      }catch(error){console.error("VAMSEE tenant registration failed",error);return json({error:"Workspace could not be created. Please try again."},500);}
      const token=await userToken({user_id:userId,organization_id:orgId},env.VAMSEE_SESSION_SECRET);
      return json({ok:true,user:{id:userId,email,full_name:name,role:"org_admin"},organization:{id:orgId,name:company,slug},subscription:{plan_code:"starter",status:"trialing",trial_ends_at:expires}},201,{"Set-Cookie":USER_SESSION_COOKIE+"="+token+"; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age="+USER_SESSION_SECONDS});
    }

    if(url.pathname==="/api/auth/login"&&request.method==="POST"){
      if(!sameOrigin(request))return json({error:"Request origin rejected."},403);
      if(!env.DB||!env.VAMSEE_SESSION_SECRET||env.VAMSEE_SESSION_SECRET.length<32)return json({error:"Individual login is not configured."},503);
      let b;try{b=await request.json();}catch{return json({error:"Invalid JSON."},400);}
      const email=String(b.email||"").trim().toLowerCase(),pass=typeof b.password==="string"?b.password:"";
      if(pass.length>128)return json({error:"Password is too long."},400);
      const u=await env.DB.prepare("SELECT u.id,u.email,u.full_name,u.password_hash,m.organization_id,m.role FROM users u JOIN memberships m ON m.user_id=u.id JOIN organizations o ON o.id=m.organization_id WHERE u.email=? COLLATE NOCASE AND u.status='active' AND m.status='active' AND o.status='active' ORDER BY CASE m.role WHEN 'platform_admin' THEN 0 WHEN 'org_admin' THEN 1 ELSE 2 END LIMIT 1").bind(email).first();
      if(!u?.password_hash||!(await verifyPassword(pass,u.password_hash)))return json({error:"Email or password is incorrect."},401);
      const t=await userToken({user_id:u.id,organization_id:u.organization_id},env.VAMSEE_SESSION_SECRET);
      return json({ok:true,user:{id:u.id,email:u.email,full_name:u.full_name,role:u.role}},200,{"Set-Cookie":USER_SESSION_COOKIE+"="+t+"; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age="+USER_SESSION_SECONDS});
    }
    if(url.pathname==="/api/auth/logout"&&request.method==="POST"){
      if(!sameOrigin(request))return json({error:"Request origin rejected."},403);
      return json({ok:true},200,{"Set-Cookie":USER_SESSION_COOKIE+"=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"});
    }
    if(url.pathname==="/api/auth/session"&&request.method==="GET"){
      const p=await userPayload(request,env.VAMSEE_SESSION_SECRET);if(!p||!env.DB)return json({authenticated:false});
      const u=await env.DB.prepare("SELECT u.id,u.email,u.full_name,m.role FROM users u JOIN memberships m ON m.user_id=u.id JOIN organizations o ON o.id=m.organization_id WHERE u.id=? AND m.organization_id=? AND u.status='active' AND m.status='active' AND o.status='active'").bind(p.user_id,p.organization_id).first();
      return json(u?{authenticated:true,user:u}:{authenticated:false});
    }

    // Retire the shared-password login. All workspace access now uses named accounts.
    if (url.pathname === "/api/login" && request.method === "POST") {
      return json({ error: "Shared-password login is disabled. Sign in with your work email." }, 410);
    }
    if (url.pathname === "/api/session" && request.method === "GET") {
      return json({ authenticated: false, configured: true });
    }
    if (url.pathname === "/api/logout" && request.method === "POST") {
      if (!sameOrigin(request)) return json({ error: "Request origin rejected." }, 403);
      return json({ ok: true }, 200, {
        "Set-Cookie": SESSION_COOKIE + "=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"
      });
    }

    if(!env.VAMSEE_SESSION_SECRET||env.VAMSEE_SESSION_SECRET.length<32)return json({error:"Session signing is not configured."},503);
    if(!env.DB)return json({error:"Database binding DB is not configured."},503);
    const p=await userPayload(request,env.VAMSEE_SESSION_SECRET);
    const member=p?await env.DB.prepare("SELECT m.organization_id,m.role FROM users u JOIN memberships m ON m.user_id=u.id JOIN organizations o ON o.id=m.organization_id WHERE u.id=? AND m.organization_id=? AND u.status='active' AND m.status='active' AND o.status='active'").bind(p.user_id,p.organization_id).first():null;
    if(!member)return json({error:"Authentication required."},401);
    if(["POST","PATCH","PUT","DELETE"].includes(request.method)&&!sameOrigin(request))return json({error:"Request origin rejected."},403);
    const organizationId=member.organization_id, role=member.role;
    const canManage=["platform_admin","org_admin","logistics_manager","seller_admin","courier_manager"].includes(role);
    const canOperate=canManage||["logistics_agent","seller_operator","courier_operator"].includes(role);



    if(request.method==="GET"&&url.pathname==="/api/organization"){
      const organization=await env.DB.prepare("SELECT id,name,slug,organization_type,status,created_at FROM organizations WHERE id=?").bind(organizationId).first();
      return json({organization:organization||null});
    }
    if(request.method==="PATCH"&&url.pathname==="/api/organization"){
      if(!["platform_admin","org_admin"].includes(role))return json({error:"Only workspace administrators can update workspace details."},403);
      let b;try{b=await request.json();}catch{return json({error:"Invalid JSON."},400);}
      const name=String(b.name||"").trim();
      if(name.length<2||name.length>120)return json({error:"Workspace name must be between 2 and 120 characters."},400);
      await env.DB.prepare("UPDATE organizations SET name=?,updated_at=? WHERE id=?").bind(name,new Date().toISOString(),organizationId).run();
      return json({ok:true,name});
    }
    if(request.method==="GET"&&url.pathname==="/api/billing/plan"){
      const sub=await env.DB.prepare("SELECT plan_code,status,trial_ends_at,current_period_start,current_period_end FROM subscriptions WHERE organization_id=?").bind(organizationId).first();
      const counts=await env.DB.prepare("SELECT COUNT(*) AS seats FROM memberships WHERE organization_id=? AND status='active'").bind(organizationId).first();
      const limits={starter:3,growth:10,scale:50,enterprise:null};
      return json({subscription:sub||{plan_code:"unassigned",status:"inactive"},active_seats:Number(counts?.seats||0),seat_limit:limits[sub?.plan_code]??null,billing_ready:false,notice:"Online payments are not enabled yet. No subscription charge will be made from this workspace."});
    }
    if(request.method==="POST"&&url.pathname==="/api/invitations"){
      if(!["platform_admin","org_admin"].includes(role))return json({error:"Only workspace administrators can invite teammates."},403);
      let b;try{b=await request.json();}catch{return json({error:"Invalid JSON."},400);}
      const email=String(b.email||"").trim().toLowerCase(),name=String(b.full_name||"").trim(),newRole=String(b.role||"viewer");
      const allowed=["org_admin","seller_admin","seller_operator","logistics_manager","logistics_agent","courier_manager","courier_operator","viewer"];
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||name.length<2||name.length>120||!allowed.includes(newRole))return json({error:"Provide a valid email, full name and role."},400);
      if(await env.DB.prepare("SELECT id FROM users WHERE email=? COLLATE NOCASE").bind(email).first())return json({error:"A user with this email already has an account."},409);
      const pending=await env.DB.prepare("SELECT id FROM organization_invitations WHERE organization_id=? AND email=? COLLATE NOCASE AND accepted_at IS NULL AND expires_at>?").bind(organizationId,email,new Date().toISOString()).first();
      if(pending)return json({error:"A valid invitation for this email already exists."},409);
      const raw=toBase64Url(crypto.getRandomValues(new Uint8Array(32))),digest=new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(raw))),hash=Array.from(digest,x=>x.toString(16).padStart(2,"0")).join("");
      const id="inv_"+crypto.randomUUID(),expires=new Date(Date.now()+7*86400000).toISOString();
      await env.DB.prepare("INSERT INTO organization_invitations(id,organization_id,email,full_name,role,token_hash,expires_at,created_by) VALUES(?,?,?,?,?,?,?,?)").bind(id,organizationId,email,name,newRole,hash,expires,p.user_id).run();
      const inviteUrl=new URL("/accept-invite.html",request.url);inviteUrl.searchParams.set("token",raw);
      await env.DB.prepare("INSERT INTO audit_logs(id,organization_id,actor_user_id,action,resource_type,resource_id,metadata_json) VALUES(?,?,?,'invitation.created','invitation',?,?)").bind("aud_"+crypto.randomUUID(),organizationId,p.user_id,id,JSON.stringify({email,role:newRole,expires_at:expires})).run();
      return json({ok:true,invitation:{id,email,full_name:name,role:newRole,expires_at:expires,invite_url:inviteUrl.toString()},delivery:"Copy and send this secure invitation link to the teammate. Email delivery is not configured yet."},201);
    }

    if(request.method==="GET"&&url.pathname==="/api/users"){
      if(!member||!canManage)return json({error:"Only workspace administrators can view users."},403);
      const result=await env.DB.prepare("SELECT u.id,u.email,u.full_name,u.status,m.role,m.created_at FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.organization_id=? ORDER BY m.created_at DESC LIMIT 200").bind(organizationId).all();
      return json({users:result.results||[]});
    }
    if(request.method==="POST"&&url.pathname==="/api/users"){
      if(!member||!canManage)return json({error:"Only authenticated workspace administrators can create users."},403);
      let b;try{b=await request.json();}catch{return json({error:"Invalid JSON."},400);}
      const email=String(b.email||"").trim().toLowerCase(),name=String(b.full_name||"").trim(),pass=typeof b.temporary_password==="string"?b.temporary_password:"",newRole=String(b.role||"");
      const roleAssignments={
        platform_admin:["org_admin","seller_admin","seller_operator","logistics_manager","logistics_agent","courier_manager","courier_operator","viewer"],
        org_admin:["seller_admin","seller_operator","logistics_manager","logistics_agent","courier_manager","courier_operator","viewer"],
        seller_admin:["seller_operator","viewer"],
        logistics_manager:["logistics_agent","viewer"],
        courier_manager:["courier_operator","viewer"]
      };
      const assignable=roleAssignments[role]||[];
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||name.length<2||name.length>120||pass.length<12||pass.length>128)return json({error:"Provide valid user details, a 12–128 character temporary password, and an allowed role."},400);
      if(!assignable.includes(newRole))return json({error:"Your role cannot assign the requested access level."},403);
      const existing=await env.DB.prepare("SELECT id FROM users WHERE email=? COLLATE NOCASE").bind(email).first();
      if(existing)return json({error:"A user with this email already exists."},409);
      const id="usr_"+crypto.randomUUID(),now=new Date().toISOString(),ph=await hashPassword(pass);
      await env.DB.batch([
        env.DB.prepare("INSERT INTO users(id,email,full_name,password_hash,status,created_at,updated_at) VALUES(?,?,?,?,'active',?,?)").bind(id,email,name,ph,now,now),
        env.DB.prepare("INSERT INTO memberships(id,organization_id,user_id,role,status) VALUES(?,?,?,?,'active')").bind("mem_"+crypto.randomUUID(),organizationId,id,newRole),
        env.DB.prepare("INSERT INTO audit_logs(id,organization_id,actor_user_id,action,resource_type,resource_id,metadata_json) VALUES(?,?,?,'user.created','user',?,?)").bind("aud_"+crypto.randomUUID(),organizationId,p?.user_id||null,id,JSON.stringify({role:newRole,email}))
      ]);
      return json({ok:true,user:{id,email,full_name:name,role:newRole},message:"Account created. Share the temporary password through a separate secure channel."},201);
    }
    if (request.method === "GET" && url.pathname === "/api/health") {
      return json({ ok: true, service: "VAMSEE ticket API" });
    }
    if (request.method === "POST" && url.pathname === "/api/assist") {
      // Protect the AI endpoint from unauthenticated use and unexpected AI spend.
      if (!sameOrigin(request)) return json({ error: "Request origin rejected." }, 403);
      if (!env.DB || !env.VAMSEE_SESSION_SECRET || env.VAMSEE_SESSION_SECRET.length < 32) {
        return json({ error: "Authentication is not configured." }, 503);
      }
      const assistPayload = await userPayload(request, env.VAMSEE_SESSION_SECRET);
      const assistMember = assistPayload ? await env.DB.prepare(
        "SELECT m.organization_id FROM users u JOIN memberships m ON m.user_id=u.id JOIN organizations o ON o.id=m.organization_id WHERE u.id=? AND m.organization_id=? AND u.status='active' AND m.status='active' AND o.status='active'"
      ).bind(assistPayload.user_id, assistPayload.organization_id).first() : null;
      const hasIndividualCookie = (request.headers.get("Cookie") || "").split(";").some(v => v.trim().startsWith(USER_SESSION_COOKIE + "="));
      if (!assistMember) return json({ error: "Authentication required." }, 401);
      if (!canOperate) return json({ error: "Your role cannot use AI assistance." }, 403);
      let input;
      try { input = await request.json(); } catch { return json({ error: "Invalid JSON." }, 400); }
      const allowedIssues = ["general","complaint","billing","technical","onboarding","refund","appointment","admissions","delay","tracking","delivery","address","damage","other"];
      if (!allowedIssues.includes(input.issue_type) || typeof input.customer_name !== "string" ||
          typeof input.tracking_number !== "string" || typeof input.message !== "string" ||
          !input.customer_name.trim() || !input.message.trim()) {
        return json({ error: "Provide a valid enquiry type, customer name, and message." }, 400);
      }
      if (!env.AI || typeof env.AI.run !== "function") {
        return json({ error: "Workers AI binding is not available yet. Check the AI binding in Wrangler settings." }, 503);
      }
      const issueLabels = { general:"General enquiry", complaint:"Complaint or service issue", billing:"Billing or payment query", technical:"Technical support", onboarding:"Customer onboarding", refund:"Refund or return request", appointment:"Appointment or booking", admissions:"Admission or application query", delay:"Shipment delayed", tracking:"Tracking not updated", delivery:"Marked delivered, not received", address:"Address correction request", damage:"Parcel damaged", other:"Other customer request" };
      const industry = typeof input.industry === "string" ? input.industry.trim().slice(0,80) : "General business";
      const prompt = `You are VAMSEE's customer support and business operations copilot. The business industry is: ${industry}. Analyse the customer enquiry and return ONLY valid JSON, with no markdown.
Required JSON keys: priority, assigned_queue, next_action, customer_reply, reason.
priority must be exactly HIGH, MEDIUM, or NORMAL. Use HIGH for safety concerns, serious complaints, service failures, missed critical appointments, suspected fraud, or urgent unresolved issues; MEDIUM for account, billing, technical, refund or onboarding issues needing investigation; NORMAL for routine information requests. Use judgement based on the message, not category alone.
Choose a sensible team queue and a clear next action based on the industry and request type.
Write the customer_reply in professional, natural business English. Start with "Hello [customer name]," when a name is provided, otherwise "Hello,". Be concise, empathetic, clear and action-oriented. Never use intimate, overly familiar, slang or pet-name greetings. Do not claim an action has already happened, invent facts, promise a resolution time, or ask for passwords, OTPs, full payment-card details, or unnecessary sensitive personal/health information. For healthcare-related requests, do not include diagnosis or medical advice; route clinical questions to qualified staff. For billing/refunds, say details must be verified before confirming an outcome.
Customer name: ${input.customer_name.trim().slice(0,100)}
Reference ID: ${input.tracking_number.trim().slice(0,100) || "Not provided"}
Request type: ${issueLabels[input.issue_type]}
Customer message: ${input.message.trim().slice(0,1500)}
Return only JSON.`;
      try {
        const result = await env.AI.run("@cf/google/gemma-4-26b-a4b-it", {
          messages: [
            { role: "system", content: "You are a customer support classification engine. Return exactly one JSON object and no other text. Do not include analysis or markdown." },
            { role: "user", content: prompt }
          ],
          max_tokens: 500,
          temperature: 0.1,
          response_format: { type: "json_object" },
          chat_template_kwargs: { enable_thinking: false }
        });
        // Workers AI models may return plain text, a response/output field, or
        // an OpenAI-compatible choices/message/content envelope. Inspect all
        // text-bearing fields rather than assuming one response shape.
        const candidates = [];
        const collectText = (value, depth = 0) => {
          if (depth > 6 || value == null) return;
          if (typeof value === "string") { candidates.push(value); return; }
          if (Array.isArray(value)) { for (const item of value) collectText(item, depth + 1); return; }
          if (typeof value === "object") {
            for (const key of ["response", "output", "text", "content", "message", "choices", "result"]) {
              if (key in value) collectText(value[key], depth + 1);
            }
          }
        };
        collectText(result);
        if (typeof result === "string") candidates.unshift(result);
        let suggestion = null;
        for (const candidate of candidates) {
          const cleaned = candidate.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
          const match = cleaned.match(/\{[\s\S]*\}/);
          if (!match) continue;
          try { suggestion = JSON.parse(match[0]); break; } catch {}
        }
        if (!suggestion) throw new Error("AI returned text, but no valid JSON object could be extracted.");
        if (!["HIGH", "MEDIUM", "NORMAL"].includes(suggestion.priority) ||
            typeof suggestion.assigned_queue !== "string" || typeof suggestion.next_action !== "string" ||
            typeof suggestion.customer_reply !== "string" || typeof suggestion.reason !== "string") {
          throw new Error("AI response did not match the expected format.");
        }
        return json({ ok: true, source: "workers-ai", priority: suggestion.priority,
          assigned_queue: suggestion.assigned_queue.slice(0,100), next_action: suggestion.next_action.slice(0,180),
          customer_reply: suggestion.customer_reply.slice(0,1200), reason: suggestion.reason.slice(0,240) });
      } catch (error) {
        return json({ error: "AI processing failed: " + error.message }, 502);
      }
    }
    if (request.method === "POST" && url.pathname === "/api/escalations/run") {
      if(!canManage)return json({error:"Your role cannot run escalations."},403);
      const now = new Date();
      const cutoff = new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString();
      const result = await env.DB.prepare(`UPDATE tickets
        SET assigned_queue = 'Priority Escalations',
            next_action = 'Auto-escalated: HIGH-priority ticket exceeded the 4-hour demo SLA. Review the case and contact the carrier/customer.'
        WHERE organization_id = ?
          AND priority = 'HIGH'
          AND status IN ('OPEN', 'IN_PROGRESS')
          AND created_at <= ?
          AND assigned_queue != 'Priority Escalations'`)
        .bind(organizationId, cutoff).run();
      return json({ ok: true, escalated: result.meta.changes || 0, checked_at: now.toISOString() });
    }
    if (request.method === "GET" && url.pathname === "/api/tickets") {
      const status = url.searchParams.get("status");
      const priority = url.searchParams.get("priority");
      let sql = "SELECT * FROM tickets";
      const where = ["organization_id = ?"], values = [organizationId];
      if (status && ["OPEN","IN_PROGRESS","RESOLVED"].includes(status)) { where.push("status = ?"); values.push(status); }
      if (priority && ["HIGH","MEDIUM","NORMAL"].includes(priority)) { where.push("priority = ?"); values.push(priority); }
      if (where.length) sql += " WHERE " + where.join(" AND ");
      sql += " ORDER BY created_at DESC LIMIT 200";
      const { results } = await env.DB.prepare(sql).bind(...values).all();
      return json({ tickets: results });
    }
    if (request.method === "POST" && url.pathname === "/api/tickets") {
      if(!canOperate)return json({error:"Your role cannot create tickets."},403);
      let t;
      try { t = await request.json(); } catch { return json({ error: "Invalid JSON." }, 400); }
      const required = ["id","customer_name","tracking_number","issue_type","priority","assigned_queue","next_action","customer_reply"];
      if (required.some(k => typeof t[k] !== "string" || !t[k].trim())) return json({ error: "Missing required ticket fields." }, 400);
      if (!["HIGH","MEDIUM","NORMAL"].includes(t.priority)) return json({ error: "Invalid priority." }, 400);
      const now = new Date().toISOString();
      let lastTrackingAt = null;
      if (t.last_tracking_at != null && t.last_tracking_at !== "") {
        if (typeof t.last_tracking_at !== "string" || !Number.isFinite(Date.parse(t.last_tracking_at))) {
          return json({ error: "Invalid last tracking movement date." }, 400);
        }
        lastTrackingAt = new Date(t.last_tracking_at).toISOString();
      }
      await env.DB.prepare(`INSERT INTO tickets
        (id, organization_id, customer_name, tracking_number, issue_type, message, priority, assigned_queue, next_action, status, customer_reply, created_at, updated_at, last_tracking_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?)`)
        .bind(t.id,organizationId,t.customer_name,t.tracking_number,t.issue_type,t.message || "",t.priority,t.assigned_queue,t.next_action,t.customer_reply,now,now,lastTrackingAt).run();
      return json({ ok: true, id: t.id }, 201);
    }

    if(request.method==="GET"&&url.pathname==="/api/shipments"){
      const result=await env.DB.prepare("SELECT id,tracking_number,carrier_code,aggregator_code,current_status,last_tracking_at,last_event_at,source,external_reference,created_at,updated_at FROM shipments WHERE organization_id=? ORDER BY updated_at DESC LIMIT 200").bind(organizationId).all();
      return json({shipments:result.results||[]});
    }
    if(request.method==="POST"&&url.pathname==="/api/shipments"){
      if(!canOperate)return json({error:"Your role cannot create shipments."},403);
      let b;try{b=await request.json();}catch{return json({error:"Invalid JSON."},400);}
      const tracking=String(b.tracking_number||"").trim(),carrier=String(b.carrier_code||"").trim().toUpperCase(),status=String(b.current_status||"unknown").trim().toLowerCase();
      const allowed=["unknown","created","picked_up","in_transit","out_for_delivery","delivered","exception","returned"];
      const trackingDate=b.last_tracking_at?new Date(b.last_tracking_at):null;
      if(!tracking||tracking.length>100||carrier.length>40||!allowed.includes(status)||(b.last_tracking_at&&(!trackingDate||!Number.isFinite(trackingDate.getTime()))))return json({error:"Provide a tracking number (max 100 characters), valid carrier code, supported status, and valid optional tracking date."},400);
      const id="shp_"+crypto.randomUUID(),now=new Date().toISOString(),trackingAt=trackingDate?trackingDate.toISOString():null;
      try{
        await env.DB.batch([
          env.DB.prepare("INSERT INTO shipments(id,organization_id,tracking_number,carrier_code,current_status,last_tracking_at,last_event_at,source,external_reference,created_at,updated_at) VALUES(?,?,?,?,?,?,?, 'manual',?,?,?)").bind(id,organizationId,tracking,carrier||null,status,trackingAt,trackingAt,b.external_reference?String(b.external_reference).slice(0,120):null,now,now),
          env.DB.prepare("INSERT INTO audit_logs(id,organization_id,actor_user_id,action,resource_type,resource_id,metadata_json) VALUES(?,?,?,'shipment.created','shipment',?,?)").bind("aud_"+crypto.randomUUID(),organizationId,p?.user_id||null,id,JSON.stringify({tracking_number:tracking,carrier_code:carrier||null}))
        ]);
      }catch(error){if(String(error.message||"").includes("UNIQUE"))return json({error:"That tracking number already exists in this workspace."},409);throw error;}
      return json({ok:true,id},201);
    }
    if(request.method==="POST"&&url.pathname==="/api/shipments/import"){
      if(!canOperate)return json({error:"Your role cannot import shipments."},403);
      let body;try{body=await request.json();}catch{return json({error:"Invalid JSON."},400);}
      const rows=body?.shipments;
      if(!Array.isArray(rows)||rows.length<1||rows.length>200)return json({error:"Upload between 1 and 200 shipment rows per import."},400);
      const allowed=["unknown","created","picked_up","in_transit","out_for_delivery","delivered","exception","returned"];
      const eventAllowed=new Set(["created","picked_up","in_transit","out_for_delivery","delivered","exception","returned"]);
      const now=new Date().toISOString(),seen=new Set(),statements=[];
      for(const row of rows){
        const tracking=String(row?.tracking_number||"").trim();
        // Accept both VAMSEE's canonical headers and common courier/order exports.
        const carrier=String(row?.carrier_code??row?.carrier??row?.carrier_name??"").trim().toUpperCase();
        const suppliedStatus=String(row?.current_status??row?.status??"").trim().toLowerCase().replace(/[\s-]+/g,"_");
        const status=suppliedStatus||"unknown";
        const eventDate=row?.last_tracking_at?new Date(row.last_tracking_at):null;
        const external=String(row?.external_reference||"").trim();
        if(!tracking||tracking.length>100||carrier.length>40||!allowed.includes(status)||(row?.last_tracking_at&&(!eventDate||!Number.isFinite(eventDate.getTime())))||external.length>120)
          return json({error:"One or more rows contain invalid tracking number, carrier, status, date, or reference."},400);
        const key=tracking.toLowerCase();if(seen.has(key))return json({error:"Duplicate tracking number in this upload: "+tracking},400);seen.add(key);
        const iso=eventDate?eventDate.toISOString():null;
        const existing=await env.DB.prepare("SELECT id,current_status,last_tracking_at FROM shipments WHERE organization_id=? AND tracking_number=?").bind(organizationId,tracking).first();
        const shipmentId=existing?.id||"shp_"+crypto.randomUUID();
        const effectiveStatus=(!suppliedStatus&&existing)?existing.current_status:status;
        const changed=effectiveStatus!=="unknown"&&(!existing||existing.current_status!==effectiveStatus||(iso&&existing.last_tracking_at!==iso));
        const eventAt=iso||(changed?now:null);
        statements.push(env.DB.prepare("INSERT INTO shipments(id,organization_id,tracking_number,carrier_code,current_status,last_tracking_at,last_event_at,source,external_reference,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'manual',?,?,?) ON CONFLICT(organization_id,tracking_number) DO UPDATE SET carrier_code=COALESCE(excluded.carrier_code,shipments.carrier_code),current_status=excluded.current_status,last_tracking_at=COALESCE(excluded.last_tracking_at,shipments.last_tracking_at),last_event_at=COALESCE(excluded.last_event_at,shipments.last_event_at),external_reference=COALESCE(excluded.external_reference,shipments.external_reference),source='manual',updated_at=excluded.updated_at").bind(shipmentId,organizationId,tracking,carrier||null,effectiveStatus,iso,eventAt,external||null,now,now));
        if(changed&&eventAllowed.has(effectiveStatus)){
          statements.push(env.DB.prepare("INSERT INTO shipment_events(id,organization_id,shipment_id,event_status,description,event_time,source) VALUES(?,?,?,?,?,?,'csv_import')").bind("evt_"+crypto.randomUUID(),organizationId,shipmentId,effectiveStatus,"Shipment status imported from CSV",eventAt));
        }
      }
      for(let i=0;i<statements.length;i+=40)await env.DB.batch(statements.slice(i,i+40));
      await env.DB.prepare("INSERT INTO audit_logs(id,organization_id,actor_user_id,action,resource_type,resource_id,metadata_json) VALUES(?,?,?,'shipments.csv_imported','shipment','bulk',?)").bind("aud_"+crypto.randomUUID(),organizationId,p?.user_id||null,JSON.stringify({rows:rows.length})).run();
      return json({ok:true,imported:rows.length,updated_or_created:rows.length});
    }
    const eventMatch=url.pathname.match(/^\/api\/shipments\/([^/]+)\/events$/);
    if(request.method==="GET"&&eventMatch){
      const result=await env.DB.prepare("SELECT id,event_code,event_status,description,location,event_time,source,created_at FROM shipment_events WHERE shipment_id=? AND organization_id=? ORDER BY event_time DESC LIMIT 100").bind(decodeURIComponent(eventMatch[1]),organizationId).all();
      return json({events:result.results||[]});
    }
    if(request.method==="POST"&&eventMatch){
      if(!canOperate)return json({error:"Your role cannot add shipment events."},403);
      let b;try{b=await request.json();}catch{return json({error:"Invalid JSON."},400);}
      const status=String(b.event_status||"").trim().toLowerCase(),description=String(b.description||"").trim(),location=String(b.location||"").trim(),eventTime=new Date(b.event_time||Date.now());
      const allowed=["created","picked_up","in_transit","out_for_delivery","delivered","exception","returned"];
      if(!allowed.includes(status)||!description||description.length>500||location.length>120||!Number.isFinite(eventTime.getTime()))return json({error:"Provide a valid event status, description, optional location, and event time."},400);
      const shipmentId=decodeURIComponent(eventMatch[1]),exists=await env.DB.prepare("SELECT id FROM shipments WHERE id=? AND organization_id=?").bind(shipmentId,organizationId).first();
      if(!exists)return json({error:"Shipment not found."},404);
      const now=new Date().toISOString(),eventId="evt_"+crypto.randomUUID(),iso=eventTime.toISOString();
      await env.DB.batch([
        env.DB.prepare("INSERT INTO shipment_events(id,organization_id,shipment_id,event_status,description,location,event_time,source) VALUES(?,?,?,?,?,?,?,'manual')").bind(eventId,organizationId,shipmentId,status,description,location||null,iso),
        env.DB.prepare("UPDATE shipments SET current_status=?,last_tracking_at=?,last_event_at=?,updated_at=? WHERE id=? AND organization_id=?").bind(status,iso,iso,now,shipmentId,organizationId),
        env.DB.prepare("INSERT INTO audit_logs(id,organization_id,actor_user_id,action,resource_type,resource_id,metadata_json) VALUES(?,?,?,'shipment.event_added','shipment',?,?)").bind("aud_"+crypto.randomUUID(),organizationId,p?.user_id||null,shipmentId,JSON.stringify({event_status:status,event_id:eventId}))
      ]);
      return json({ok:true,id:eventId},201);
    }

    const match = url.pathname.match(/^\/api\/tickets\/([^/]+)$/);
    if (request.method === "PATCH" && match) {
      if(!canOperate)return json({error:"Your role cannot update tickets."},403);
      let body;
      try { body = await request.json(); } catch { return json({ error: "Invalid JSON." }, 400); }
      if (!["OPEN","IN_PROGRESS","RESOLVED"].includes(body.status)) return json({ error: "Invalid status." }, 400);
      const result = await env.DB.prepare("UPDATE tickets SET status = ?, updated_at = ? WHERE id = ? AND organization_id = ?")
        .bind(body.status,new Date().toISOString(),decodeURIComponent(match[1]),organizationId).run();
      if (!result.meta.changes) return json({ error: "Ticket not found." }, 404);
      return json({ ok: true });
    }
    return json({ error: "Not found." }, 404);
  }
};