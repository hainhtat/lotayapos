import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/database.js";
import { ApiError } from "../utils/api-error.js";

export const USER_ROLES = ["SUPERADMIN", "OPERATIONS_MANAGER", "FINANCE", "DISPATCHER", "RIDER", "AUDITOR"] as const;
type UserRole = (typeof USER_ROLES)[number];
type Actor = { id: string; role: string };
type UserInput = { name: string; username: string; email: string; role: UserRole; hubId?: string | null };

const publicSelect = { id:true,name:true,username:true,email:true,role:true,active:true,hubId:true,createdAt:true,updatedAt:true,hub:{select:{id:true,name:true}} } as const;
const auditState = (user: {name:string;username:string|null;email:string;role:string;active:boolean;hubId:string|null}) => ({name:user.name,username:user.username,email:user.email,role:user.role,active:user.active,hubId:user.hubId});

async function requireSuperadmin(tx: Prisma.TransactionClient | typeof prisma, actor: Actor) {
  const persisted = await tx.user.findUnique({where:{id:actor.id},select:{active:true,role:true}});
  if (!persisted?.active || persisted.role !== "SUPERADMIN" || actor.role !== "SUPERADMIN") throw new ApiError(403,"FORBIDDEN","Active Superadmin access required");
}

async function normalizeScope(tx: Prisma.TransactionClient | typeof prisma, role: UserRole, hubId?: string | null) {
  const normalizedHub = hubId?.trim() || null;
  if (role === "SUPERADMIN" && normalizedHub) throw new ApiError(400,"INVALID_USER_SCOPE","Superadmin must have organization-wide scope");
  if (["OPERATIONS_MANAGER","FINANCE","DISPATCHER","RIDER"].includes(role) && !normalizedHub) throw new ApiError(400,"HUB_REQUIRED","A hub is required for this role");
  if (normalizedHub && !(await tx.hub.findUnique({where:{id:normalizedHub},select:{id:true}}))) throw new ApiError(404,"HUB_NOT_FOUND","Hub not found");
  return normalizedHub;
}

function duplicateError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ApiError(409,"USER_EXISTS","An account with this email or username already exists");
  throw error;
}

let superadminMutationTail: Promise<void> = Promise.resolve();
async function withSuperadminInvariant<T>(work:(tx:Prisma.TransactionClient)=>Promise<T>):Promise<T>{
  let unlock!:()=>void; const prior=superadminMutationTail; superadminMutationTail=new Promise<void>(resolve=>{unlock=resolve;}); await prior;
  try {
    for(let attempt=0;attempt<3;attempt++) try {
      return await prisma.$transaction(async tx=>{
        if(process.env.DATABASE_URL?.startsWith("postgres")) await tx.$executeRaw`SELECT pg_advisory_xact_lock(1280266061)`;
        return work(tx);
      },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
    } catch(error) {
      if(!(error instanceof Prisma.PrismaClientKnownRequestError && error.code==="P2034")||attempt===2) throw error;
    }
    throw new Error("Unreachable transaction retry state");
  } finally { unlock(); }
}

export async function listUsers(input:{page:number;pageSize:number;search?:string;role?:string;active?:boolean;hubId?:string},actor:Actor) {
  await requireSuperadmin(prisma,actor);
  const where: Prisma.UserWhereInput = {
    ...(input.role ? {role:input.role} : {}), ...(input.active === undefined ? {} : {active:input.active}), ...(input.hubId ? {hubId:input.hubId} : {}),
    ...(input.search ? {OR:[{name:{contains:input.search}},{email:{contains:input.search}},{username:{contains:input.search}}]} : {}),
  };
  const [items,total] = await Promise.all([prisma.user.findMany({where,select:publicSelect,orderBy:[{active:"desc"},{name:"asc"}],skip:(input.page-1)*input.pageSize,take:input.pageSize}),prisma.user.count({where})]);
  return {items,pagination:{page:input.page,pageSize:input.pageSize,total,totalPages:Math.ceil(total/input.pageSize)}};
}

export async function createUser(input:UserInput & {password:string},actor:Actor) {
  try { return await prisma.$transaction(async tx => {
    await requireSuperadmin(tx,actor); const hubId=await normalizeScope(tx,input.role,input.hubId); const username=input.username.trim().toLowerCase(); const email=input.email.trim().toLowerCase();
    const created=await tx.user.create({data:{name:input.name.trim(),username,email,role:input.role,hubId,passwordHash:await bcrypt.hash(input.password,12),...(input.role === "RIDER" ? {rider:{create:{hubId}}}: {})},select:publicSelect});
    await tx.userAdminAudit.create({data:{action:"USER_CREATED",actorId:actor.id,targetUserId:created.id,afterJson:JSON.stringify(auditState(created))}}); return created;
  }); } catch(error){ duplicateError(error); }
}

export async function updateUser(id:string,input:Partial<UserInput>,actor:Actor) {
  try { return await withSuperadminInvariant(async tx => {
    await requireSuperadmin(tx,actor); const current=await tx.user.findUnique({where:{id},include:{rider:{select:{id:true}}}}); if(!current) throw new ApiError(404,"USER_NOT_FOUND","User not found");
    const role=(input.role ?? current.role) as UserRole; const hubId=await normalizeScope(tx,role,input.hubId === undefined ? current.hubId : input.hubId);
    if(id===actor.id && role!=="SUPERADMIN") throw new ApiError(409,"SELF_PRIVILEGE_CHANGE","You cannot demote your own account");
    if(current.role==="SUPERADMIN" && role!=="SUPERADMIN" && current.active && await tx.user.count({where:{role:"SUPERADMIN",active:true}})<=1) throw new ApiError(409,"LAST_SUPERADMIN","At least one active Superadmin is required");
    const privilegeChanged=role!==current.role || hubId!==current.hubId;
    const updated=await tx.user.update({where:{id},data:{...(input.name!==undefined?{name:input.name.trim()}:{}),...(input.username!==undefined?{username:input.username.trim().toLowerCase()}:{}),...(input.email!==undefined?{email:input.email.trim().toLowerCase()}:{}),role,hubId,...(privilegeChanged?{tokenVersion:{increment:1}}:{})},select:publicSelect});
    if(role==="RIDER"){ if(current.rider) await tx.rider.update({where:{userId:id},data:{hubId}}); else await tx.rider.create({data:{userId:id,hubId}}); }
    await tx.userAdminAudit.create({data:{action:"USER_UPDATED",actorId:actor.id,targetUserId:id,beforeJson:JSON.stringify(auditState(current)),afterJson:JSON.stringify(auditState(updated))}}); return updated;
  }); } catch(error){ duplicateError(error); }
}

export async function setUserActive(id:string,active:boolean,actor:Actor) {
  return withSuperadminInvariant(async tx=>{ await requireSuperadmin(tx,actor); const current=await tx.user.findUnique({where:{id}}); if(!current) throw new ApiError(404,"USER_NOT_FOUND","User not found");
    if(id===actor.id && !active) throw new ApiError(409,"SELF_DEACTIVATION","You cannot deactivate your own account");
    if(current.role==="SUPERADMIN" && current.active && !active && await tx.user.count({where:{role:"SUPERADMIN",active:true}})<=1) throw new ApiError(409,"LAST_SUPERADMIN","At least one active Superadmin is required");
    if(current.active===active) return tx.user.findUniqueOrThrow({where:{id},select:publicSelect});
    const updated=await tx.user.update({where:{id},data:{active,tokenVersion:{increment:1}},select:publicSelect}); await tx.userAdminAudit.create({data:{action:active?"USER_ACTIVATED":"USER_DEACTIVATED",actorId:actor.id,targetUserId:id,beforeJson:JSON.stringify(auditState(current)),afterJson:JSON.stringify(auditState(updated))}}); return updated; });
}

export async function resetUserPassword(id:string,password:string,actor:Actor) {
  return prisma.$transaction(async tx=>{ await requireSuperadmin(tx,actor); const current=await tx.user.findUnique({where:{id},select:{id:true}}); if(!current) throw new ApiError(404,"USER_NOT_FOUND","User not found");
    await tx.user.update({where:{id},data:{passwordHash:await bcrypt.hash(password,12),tokenVersion:{increment:1}}}); await tx.userAdminAudit.create({data:{action:"USER_PASSWORD_RESET",actorId:actor.id,targetUserId:id}}); return {id,passwordReset:true}; });
}
